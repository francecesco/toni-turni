import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import type { VisionProvider } from '@/modules/extract/providers/types'
import type { RosterBand } from '@/modules/ingest/crop'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let repo: typeof import('@/modules/roster/repository')
let job: typeof import('@/modules/roster/job')
let worker: typeof import('@/modules/roster/worker')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  repo = await import('@/modules/roster/repository')
  job = await import('@/modules/roster/job')
  worker = await import('@/modules/roster/worker')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.assignment.deleteMany()
  await prisma.rosterCell.deleteMany()
  await prisma.rosterBand.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.shiftCode.deleteMany()
  await prisma.shiftCode.createMany({
    data: [
      { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
      { code: 'P', label: 'Pomeriggio', kind: 'work', startTime: '14:00', endTime: '21:00' },
    ],
  })
})

async function foto(): Promise<Buffer> {
  return sharp({ create: { width: 1000, height: 800, channels: 3, background: '#ffffff' } })
    .jpeg()
    .toBuffer()
}

async function tabella(overrides: Record<string, unknown> = {}) {
  return repo.createRoster({
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    imagePath: 'irrilevante.jpg',
    ...overrides,
  })
}

/**
 * Due bande finte, una per gruppo di colonne, che coprono **un giorno solo**: così
 * una risposta da una cella è una banda completa e i test restano leggibili. Il
 * ritaglio vero (`cropRosterBands`) rileva la griglia sulla foto, e su un
 * rettangolo bianco non c è nessuna griglia da rilevare: si inietta.
 */
function bandeFinte(immagine: Buffer): RosterBand[] {
  return [1, 2].map((colonna) => ({
    spec: {
      columns: [colonna],
      dayFrom: 1,
      dayTo: 1,
      days: { left: 0, width: 0.1 },
      crop: { left: 0.1 * colonna, top: 0, width: 0.1, height: 1 },
      header: null,
    },
    image: immagine,
    width: 200,
    height: 400,
  }))
}

function risposta(column: string, code: string): string {
  return JSON.stringify({
    columns: [column],
    cells: [{ day: 1, column, code, confidence: 0.9, handCorrected: false }],
  })
}

function providerFinto(risposte: Array<string | Error>): VisionProvider & { chiamate: number } {
  let chiamate = 0
  return {
    name: 'finto',
    get chiamate() {
      return chiamate
    },
    async extract() {
      const risposta = risposte[chiamate]
      chiamate += 1
      if (risposta === undefined) throw new Error('il test non ha previsto questa chiamata')
      if (risposta instanceof Error) throw risposta
      return { raw: risposta, model: 'modello-finto', provider: 'finto' }
    },
  }
}

function deps(provider: VisionProvider, immagine?: Buffer) {
  return {
    provider,
    fallback: null,
    // Nessuna attesa nei test: il distanziamento è misurato altrove.
    pace: async () => {},
    readImage: async () => immagine ?? (await foto()),
    cropBands: async (img: Buffer) => bandeFinte(img),
  }
}

