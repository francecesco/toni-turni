import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let reviewActions: typeof import('@/app/rosters/[id]/review/actions')
let columnsActions: typeof import('@/app/rosters/[id]/columns/actions')
let aliases: typeof import('@/modules/review/aliases')

let cristina: { id: string }
let sara: { id: string }
let anna: { id: string }
let rosterId: string

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  session = await import('@/modules/auth/session')
  aliases = await import('@/modules/review/aliases')
  reviewActions = await import('@/app/rosters/[id]/review/actions')
  columnsActions = await import('@/app/rosters/[id]/columns/actions')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  cookieStore.clear()
  await prisma.assignment.deleteMany()
  await prisma.columnAlias.deleteMany()
  await prisma.rosterCell.deleteMany()
  await prisma.rosterBand.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()
  await prisma.shiftCode.deleteMany()
  await prisma.shiftCode.createMany({
    data: [
      { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
      { code: 'P', label: 'Pomeriggio', kind: 'work', startTime: '14:00', endTime: '21:00' },
    ],
  })

  cristina = await prisma.user.create({
    data: { email: 'cri@example.com', displayName: 'Cristina', role: 'NURSE' },
  })
  sara = await prisma.user.create({
    data: { email: 'sara@example.com', displayName: 'Sara', role: 'NURSE' },
  })
  anna = await prisma.user.create({
    data: { email: 'anna@example.com', displayName: 'Anna', role: 'REFERENTE' },
  })

  const roster = await prisma.roster.create({
    data: { year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg', status: 'extracted' },
  })
  rosterId = roster.id
  await prisma.rosterCell.createMany({
    data: [
      { rosterId, day: 1, columnLabel: 'CRISTINA', rawCode: 'M', code: 'M', confidence: 0.9 },
      { rosterId, day: 2, columnLabel: 'CRISTINA', rawCode: 'P', code: 'P', confidence: 0.9 },
      { rosterId, day: 3, columnLabel: 'CRISTINA', rawCode: 'RSF?', code: null, confidence: 0.9 },
    ],
  })
  await aliases.assignColumnToUser('CRISTINA', cristina.id)
})

function moduloGiorno(day: number, columnLabel = 'CRISTINA'): FormData {
  const form = new FormData()
  form.set('rosterId', rosterId)
  form.set('columnLabel', columnLabel)
  form.set('day', String(day))
  return form
}

function moduloColonna(columnLabel = 'CRISTINA'): FormData {
  const form = new FormData()
  form.set('rosterId', rosterId)
  form.set('columnLabel', columnLabel)
  return form
}

describe('confirmDayAction — chi può confermare, e chi no', () => {
  it('senza sessione manda al login e non scrive nulla', async () => {
    await expect(reviewActions.confirmDayAction(moduloGiorno(1))).rejects.toThrow(
      'REDIRECT:/login',
    )
    expect(await prisma.assignment.count()).toBe(0)
  })

  it("un'infermiera conferma il proprio turno e l'assegnazione nasce confermata", async () => {
    await session.openSessionCookie(cristina.id)

    await reviewActions.confirmDayAction(moduloGiorno(1))

    const riga = await prisma.assignment.findFirstOrThrow()
    expect(riga.userId).toBe(cristina.id)
    expect(riga.code).toBe('M')
    expect(riga.syncState).toBe('confirmed')
    expect(riga.confirmedAt).not.toBeNull()
  })

  it("un'infermiera che chiama l'azione sulla colonna di un'altra viene respinta e non scrive nulla", async () => {
    await session.openSessionCookie(sara.id)

    await expect(reviewActions.confirmDayAction(moduloGiorno(1, 'CRISTINA'))).rejects.toThrow(
      /REDIRECT:.*error=/,
    )
    expect(await prisma.assignment.count()).toBe(0)
  })

  it('nemmeno la referente conferma la colonna di un altra: il calendario è di chi lo possiede', async () => {
    await session.openSessionCookie(anna.id)

    await expect(reviewActions.confirmDayAction(moduloGiorno(1, 'CRISTINA'))).rejects.toThrow(
      /REDIRECT:.*error=/,
    )
    expect(await prisma.assignment.count()).toBe(0)
  })

  it('un codice sconosciuto viene rifiutato con un messaggio e non diventa un turno', async () => {
    await session.openSessionCookie(cristina.id)

    await expect(reviewActions.confirmDayAction(moduloGiorno(3))).rejects.toThrow(
      /REDIRECT:.*error=/,
    )
    expect(await prisma.assignment.count()).toBe(0)
  })

  it('una colonna non associata a nessuno non si conferma', async () => {
    await aliases.clearColumnLabel('CRISTINA')
    await session.openSessionCookie(cristina.id)

    await expect(reviewActions.confirmDayAction(moduloGiorno(1))).rejects.toThrow(
      /REDIRECT:.*error=/,
    )
    expect(await prisma.assignment.count()).toBe(0)
  })
})

