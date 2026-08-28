import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let repo: typeof import('@/modules/calendar/repository')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  repo = await import('@/modules/calendar/repository')
})

afterAll(async () => {
  await db.cleanup()
})

async function seedBase() {
  await prisma.assignment.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()

  await prisma.user.createMany({
    data: [
      { id: 'utente1', email: 'anna@example.com', displayName: 'Anna' },
      { id: 'utente2', email: 'mery@example.com', displayName: 'Mery' },
    ],
  })
  await prisma.roster.create({
    data: {
      id: 'roster1',
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      version: 1,
      imagePath: 'a.jpg',
      status: 'extracted',
    },
  })
}

beforeEach(seedBase)

async function assegna(over: {
  id: string
  userId?: string
  day: number
  code: string
  confirmed?: boolean
  eventId?: string | null
}) {
  await prisma.assignment.create({
    data: {
      id: over.id,
      userId: over.userId ?? 'utente1',
      rosterId: 'roster1',
      day: over.day,
      code: over.code,
      confirmedAt: (over.confirmed ?? true) ? new Date('2026-07-30T10:00:00Z') : null,
      eventId: over.eventId ?? null,
      syncState: (over.confirmed ?? true) ? 'confirmed' : 'draft',
    },
  })
}

describe('listAssignmentsForSync', () => {
  it('trasforma i giorni di tabella in date locali e riporta la conferma', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await assegna({ id: 'a2', day: 31, code: 'NOTTE', confirmed: false })

    const turni = await repo.listAssignmentsForSync({
      userId: 'utente1',
      rosterId: 'roster1',
      year: 2026,
      month: 8,
    })

    expect(turni).toEqual([
      { id: 'a1', date: '2026-08-01', code: 'M', confirmed: true, eventId: null },
      { id: 'a2', date: '2026-08-31', code: 'NOTTE', confirmed: false, eventId: null },
    ])
  })

  it('non restituisce le assegnazioni di un altra utente', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await assegna({ id: 'a2', userId: 'utente2', day: 1, code: 'P' })

    const turni = await repo.listAssignmentsForSync({
      userId: 'utente1',
      rosterId: 'roster1',
      year: 2026,
      month: 8,
    })

    expect(turni.map((t) => t.id)).toEqual(['a1'])
  })

  it('riporta l eventId già sincronizzato', async () => {
    await assegna({ id: 'a1', day: 5, code: 'M', eventId: 'ev5' })

    const [turno] = await repo.listAssignmentsForSync({
      userId: 'utente1',
      rosterId: 'roster1',
      year: 2026,
      month: 8,
    })

    expect(turno.eventId).toBe('ev5')
  })
})

describe('registrazione dell esito', () => {
  it('salva id evento e stato dopo una scrittura riuscita', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })

    await repo.recordSynced('a1', 'ev1')

    const riga = await prisma.assignment.findUniqueOrThrow({ where: { id: 'a1' } })
    expect(riga.eventId).toBe('ev1')
    expect(riga.syncState).toBe('synced')
    expect(riga.syncError).toBeNull()
    expect(riga.syncedAt).not.toBeNull()
  })

  it('cancella un errore precedente quando la scrittura poi riesce', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await repo.recordFailure('a1', 'quota superata')
    await repo.recordSynced('a1', 'ev1')

    const riga = await prisma.assignment.findUniqueOrThrow({ where: { id: 'a1' } })
    expect(riga.syncState).toBe('synced')
    expect(riga.syncError).toBeNull()
  })

  it('registra il guasto senza perdere l eventId già noto', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M', eventId: 'ev1' })

    await repo.recordFailure('a1', 'quota superata')

    const riga = await prisma.assignment.findUniqueOrThrow({ where: { id: 'a1' } })
    expect(riga.syncState).toBe('failed')
    expect(riga.syncError).toBe('quota superata')
    expect(riga.eventId).toBe('ev1')
  })

  it('non fallisce se l assegnazione è scomparsa nel frattempo', async () => {
    await expect(repo.recordSynced('inesistente', 'ev1')).resolves.toBeUndefined()
    await expect(repo.recordFailure('inesistente', 'x')).resolves.toBeUndefined()
  })
})
