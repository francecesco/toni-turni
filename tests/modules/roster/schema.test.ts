import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient

beforeAll(() => {
  db = createTestDb()
  prisma = db.prisma
})

afterAll(async () => {
  await db.cleanup()
})

function roster(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    imagePath: 'uploads/x.jpg',
    status: 'uploaded',
    ...overrides,
  }
}

describe('Roster', () => {
  it('nasce alla versione 1 con stato uploaded', async () => {
    const created = await prisma.roster.create({ data: roster() })
    expect(created.version).toBe(1)
    expect(created.status).toBe('uploaded')
    expect(created.rawOutput).toBeNull()
  })

  it('permette due versioni dello stesso mese e reparto', async () => {
    await prisma.roster.create({ data: roster({ month: 9 }) })
    const seconda = await prisma.roster.create({ data: roster({ month: 9, version: 2 }) })
    expect(seconda.version).toBe(2)
  })

  it('rifiuta due volte la stessa versione dello stesso mese e reparto', async () => {
    await prisma.roster.create({ data: roster({ month: 10 }) })
    await expect(prisma.roster.create({ data: roster({ month: 10 }) })).rejects.toThrow()
  })
})

describe('RosterCell', () => {
  it('conserva codice grezzo, codice risolto, confidenza e correzione a penna', async () => {
    const r = await prisma.roster.create({ data: roster({ month: 11 }) })
    const cell = await prisma.rosterCell.create({
      data: {
        rosterId: r.id,
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M 1°P',
        code: 'M1°P',
        confidence: 0.42,
        handCorrected: true,
      },
    })
    expect(cell.rawCode).toBe('M 1°P')
    expect(cell.code).toBe('M1°P')
    expect(cell.confidence).toBeCloseTo(0.42)
    expect(cell.handCorrected).toBe(true)
  })

  it('accetta un codice non risolto', async () => {
    const r = await prisma.roster.create({ data: roster({ month: 12 }) })
    const cell = await prisma.rosterCell.create({
      data: { rosterId: r.id, day: 1, columnLabel: 'ALEX', rawCode: '???', confidence: 0.1, handCorrected: false },
    })
    expect(cell.code).toBeNull()
  })

  it('rifiuta due celle per lo stesso giorno e la stessa colonna', async () => {
    const r = await prisma.roster.create({ data: roster({ year: 2027 }) })
    const data = { rosterId: r.id, day: 5, columnLabel: 'RENATA', rawCode: 'M', confidence: 1, handCorrected: false }
    await prisma.rosterCell.create({ data })
    await expect(prisma.rosterCell.create({ data })).rejects.toThrow()
  })

  it('cancella le celle insieme alla tabella', async () => {
    const r = await prisma.roster.create({ data: roster({ year: 2028 }) })
    await prisma.rosterCell.create({
      data: { rosterId: r.id, day: 1, columnLabel: 'F', rawCode: 'M', confidence: 1, handCorrected: false },
    })

    await prisma.roster.delete({ where: { id: r.id } })

    expect(await prisma.rosterCell.count({ where: { rosterId: r.id } })).toBe(0)
  })
})