describe('runExtractionJob — l estrazione lunga fuori dalla richiesta HTTP', () => {
  it("non chiama il provider se la referente non ha autorizzato l'invio della foto", async () => {
    const r = await tabella()
    const provider = providerFinto([])

    const esito = await job.runExtractionJob(r.id, deps(provider))

    expect(esito.status).toBe('skipped')
    expect(provider.chiamate).toBe(0)
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('uploaded')
  })

  it('legge tutte le bande e conclude extracted, salvando le celle risolte', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, [], new Date())
    const provider = providerFinto([risposta('CRISTINA', 'M'), risposta('SARA', 'P')])

    const esito = await job.runExtractionJob(r.id, deps(provider))

    expect(esito.status).toBe('extracted')
    expect(provider.chiamate).toBe(2)
    const celle = await prisma.rosterCell.findMany({ where: { rosterId: r.id } })
    expect(celle.map((c) => `${c.columnLabel}:${c.code}`).sort()).toEqual([
      'CRISTINA:M',
      'SARA:P',
    ])
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.provider).toBe('finto')
  })

  it('una banda illeggibile lascia la tabella partial, con la banda dichiarata mancante', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, [], new Date())
    const provider = providerFinto([risposta('CRISTINA', 'M'), 'spazzatura', 'ancora spazzatura'])

    const esito = await job.runExtractionJob(r.id, deps(provider))

    expect(esito.status).toBe('partial')
    const progresso = await repo.rosterProgress(r.id)
    expect(progresso.status).toBe('partial')
    expect(progresso.missingBands).toEqual([1])
    expect(progresso.bandsDone).toBe(1)
  })

  it('riprende dopo un riavvio richiamando il provider solo sulle bande che mancano', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, [], new Date())
    const primoGiro = providerFinto([risposta('CRISTINA', 'M'), 'spazzatura', 'spazzatura'])
    await job.runExtractionJob(r.id, deps(primoGiro))

    // Il processo muore qui: la banda 1 è dichiarata mancante e la 0 è già salvata.
    const secondoGiro = providerFinto([risposta('SARA', 'P')])
    const esito = await job.runExtractionJob(r.id, deps(secondoGiro))

    expect(secondoGiro.chiamate).toBe(1)
    expect(esito.status).toBe('extracted')
    const celle = await prisma.rosterCell.findMany({ where: { rosterId: r.id } })
    expect(celle).toHaveLength(2)
  })

  it('se la foto non c è più (retention) dichiara il guasto invece di restare extracting', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, [], new Date())
    const provider = providerFinto([])

    const esito = await job.runExtractionJob(r.id, {
      ...deps(provider),
      readImage: async () => {
        throw new Error('Immagine della tabella non trovata')
      },
    })

    expect(esito.status).toBe('failed')
    expect(provider.chiamate).toBe(0)
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/immagine/i)
  })

  it('se nella foto non si riconosce la tabella dichiara il guasto, non indovina la geometria', async () => {
    // Un raddrizzamento a caso non produce un errore: produce ritagli spostati,
    // cioè turni attribuiti al giorno o alla persona sbagliata.
    const r = await tabella({ month: 9 })
    await repo.prepareExtraction(r.id, [], new Date())
    const provider = providerFinto([])

    const esito = await job.runExtractionJob(r.id, {
      ...deps(provider),
      cropBands: async () => {
        throw new Error('Nessuna tabella riconoscibile nella foto')
      },
    })

    expect(esito.status).toBe('failed')
    expect(provider.chiamate).toBe(0)
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/ritagliare/i)
  })

  it('il piano delle bande lo fa il job, non la richiesta HTTP che ha autorizzato', async () => {
    const r = await tabella()
    // La route registra la sola autorizzazione: nessuna banda in tabella.
    await repo.prepareExtraction(r.id, [], new Date())
    expect(await prisma.rosterBand.count({ where: { rosterId: r.id } })).toBe(0)

    const provider = providerFinto([risposta('CRISTINA', 'M'), risposta('SARA', 'P')])
    const esito = await job.runExtractionJob(r.id, deps(provider))

    expect(esito.status).toBe('extracted')
    const bande = await prisma.rosterBand.findMany({
      where: { rosterId: r.id },
      orderBy: { index: 'asc' },
    })
    expect(bande.map((b) => [b.index, b.dayFrom, b.dayTo])).toEqual([
      [0, 1, 1],
      [1, 1, 1],
    ])
  })

  it('distanzia le chiamate fra una banda e l altra, e non prima della prima', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, [], new Date())
    const attese: number[] = []
    const provider = providerFinto([risposta('CRISTINA', 'M'), risposta('SARA', 'P')])

    await job.runExtractionJob(r.id, {
      ...deps(provider),
      pace: async (index: number) => {
        attese.push(index)
      },
    })

    // Una sola attesa, fra la banda 0 e la banda 1: il tetto è sui token al
    // minuto, e aspettare prima della prima chiamata è tempo regalato.
    expect(attese).toEqual([1])
  })

  it('non richiama il provider su una tabella già completa', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, [], new Date())
    await job.runExtractionJob(r.id, deps(providerFinto([risposta('A', 'M'), risposta('B', 'P')])))

    const provider = providerFinto([])
    const esito = await job.runExtractionJob(r.id, deps(provider))

    expect(esito.status).toBe('skipped')
    expect(provider.chiamate).toBe(0)
  })

  it('una cella che cita un giorno che la banda non mostrava si scarta: la banda resta un buco', async () => {
    const r = await tabella({ month: 11 }) // novembre 2026: 30 giorni
    await repo.prepareExtraction(r.id, [], new Date())
    const fuoriBanda = JSON.stringify({
      columns: ['CRISTINA'],
      cells: [{ day: 31, column: 'CRISTINA', code: 'M', confidence: 0.9, handCorrected: false }],
    })
    const provider = providerFinto([fuoriBanda, risposta('SARA', 'P')])

    const esito = await job.runExtractionJob(r.id, deps(provider))

    expect(esito.status).toBe('partial')
    const progresso = await repo.rosterProgress(r.id)
    expect(progresso.missingBands).toEqual([0])
  })
})

