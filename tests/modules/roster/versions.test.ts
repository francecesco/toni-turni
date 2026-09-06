import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let versions: typeof import('@/modules/roster/versions')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  versions = await import('@/modules/roster/versions')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
})

async function tabella(version: number, over: { month?: number; ward?: string; status?: string } = {}) {
  return prisma.roster.create({
    data: {
      year: 2026,
      month: over.month ?? 9,
      ward: over.ward ?? '3°PIANO',
      version,
      imagePath: `v${version}.jpg`,
      status: over.status ?? 'extracted',
    },
  })
}

describe('previousVersionOf', () => {
  it('sulla prima versione non c è niente prima', async () => {
    const v1 = await tabella(1)
    expect(await versions.previousVersionOf(v1.id)).toBeNull()
  })

  it('restituisce la versione immediatamente inferiore dello stesso mese e reparto', async () => {
    const v1 = await tabella(1)
    await tabella(2)
    const v3 = await tabella(3)
    const prima = await versions.previousVersionOf(v3.id)
    expect(prima?.version).toBe(2)
    expect(prima?.id).not.toBe(v1.id)
  })

  it('non confonde un altro mese o un altro reparto', async () => {
    await tabella(1, { month: 8 })
    await tabella(1, { ward: '2°PIANO' })
    const v2 = await tabella(2)
    // v1 di settembre 3°PIANO non esiste: prima di v2 non c è niente
    expect(await versions.previousVersionOf(v2.id)).toBeNull()
  })

  it('con un id inesistente risponde null, non lancia', async () => {
    expect(await versions.previousVersionOf('non-esiste')).toBeNull()
  })
})

describe('cellsForDiff', () => {
  it('restituisce le celle con lettura, correzione a mano e provenienza', async () => {
    const v1 = await tabella(1)
    await prisma.rosterCell.create({
      data: {
        rosterId: v1.id,
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M',
        code: 'M',
        confidence: 0.9,
        correctedCode: 'P',
        correctedAt: new Date('2026-09-01T10:00:00Z'),
        correctedBy: 'anna',
      },
    })

    const celle = await versions.cellsForDiff(v1.id)

    expect(celle).toEqual([
      {
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M',
        code: 'M',
        correctedCode: 'P',
        correctedAt: new Date('2026-09-01T10:00:00Z'),
        correctedBy: 'anna',
      },
    ])
  })
})
