import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let repo: typeof import('@/modules/codes/repository')
let dbModule: typeof import('@/lib/db')

beforeAll(async () => {
  db = createTestDb()
  // Il singleton di @/lib/db legge DATABASE_URL alla costruzione: va impostato prima
  // dell'import, e la cache globale usata in sviluppo va azzerata.
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  dbModule = await import('@/lib/db')
  repo = await import('@/modules/codes/repository')
})

afterAll(async () => {
  await dbModule.prisma.$disconnect()
  await db.cleanup()
})

describe('upsertShiftCode', () => {
  it('crea un codice nuovo e lo restituisce come ShiftCodeDef', async () => {
    const created = await repo.upsertShiftCode({
      code: 'TEST',
      label: 'Turno di prova',
      kind: 'work',
      startTime: '07:00',
      endTime: '14:00',
      crossesMidnight: false,
      location: null,
      color: null,
      needsReview: false,
    })

    expect(created.code).toBe('TEST')
    expect(created.kind).toBe('work')
    expect(created.startTime).toBe('07:00')
    expect(created.endTime).toBe('14:00')
    expect(created.crossesMidnight).toBe(false)
  })

  it('chiamato di nuovo sullo stesso code aggiorna invece di duplicare', async () => {
    await repo.upsertShiftCode({
      code: 'UPD',
      label: 'Turno da aggiornare',
      kind: 'work',
      startTime: '07:00',
      endTime: '14:00',
      crossesMidnight: false,
      location: null,
      color: null,
      needsReview: false,
    })

    await repo.upsertShiftCode({
      code: 'UPD',
      label: 'Turno da aggiornare',
      kind: 'work',
      startTime: '07:00',
      endTime: '13:30',
      crossesMidnight: false,
      location: null,
      color: null,
      needsReview: false,
    })

    const all = await repo.listShiftCodes()
    const matches = all.filter((def) => def.code === 'UPD')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.endTime).toBe('13:30')
  })
})

describe('listShiftCodes', () => {
  it('restituisce i codici ordinati per code crescente', async () => {
    for (const code of ['ZORD', 'AORD', 'MORD']) {
      await repo.upsertShiftCode({
        code,
        label: code,
        kind: 'work',
        startTime: '07:00',
        endTime: '14:00',
        crossesMidnight: false,
        location: null,
        color: null,
        needsReview: false,
      })
    }

    const all = await repo.listShiftCodes()
    const codes = all.map((def) => def.code)
    expect(codes).toEqual([...codes].sort())
  })

  it('normalizza a "unknown" un kind non valido letto dal database', async () => {
    await db.prisma.shiftCode.create({
      data: { code: 'XX', label: 'Inventato', kind: 'inventato' },
    })

    const all = await repo.listShiftCodes()
    const invented = all.find((def) => def.code === 'XX')
    expect(invented?.kind).toBe('unknown')
  })
})

describe('deleteShiftCode', () => {
  it('cancella un codice esistente', async () => {
    await repo.upsertShiftCode({
      code: 'DEL',
      label: 'Da cancellare',
      kind: 'work',
      startTime: '07:00',
      endTime: '14:00',
      crossesMidnight: false,
      location: null,
      color: null,
      needsReview: false,
    })

    await repo.deleteShiftCode('DEL')

    const all = await repo.listShiftCodes()
    expect(all.find((def) => def.code === 'DEL')).toBeUndefined()
  })
})
