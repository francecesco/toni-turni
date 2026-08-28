import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import type { Extraction } from '@/modules/extract/schema'

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
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.shiftCode.deleteMany()
  await prisma.shiftCode.createMany({
    data: [
      { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
      { code: 'M RSF', label: 'Mattino RSF', kind: 'work', startTime: '07:00', endTime: '14:00' },
    ],
  })
})

function estrazione(cells: Extraction['cells']): Extraction {
  return { year: 2026, month: 8, ward: '3°PIANO', columns: ['RENATA', 'MERY'], cells }
}

describe('createRoster', () => {
  it('crea la prima versione', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    expect(r.version).toBe(1)
  })

  it('incrementa la versione per lo stesso mese e reparto', async () => {
    await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    const seconda = await repo.createRoster({
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      imagePath: 'b.jpg',
    })
    expect(seconda.version).toBe(2)
  })
})

describe('saveExtraction', () => {
  it('salva le celle risolvendo i codici con la legenda', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    const esito = await repo.saveExtraction(
      r.id,
      estrazione([
        { day: 1, column: 'RENATA', code: 'M', confidence: 0.99, handCorrected: false },
        { day: 2, column: 'RENATA', code: 'm rsf', confidence: 0.7, handCorrected: false },
      ]),
      { provider: 'groq', rawOutput: '{...}' },
    )

    expect(esito).toEqual({ cells: 2, unresolved: 0 })
    const celle = await prisma.rosterCell.findMany({ orderBy: { day: 'asc' } })
    expect(celle[0].code).toBe('M')
    // il codice grezzo resta come letto, quello risolto è la forma canonica
    expect(celle[1].rawCode).toBe('m rsf')
    expect(celle[1].code).toBe('M RSF')
  })

  it('lascia il codice non risolto quando la legenda non lo conosce, senza fallire', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    const esito = await repo.saveExtraction(
      r.id,
      estrazione([{ day: 1, column: 'MERY', code: 'XYZ', confidence: 0.3, handCorrected: true }]),
      { provider: 'groq', rawOutput: '{...}' },
    )

    expect(esito).toEqual({ cells: 1, unresolved: 1 })
    const cella = await prisma.rosterCell.findFirstOrThrow()
    expect(cella.rawCode).toBe('XYZ')
    expect(cella.code).toBeNull()
    expect(cella.handCorrected).toBe(true)
  })

  it('salta le celle vuote invece di crearle', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    const esito = await repo.saveExtraction(
      r.id,
      estrazione([
        { day: 1, column: 'RENATA', code: '', confidence: 0.9, handCorrected: false },
        { day: 2, column: 'RENATA', code: '  ', confidence: 0.9, handCorrected: false },
      ]),
      { provider: 'groq', rawOutput: '{}' },
    )

    expect(esito.cells).toBe(0)
    expect(await prisma.rosterCell.count()).toBe(0)
  })

  it('porta la tabella nello stato extracted e conserva provider e output grezzo', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    await repo.saveExtraction(r.id, estrazione([]), { provider: 'groq', rawOutput: 'RAW' })

    const salvata = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvata.status).toBe('extracted')
    expect(salvata.provider).toBe('groq')
    expect(salvata.rawOutput).toBe('RAW')
  })

  it('è ripetibile: rieseguirla sostituisce le celle invece di duplicarle', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    const cells = [{ day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false }]

    await repo.saveExtraction(r.id, estrazione(cells), { provider: 'groq', rawOutput: 'a' })
    await repo.saveExtraction(r.id, estrazione(cells), { provider: 'groq', rawOutput: 'b' })

    expect(await prisma.rosterCell.count({ where: { rosterId: r.id } })).toBe(1)
  })
})

describe('markExtractionFailed', () => {
  it('porta la tabella nello stato failed conservando l output grezzo', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    await repo.markExtractionFailed(r.id, 'output illeggibile')

    const salvata = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvata.status).toBe('failed')
    expect(salvata.rawOutput).toBe('output illeggibile')
  })
})

describe('getRosterWithCells', () => {
  it('restituisce la tabella con le celle ordinate per giorno e colonna', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    await repo.saveExtraction(
      r.id,
      estrazione([
        { day: 2, column: 'MERY', code: 'M', confidence: 1, handCorrected: false },
        { day: 1, column: 'RENATA', code: 'M', confidence: 1, handCorrected: false },
      ]),
      { provider: 'groq', rawOutput: '{}' },
    )

    const caricata = await repo.getRosterWithCells(r.id)

    expect(caricata?.cells.map((c) => c.day)).toEqual([1, 2])
  })

  it('restituisce null per un id inesistente', async () => {
    expect(await repo.getRosterWithCells('non-esiste')).toBeNull()
  })
})

describe('getRosterMonth', () => {
  it('restituisce mese, anno, reparto e versione della tabella', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    await expect(repo.getRosterMonth(r.id)).resolves.toEqual({
      id: r.id,
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      version: 1,
    })
  })

  it('restituisce null per un id inesistente', async () => {
    expect(await repo.getRosterMonth('non-esiste')).toBeNull()
  })
})