/**
 * La strategia di lettura: **una chiamata sola con la tabella intera** per
 * default, le bande come ripiego.
 *
 * La tabella intera in una chiamata, misurata nella Fase 2A sulla **foto**, dava
 * il 18,5% di celle corrette; le bande danno il 99,8% ma su Groq costavano ~50 s
 * di attesa l una per il tetto di token al minuto. Togliendo Groq quell attesa
 * non c e piu, e la tabella intera arriva al modello raddrizzata, ritagliata
 * sulla griglia e ricampionata: sono tre differenze rispetto alla misura del
 * 18,5%. Se `npm run eval` dicesse che non bastano, `AI_STRATEGY=bands` riporta
 * al percorso misurato senza toccare il codice.
 */
describe('extractionStrategyFromEnv', () => {
  it('legge la tabella intera in una chiamata sola, per default', () => {
    expect(job.extractionStrategyFromEnv()).toBe('whole')
  })

  it('torna alle bande quando AI_STRATEGY lo chiede', () => {
    process.env.AI_STRATEGY = 'bands'
    try {
      expect(job.extractionStrategyFromEnv()).toBe('bands')
    } finally {
      delete process.env.AI_STRATEGY
    }
  })

  it('rifiuta una strategia sconosciuta invece di ripiegare in silenzio', () => {
    // Ripiegare vorrebbe dire leggere la tabella in un modo diverso da quello
    // che l ambiente ha chiesto, e non dirlo a nessuno.
    process.env.AI_STRATEGY = 'inventata'
    try {
      expect(() => job.extractionStrategyFromEnv()).toThrow(/inventata/)
    } finally {
      delete process.env.AI_STRATEGY
    }
  })
})

describe('runExtractionJob con la tabella intera in una banda sola', () => {
  /** La tabella intera: una banda, tutte le colonne, tutti i giorni del mese. */
  function bandaIntera(immagine: Buffer): RosterBand[] {
    return [
      {
        spec: {
          columns: [1, 2],
          dayFrom: 1,
          dayTo: 1,
          days: { left: 0, width: 0.1 },
          crop: { left: 0.1, top: 0, width: 0.9, height: 1 },
          header: null,
          whole: true,
        },
        image: immagine,
        width: 2762,
        height: 2574,
      },
    ]
  }

  it('con una chiamata sola salva tutte le celle e conclude extracted', async () => {
    const r = await tabella({ requestedAt: new Date('2026-08-26T10:00:00Z') })
    const provider = providerFinto([
      JSON.stringify({
        columns: ['RENATA', 'MERY'],
        cells: [
          { day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false },
          { day: 1, column: 'MERY', code: 'P', confidence: 0.9, handCorrected: false },
        ],
      }),
    ])

    const esito = await job.runExtractionJob(r.id, {
      ...deps(provider),
      cropBands: async (img: Buffer) => bandaIntera(img),
    })

    expect(provider.chiamate).toBe(1)
    expect(esito.status).toBe('extracted')
    expect(esito.bandsRun).toBe(1)
    const celle = await prisma.rosterCell.findMany({ where: { rosterId: r.id } })
    expect(celle).toHaveLength(2)
  })

  it('una tabella intera letta a meta resta partial: il buco si dichiara', async () => {
    // E il guasto peggiore della chiamata unica: una risposta valida e corta
    // somiglia a un foglio con le celle vuote. Su una banda sola non c e nessuna
    // altra banda che copra il buco.
    const r = await tabella({ requestedAt: new Date('2026-08-26T10:00:00Z') })
    const provider = providerFinto([
      JSON.stringify({
        columns: ['RENATA', 'MERY'],
        cells: [{ day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false }],
      }),
    ])

    const esito = await job.runExtractionJob(r.id, {
      ...deps(provider),
      cropBands: async (img: Buffer) => bandaIntera(img),
    })

    expect(esito.status).toBe('partial')
    // il buco vive sulla banda, che e dove la Fase 3 lo va a leggere per
    // tradurlo in nomi di colonna e giorni
    const bande = await prisma.rosterBand.findMany({ where: { rosterId: r.id } })
    expect(bande).toHaveLength(1)
    expect(bande[0].status).toBe('partial')
    expect(bande[0].error).toMatch(/1.*2|2.*1/)
    // la cella letta si tiene: buttarla non riempirebbe il buco
    expect(await prisma.rosterCell.count({ where: { rosterId: r.id } })).toBe(1)
  })

  it('dice al modello che sta guardando la tabella intera, non un ritaglio', async () => {
    const r = await tabella({ requestedAt: new Date('2026-08-26T10:00:00Z') })
    let promptVisto = ''
    const provider: VisionProvider = {
      name: 'finto',
      async extract(request) {
        promptVisto = request.prompt
        return {
          raw: JSON.stringify({
            columns: ['RENATA', 'MERY'],
            cells: [
              { day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false },
              { day: 1, column: 'MERY', code: 'P', confidence: 0.9, handCorrected: false },
            ],
          }),
          model: 'm',
          provider: 'finto',
        }
      },
    }

    await job.runExtractionJob(r.id, {
      ...deps(provider),
      cropBands: async (img: Buffer) => bandaIntera(img),
    })

    expect(promptVisto).not.toMatch(/ritaglio/i)
    expect(promptVisto).toMatch(/per intero/i)
  })
})

