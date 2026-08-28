import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import type { BandCell } from '@/modules/extract/bands'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let repo: typeof import('@/modules/roster/repository')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  repo = await import('@/modules/roster/repository')
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

async function tabella(overrides: Record<string, unknown> = {}) {
  return repo.createRoster({
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    imagePath: 'a.jpg',
    geometry: {
      columnCount: 3,
      columnsPerBand: 1,
      dayColumnFraction: 0.1,
      area: { left: 0, top: 0, right: 1, bottom: 1 },
    },
    ...overrides,
  })
}

function cella(day: number, column: string, code: string, extra: Partial<BandCell> = {}): BandCell {
  return { day, column, code, confidence: 0.95, handCorrected: false, ...extra }
}

const ORA = new Date('2026-08-28T10:00:00Z')

describe('createRoster — la geometria dichiarata dalla referente resta sulla tabella', () => {
  it('salva il numero di colonne, la colonna dei giorni e l area del ritaglio', async () => {
    const r = await tabella()

    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.columnCount).toBe(3)
    expect(row.columnsPerBand).toBe(1)
    expect(row.dayColumnFraction).toBeCloseTo(0.1)
    expect(row.areaRight).toBeCloseTo(1)
    // Nessuna autorizzazione all invio: la foto non è ancora andata da nessuna parte.
    expect(row.requestedAt).toBeNull()
    expect(row.status).toBe('uploaded')
  })
})

describe('prepareExtraction — registra l autorizzazione e crea le bande pendenti', () => {
  it('mette la tabella in extracting, segna requestedAt e crea una banda per indice', async () => {
    const r = await tabella()

    await repo.prepareExtraction(r.id, 3, ORA)

    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('extracting')
    expect(row.requestedAt).toEqual(ORA)
    expect(row.heartbeatAt).toEqual(ORA)
    const bande = await prisma.rosterBand.findMany({ where: { rosterId: r.id } })
    expect(bande.map((b) => b.index).sort()).toEqual([0, 1, 2])
    expect(bande.every((b) => b.status === 'pending')).toBe(true)
  })

  it('richiamata su una ripresa non azzera le bande già lette', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 3, ORA)
    await repo.saveBandCells(r.id, 1, [cella(1, 'MERY', 'M')], { rawOutput: '{}', now: ORA })

    await repo.prepareExtraction(r.id, 3, new Date('2026-08-28T11:00:00Z'))

    const bande = await prisma.rosterBand.findMany({ where: { rosterId: r.id } })
    expect(bande.filter((b) => b.status === 'done').map((b) => b.index)).toEqual([1])
    // requestedAt resta la prima autorizzazione: non si riscrive la storia.
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.requestedAt).toEqual(ORA)
  })
})

describe('pendingBands — cosa manca ancora da leggere', () => {
  it('elenca le bande non lette, comprese quelle fallite, in ordine', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 4, ORA)
    await repo.saveBandCells(r.id, 0, [cella(1, 'A', 'M')], { rawOutput: '{}', now: ORA })
    await repo.markBandFailed(r.id, 2, 'illeggibile', 'spazzatura', ORA)

    expect(await repo.pendingBands(r.id)).toEqual([1, 2, 3])
  })
})