describe('confirmColumnAction', () => {
  it('conferma tutti i turni confermabili e dichiara quelli rifiutati', async () => {
    await session.openSessionCookie(cristina.id)

    await expect(reviewActions.confirmColumnAction(moduloColonna())).rejects.toThrow(
      /REDIRECT:.*ok=/,
    )

    const righe = await prisma.assignment.findMany()
    expect(righe.map((r) => r.day).sort()).toEqual([1, 2])
  })

  it("respinge un'infermiera sulla colonna di un'altra senza scrivere nulla", async () => {
    await session.openSessionCookie(sara.id)

    await expect(reviewActions.confirmColumnAction(moduloColonna())).rejects.toThrow(
      /REDIRECT:.*error=/,
    )
    expect(await prisma.assignment.count()).toBe(0)
  })
})

describe('unconfirmDayAction', () => {
  it('riporta a bozza il proprio turno confermato', async () => {
    await session.openSessionCookie(cristina.id)
    await reviewActions.confirmDayAction(moduloGiorno(1))

    await reviewActions.unconfirmDayAction(moduloGiorno(1))

    const riga = await prisma.assignment.findFirstOrThrow()
    expect(riga.confirmedAt).toBeNull()
    expect(riga.syncState).toBe('draft')
  })

  it("non lascia un'altra infermiera togliere una conferma non sua", async () => {
    await session.openSessionCookie(cristina.id)
    await reviewActions.confirmDayAction(moduloGiorno(1))
    await session.openSessionCookie(sara.id)

    await expect(reviewActions.unconfirmDayAction(moduloGiorno(1))).rejects.toThrow(
      /REDIRECT:.*error=/,
    )
    const riga = await prisma.assignment.findFirstOrThrow()
    expect(riga.confirmedAt).not.toBeNull()
  })
})

describe('saveColumnAlias — solo la referente associa le colonne', () => {
  function moduloAlias(label: string, userId: string): FormData {
    const form = new FormData()
    form.set('rosterId', rosterId)
    form.set('label', label)
    form.set('userId', userId)
    return form
  }

  it("un'infermiera viene rimandata alla home e non associa nulla", async () => {
    await session.openSessionCookie(cristina.id)

    await expect(columnsActions.saveColumnAlias(moduloAlias('SARA DP.', sara.id))).rejects.toThrow(
      'REDIRECT:/',
    )
    expect(await prisma.columnAlias.count({ where: { label: 'SARA DP.' } })).toBe(0)
  })

  it('la referente associa una colonna a una persona', async () => {
    await session.openSessionCookie(anna.id)

    await columnsActions.saveColumnAlias(moduloAlias('SARA DP.', sara.id))

    expect(await aliases.aliasFor('SARA DP.')).toEqual({
      label: 'SARA DP.',
      userId: sara.id,
      ignored: false,
    })
  })

  it('la referente marca una colonna come non-turno', async () => {
    await session.openSessionCookie(anna.id)

    await columnsActions.saveColumnAlias(moduloAlias('TOT M', 'ignora'))

    expect(await aliases.aliasFor('TOT M')).toEqual({
      label: 'TOT M',
      userId: null,
      ignored: true,
    })
  })

  it('scegliendo "da assegnare" la colonna torna libera', async () => {
    await session.openSessionCookie(anna.id)

    await columnsActions.saveColumnAlias(moduloAlias('CRISTINA', ''))

    expect(await aliases.aliasFor('CRISTINA')).toBeNull()
  })

  it('un utente inesistente viene rifiutato invece di creare un alias appeso al nulla', async () => {
    await session.openSessionCookie(anna.id)

    await expect(
      columnsActions.saveColumnAlias(moduloAlias('SARA DP.', 'utente-che-non-esiste')),
    ).rejects.toThrow(/REDIRECT:.*error=/)
    expect(await aliases.aliasFor('SARA DP.')).toBeNull()
  })
})