describe('processResumableRosters — cosa fa il processo quando riparte', () => {
  it('recupera le estrazioni col battito vecchio e le riprende dalle bande mancanti', async () => {
    const r = await tabella()
    const vecchio = new Date(Date.now() - 60 * 60_000)
    await repo.prepareExtraction(r.id, [], vecchio)

    const provider = providerFinto([risposta('CRISTINA', 'M'), risposta('SARA', 'P')])
    const riprese = await worker.processResumableRosters(deps(provider))

    expect(riprese).toEqual([r.id])
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('extracted')
  })

  it('non riprende una tabella mai autorizzata, nemmeno dopo un riavvio', async () => {
    await tabella()
    const provider = providerFinto([])

    expect(await worker.processResumableRosters(deps(provider))).toEqual([])
    expect(provider.chiamate).toBe(0)
  })
})

describe('processResumableRosters — la conservazione delle foto', () => {
  it('fa scadere le foto vecchie a ogni giro: le foto sono dati personali di terzi', async () => {
    const potate: Array<{ days: number }> = []

    await worker.processResumableRosters({
      ...deps(providerFinto([])),
      pruneImages: async (days: number) => {
        potate.push({ days })
        return []
      },
    })

    expect(potate).toHaveLength(1)
    expect(potate[0].days).toBeGreaterThan(0)
  })

  it('una potatura che fallisce non impedisce di riprendere le estrazioni', async () => {
    const r = await tabella()
    const vecchio = new Date(Date.now() - 60 * 60_000)
    await repo.prepareExtraction(r.id, [], vecchio)

    const provider = providerFinto([risposta('CRISTINA', 'M'), risposta('SARA', 'P')])
    const riprese = await worker.processResumableRosters({
      ...deps(provider),
      pruneImages: async () => {
        throw new Error('volume in sola lettura')
      },
    })

    expect(riprese).toEqual([r.id])
  })
})

describe('ensureExtractionWorker — un solo giro alla volta', () => {
  it('due richieste ravvicinate non avviano due estrazioni sulla stessa tabella', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, [], new Date())
    const provider = providerFinto([risposta('CRISTINA', 'M'), risposta('SARA', 'P')])

    const primo = worker.ensureExtractionWorker(deps(provider))
    const secondo = worker.ensureExtractionWorker(deps(provider))
    await Promise.all([primo, secondo])

    expect(provider.chiamate).toBe(2)
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('extracted')
  })
})