describe('saveBandCells — salvataggio incrementale, una banda alla volta', () => {
  it('salva le celle risolvendo i codici con la legenda e marca la banda letta', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)

    await repo.saveBandCells(
      r.id,
      0,
      [cella(1, 'CRISTINA', 'M'), cella(2, 'CRISTINA', 'p'), cella(3, 'CRISTINA', 'XYZ')],
      { rawOutput: '{"columns":["CRISTINA"]}', now: ORA },
    )

    const celle = await prisma.rosterCell.findMany({
      where: { rosterId: r.id },
      orderBy: { day: 'asc' },
    })
    expect(celle.map((c) => c.code)).toEqual(['M', 'P', null])
    expect(celle.map((c) => c.rawCode)).toEqual(['M', 'p', 'XYZ'])
    expect(celle.every((c) => c.bandIndex === 0)).toBe(true)

    const banda = await prisma.rosterBand.findFirstOrThrow({
      where: { rosterId: r.id, index: 0 },
    })
    expect(banda.status).toBe('done')
    expect(banda.attempts).toBe(1)
    expect(banda.rawOutput).toContain('CRISTINA')
  })

  it('scarta le celle vuote: una cella senza codice non è un turno', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 1, ORA)

    await repo.saveBandCells(r.id, 0, [cella(1, 'CRISTINA', ''), cella(2, 'CRISTINA', 'M')], {
      rawOutput: '{}',
      now: ORA,
    })

    expect(await prisma.rosterCell.count({ where: { rosterId: r.id } })).toBe(1)
  })

  it('conserva la confidenza e la correzione a penna dichiarate dal modello', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 1, ORA)

    await repo.saveBandCells(
      r.id,
      0,
      [cella(4, 'CRISTINA', 'M', { confidence: 0.61, handCorrected: true })],
      { rawOutput: '{}', now: ORA },
    )

    const c = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: r.id, day: 4 } })
    expect(c.confidence).toBeCloseTo(0.61)
    expect(c.handCorrected).toBe(true)
  })

  it('aggiorna il battito della tabella, così si distingue un job vivo da uno morto', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)
    const dopo = new Date('2026-08-28T10:01:00Z')

    await repo.saveBandCells(r.id, 0, [cella(1, 'A', 'M')], { rawOutput: '{}', now: dopo })

    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.heartbeatAt).toEqual(dopo)
  })

  it('due bande sovrapposte che leggono la stessa cella allo stesso modo non fanno conflitto', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)

    await repo.saveBandCells(r.id, 0, [cella(1, 'CRISTINA', 'M')], { rawOutput: '{}', now: ORA })
    const esito = await repo.saveBandCells(r.id, 1, [cella(1, 'CRISTINA', 'M')], {
      rawOutput: '{}',
      now: ORA,
    })

    expect(esito.conflicts).toEqual([])
    const c = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: r.id, day: 1 } })
    expect(c.conflicted).toBe(false)
  })

  it('due bande che leggono la stessa cella in modo diverso lasciano un conflitto dichiarato', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)

    await repo.saveBandCells(r.id, 0, [cella(1, 'CRISTINA', 'M')], { rawOutput: '{}', now: ORA })
    const esito = await repo.saveBandCells(r.id, 1, [cella(1, 'CRISTINA', 'P')], {
      rawOutput: '{}',
      now: ORA,
    })

    expect(esito.conflicts).toEqual([
      { day: 1, columnLabel: 'CRISTINA', kept: 'M', discarded: 'P', bandIndex: 1 },
    ])
    const c = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: r.id, day: 1 } })
    // Vince la prima lettura, deterministicamente, e l altra resta scritta accanto:
    // la confidenza per cella è inutilizzabile per scegliere (nessuna cella sotto 0,8
    // nella misura reale, comprese quelle sbagliate).
    expect(c.rawCode).toBe('M')
    expect(c.conflicted).toBe(true)
    expect(c.conflictWith).toBe('P')
  })

  it('rileggere la stessa banda dopo un fallimento sostituisce le sue celle e non ne duplica nessuna', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 1, ORA)

    await repo.saveBandCells(r.id, 0, [cella(1, 'CRISTINA', 'M'), cella(2, 'CRISTINA', 'M')], {
      rawOutput: '{}',
      now: ORA,
    })
    await repo.saveBandCells(r.id, 0, [cella(1, 'CRISTINA', 'P')], { rawOutput: '{}', now: ORA })

    const celle = await prisma.rosterCell.findMany({ where: { rosterId: r.id } })
    expect(celle).toHaveLength(1)
    expect(celle[0].rawCode).toBe('P')
  })
})

describe('markBandFailed — una banda non letta è dichiarata, non nascosta', () => {
  it('segna la banda fallita con errore e raw output, senza toccare le celle delle altre', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)
    await repo.saveBandCells(r.id, 0, [cella(1, 'A', 'M')], { rawOutput: '{}', now: ORA })

    await repo.markBandFailed(r.id, 1, 'JSON non valido', 'spazzatura', ORA)

    const banda = await prisma.rosterBand.findFirstOrThrow({ where: { rosterId: r.id, index: 1 } })
    expect(banda.status).toBe('failed')
    expect(banda.error).toBe('JSON non valido')
    expect(banda.rawOutput).toBe('spazzatura')
    expect(await prisma.rosterCell.count({ where: { rosterId: r.id } })).toBe(1)
  })
})

describe('finishExtraction — lo stato finale dice la verità sulle bande', () => {
  it('extracted quando tutte le bande sono lette', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)
    await repo.saveBandCells(r.id, 0, [cella(1, 'A', 'M')], { rawOutput: '{}', now: ORA })
    await repo.saveBandCells(r.id, 1, [cella(1, 'B', 'M')], { rawOutput: '{}', now: ORA })

    const stato = await repo.finishExtraction(r.id, { provider: 'groq', now: ORA })

    expect(stato).toBe('extracted')
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('extracted')
    expect(row.provider).toBe('groq')
  })

  it('partial quando qualche banda non è stata letta', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 3, ORA)
    await repo.saveBandCells(r.id, 0, [cella(1, 'A', 'M')], { rawOutput: '{}', now: ORA })
    await repo.markBandFailed(r.id, 1, 'illeggibile', null, ORA)
    await repo.markBandFailed(r.id, 2, 'illeggibile', null, ORA)

    const stato = await repo.finishExtraction(r.id, { provider: 'groq', now: ORA })

    expect(stato).toBe('partial')
  })

  it('failed quando nessuna banda è stata letta', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)
    await repo.markBandFailed(r.id, 0, 'illeggibile', null, ORA)
    await repo.markBandFailed(r.id, 1, 'illeggibile', null, ORA)

    const stato = await repo.finishExtraction(r.id, { provider: 'groq', now: ORA })

    expect(stato).toBe('failed')
  })
})

