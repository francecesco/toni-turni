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

  it('segna il conflitto fra due bande sovrapposte che leggono la stessa cella diversamente', async () => {
    const r = await prisma.roster.create({ data: roster({ year: 2029 }) })
    const cell = await prisma.rosterCell.create({
      data: {
        rosterId: r.id,
        day: 7,
        columnLabel: 'CRISTINA',
        rawCode: 'M',
        confidence: 0.9,
        conflicted: true,
        conflictWith: 'P',
        bandIndex: 2,
      },
    })
    expect(cell.conflicted).toBe(true)
    expect(cell.conflictWith).toBe('P')
    expect(cell.bandIndex).toBe(2)
  })
})

describe('RosterBand', () => {
  it('nasce pendente e diventa il conto di ciò che manca', async () => {
    const r = await prisma.roster.create({ data: roster({ year: 2030 }) })
    const banda = await prisma.rosterBand.create({ data: { rosterId: r.id, index: 0 } })

    expect(banda.status).toBe('pending')
    expect(banda.attempts).toBe(0)
  })

  it('rifiuta due bande con lo stesso indice nella stessa tabella', async () => {
    const r = await prisma.roster.create({ data: roster({ year: 2031 }) })
    await prisma.rosterBand.create({ data: { rosterId: r.id, index: 3 } })

    await expect(prisma.rosterBand.create({ data: { rosterId: r.id, index: 3 } })).rejects.toThrow()
  })
})

describe('ColumnAlias', () => {
  it('associa un nome di colonna a un utente, una volta sola', async () => {
    const utente = await prisma.user.create({
      data: { email: 'cri@example.com', displayName: 'Cristina' },
    })
    const alias = await prisma.columnAlias.create({
      data: { label: 'CRISTINA', userId: utente.id },
    })

    expect(alias.ignored).toBe(false)
    await expect(
      prisma.columnAlias.create({ data: { label: 'CRISTINA', userId: utente.id } }),
    ).rejects.toThrow()
  })

  it('permette una colonna ignorata senza utente (TOT M, AIUTO POM.)', async () => {
    const alias = await prisma.columnAlias.create({ data: { label: 'TOT M', ignored: true } })

    expect(alias.userId).toBeNull()
    expect(alias.ignored).toBe(true)
  })
})

describe('Assignment', () => {
  it('nasce in stato draft e diventa confirmed solo con una conferma esplicita', async () => {
    const utente = await prisma.user.create({
      data: { email: 'sara@example.com', displayName: 'Sara' },
    })
    const r = await prisma.roster.create({ data: roster({ year: 2032 }) })

    const assegnazione = await prisma.assignment.create({
      data: { userId: utente.id, rosterId: r.id, day: 4, columnLabel: 'SARA', code: 'M' },
    })

    expect(assegnazione.syncState).toBe('draft')
    expect(assegnazione.confirmedAt).toBeNull()
    expect(assegnazione.eventId).toBeNull()
  })

  it('rifiuta due assegnazioni per la stessa persona, la stessa tabella e lo stesso giorno', async () => {
    const utente = await prisma.user.create({
      data: { email: 'mery@example.com', displayName: 'Mery' },
    })
    const r = await prisma.roster.create({ data: roster({ year: 2033 }) })
    const data = { userId: utente.id, rosterId: r.id, day: 9, columnLabel: 'MERY', code: 'P' }

    await prisma.assignment.create({ data })
    await expect(prisma.assignment.create({ data })).rejects.toThrow()
  })
})