describe('reclaimStaleExtractions — una tabella non resta extracting per sempre', () => {
  it('marca interrupted le estrazioni il cui battito è vecchio', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)

    const molto = new Date(ORA.getTime() + 10 * 60_000)
    const recuperate = await repo.reclaimStaleExtractions(molto, 3 * 60_000)

    expect(recuperate).toEqual([r.id])
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('interrupted')
  })

  it('non tocca un estrazione che ha respirato poco fa', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 2, ORA)

    const poco = new Date(ORA.getTime() + 30_000)
    expect(await repo.reclaimStaleExtractions(poco, 3 * 60_000)).toEqual([])
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(row.status).toBe('extracting')
  })

  it('non tocca una tabella già conclusa', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 1, ORA)
    await repo.saveBandCells(r.id, 0, [cella(1, 'A', 'M')], { rawOutput: '{}', now: ORA })
    await repo.finishExtraction(r.id, { provider: 'groq', now: ORA })

    const molto = new Date(ORA.getTime() + 10 * 60_000)
    expect(await repo.reclaimStaleExtractions(molto, 3 * 60_000)).toEqual([])
  })
})

describe('resumableRosters — cosa riprendere dopo un riavvio', () => {
  it('elenca solo le tabelle per cui la referente aveva autorizzato l invio', async () => {
    const autorizzata = await tabella()
    await repo.prepareExtraction(autorizzata.id, 2, ORA)
    await repo.reclaimStaleExtractions(new Date(ORA.getTime() + 10 * 60_000), 3 * 60_000)
    const mai = await tabella({ month: 9 })

    const riprendibili = await repo.resumableRosters()

    expect(riprendibili.map((r) => r.id)).toEqual([autorizzata.id])
    expect(riprendibili.map((r) => r.id)).not.toContain(mai.id)
  })

  it('non elenca una tabella le cui bande sono tutte concluse', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 1, ORA)
    await repo.saveBandCells(r.id, 0, [cella(1, 'A', 'M')], { rawOutput: '{}', now: ORA })
    await repo.finishExtraction(r.id, { provider: 'groq', now: ORA })

    expect(await repo.resumableRosters()).toEqual([])
  })
})

describe('rosterProgress — quello che la pagina mostra mentre aspetta', () => {
  it('conta bande fatte su totali, celle, codici ignoti, correzioni a penna e conflitti', async () => {
    const r = await tabella()
    await repo.prepareExtraction(r.id, 3, ORA)
    await repo.saveBandCells(
      r.id,
      0,
      [
        cella(1, 'CRISTINA', 'M'),
        cella(2, 'CRISTINA', 'XYZ'),
        cella(3, 'CRISTINA', 'M', { handCorrected: true }),
      ],
      { rawOutput: '{}', now: ORA },
    )
    await repo.saveBandCells(r.id, 1, [cella(1, 'CRISTINA', 'P')], { rawOutput: '{}', now: ORA })
    await repo.markBandFailed(r.id, 2, 'illeggibile', null, ORA)

    const progresso = await repo.rosterProgress(r.id)

    expect(progresso).toMatchObject({
      status: 'extracting',
      bandsTotal: 3,
      bandsDone: 2,
      bandsFailed: 1,
      missingBands: [2],
      cells: 3,
      unknownCodes: 1,
      handCorrected: 1,
      conflicted: 1,
    })
  })

  it('su una tabella appena caricata dichiara zero bande e nessuna autorizzazione', async () => {
    const r = await tabella()

    const progresso = await repo.rosterProgress(r.id)

    expect(progresso).toMatchObject({
      status: 'uploaded',
      bandsTotal: 0,
      bandsDone: 0,
      missingBands: [],
      requested: false,
    })
  })
})

describe('withWriteLock — SQLite non gestisce scritture concorrenti', () => {
  it('serializza le operazioni anche se chiamate insieme', async () => {
    const ordine: string[] = []

    await Promise.all([
      repo.withWriteLock(async () => {
        ordine.push('a-inizio')
        await new Promise((resolve) => setTimeout(resolve, 20))
        ordine.push('a-fine')
      }),
      repo.withWriteLock(async () => {
        ordine.push('b-inizio')
        ordine.push('b-fine')
      }),
    ])

    expect(ordine).toEqual(['a-inizio', 'a-fine', 'b-inizio', 'b-fine'])
  })

  it('un errore dentro il lock non blocca le operazioni successive', async () => {
    await expect(
      repo.withWriteLock(async () => {
        throw new Error('guasto')
      }),
    ).rejects.toThrow('guasto')

    await expect(repo.withWriteLock(async () => 'fatto')).resolves.toBe('fatto')
  })
})
