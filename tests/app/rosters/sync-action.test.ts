import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { SyncOutcome, SyncRosterInput } from '@/modules/calendar'
import { createTestDb } from '../../helpers/db'

/**
 * Il bottone che porta dalla conferma al calendario, visto dal lato che conta: chi
 * può premerlo. Google non viene mai toccata — `syncRoster` è sostituita da una spia
 * — perché quello che si misura qui non è il sync, che ha già i suoi test, ma la
 * barriera davanti al sync e quello che l utente legge dopo.
 */

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

const chiamate: SyncRosterInput[] = []
let esitoFinto: SyncOutcome

vi.mock('@/modules/calendar', async (importOriginal) => {
  const originale = await importOriginal<typeof import('@/modules/calendar')>()
  return {
    ...originale,
    syncRoster: async (input: SyncRosterInput) => {
      chiamate.push(input)
      return esitoFinto
    },
  }
})

function esitoRiuscito(over: Partial<SyncOutcome> = {}): SyncOutcome {
  return {
    ok: true,
    calendarId: 'turni@group.calendar.google.com',
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skipped: [],
    failures: [],
    foreignEvents: 0,
    outOfWindowEvents: 0,
    protectedEvents: 0,
    ...over,
  }
}

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let reviewActions: typeof import('@/app/rosters/[id]/review/actions')
let aliases: typeof import('@/modules/review/aliases')
let crypto: typeof import('@/lib/crypto')

let cristina: { id: string }
let sara: { id: string }
let anna: { id: string }
let rosterId: string

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64')
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
  process.env.APP_URL = 'https://turni.example.com'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  session = await import('@/modules/auth/session')
  aliases = await import('@/modules/review/aliases')
  reviewActions = await import('@/app/rosters/[id]/review/actions')
  crypto = await import('@/lib/crypto')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  cookieStore.clear()
  chiamate.length = 0
  esitoFinto = esitoRiuscito()

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
    ],
  })
  await aliases.assignColumnToUser('CRISTINA', cristina.id)
})

function modulo(columnLabel = 'CRISTINA'): FormData {
  const form = new FormData()
  form.set('rosterId', rosterId)
  form.set('columnLabel', columnLabel)
  return form
}

async function redirectDi(promise: Promise<unknown>): Promise<URL> {
  const errore = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  const messaggio = errore instanceof Error ? errore.message : String(errore)
  expect(messaggio).toMatch(/^REDIRECT:/)
  return new URL(messaggio.slice('REDIRECT:'.length), 'https://turni.example.com')
}

describe('syncColumnAction — chi può scrivere sul calendario, e chi no', () => {
  it('senza sessione manda al login e non chiama il sync', async () => {
    await expect(reviewActions.syncColumnAction(modulo())).rejects.toThrow('REDIRECT:/login')
    expect(chiamate).toEqual([])
  })

  it('sincronizza la propria colonna, e sul proprio utente', async () => {
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo()))

    expect(chiamate).toHaveLength(1)
    expect(chiamate[0].actor.id).toBe(cristina.id)
    expect(chiamate[0].targetUserId).toBe(cristina.id)
    expect(chiamate[0].rosterId).toBe(rosterId)
    expect(url.searchParams.get('sync')).toBeTruthy()
  })

  it("un'infermiera non sincronizza la colonna di un'altra: il sync non parte nemmeno", async () => {
    await session.openSessionCookie(sara.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo('CRISTINA')))

    expect(chiamate).toEqual([])
    expect(url.searchParams.get('error')).toBeTruthy()
  })

  it('nemmeno la referente sincronizza la colonna di un altra: scriverebbe sul suo calendario', async () => {
    await session.openSessionCookie(anna.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo('CRISTINA')))

    expect(chiamate).toEqual([])
    expect(url.searchParams.get('error')).toBeTruthy()
  })

  it('una colonna non associata a nessuno non si sincronizza', async () => {
    await aliases.clearColumnLabel('CRISTINA')
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo()))

    expect(chiamate).toEqual([])
    expect(url.searchParams.get('error')).toBeTruthy()
  })
})

describe('syncColumnAction — cosa legge l utente dopo', () => {
  it('dice quanti eventi creati, aggiornati, cancellati e invariati', async () => {
    esitoFinto = esitoRiuscito({ created: 12, updated: 2, deleted: 1, unchanged: 6 })
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo()))

    const messaggio = url.searchParams.get('sync') ?? ''
    expect(messaggio).toMatch(/Creati 12/)
    expect(messaggio).toMatch(/aggiornati 2/)
    expect(messaggio).toMatch(/cancellati 1/)
    expect(messaggio).toMatch(/invariati 6/)
  })

  it('dice quali turni sono stati saltati e perché', async () => {
    esitoFinto = esitoRiuscito({
      created: 1,
      skipped: [
        { date: '2026-08-07', code: 'RSF?', reason: 'codice_sconosciuto' },
        { date: '2026-08-09', code: 'M', reason: 'non_confermato' },
      ],
    })
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo()))

    const messaggio = url.searchParams.get('sync') ?? ''
    expect(messaggio).toMatch(/07\/08/)
    expect(messaggio).toMatch(/codice sconosciuto/)
    expect(messaggio).toMatch(/09\/08/)
    expect(messaggio).toMatch(/non confermat/)
  })

  it('quando il consenso Google è scaduto lo dichiara come tale, non come un errore tecnico', async () => {
    esitoFinto = {
      ...esitoRiuscito(),
      ok: false,
      calendarId: '',
      needsReauth: true,
      error: 'Il consenso Google va rinnovato: rifai il login',
    }
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo()))

    // `reauth` è ciò su cui la pagina mostra il bottone per riautorizzare: senza
    // questo l utente leggerebbe un messaggio e non saprebbe cosa fare.
    expect(url.searchParams.get('reauth')).toBe('1')
  })
})

describe('quando il calendario collegato non esiste piu', () => {
  async function conCalendarioSparito(userId: string) {
    await prisma.googleAccount.create({
      data: {
        userId,
        refreshToken: crypto.encryptSecret('refresh-123', `google_refresh:${userId}`),
        status: 'ok',
        calendarId: 'sparito',
      },
    })
  }

  it('il sync fallito con calendarMissing porta il flag nella query, come reauth', async () => {
    esitoFinto = esitoRiuscito({ ok: false, calendarId: '', calendarMissing: true, error: 'sparito' })
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.syncColumnAction(modulo()))

    expect(url.searchParams.get('calendarMissing')).toBe('1')
  })

  it('chi possiede la colonna puo ricollegare: l id salvato viene azzerato', async () => {
    await conCalendarioSparito(cristina.id)
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.relinkCalendarAction(modulo()))

    expect(url.searchParams.get('ok')).toMatch(/ricollegato|scollegato/i)
    const riga = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: cristina.id } })
    expect(riga.calendarId).toBeNull()
  })

  it('un altra infermiera non puo ricollegare il calendario di Cristina', async () => {
    await conCalendarioSparito(cristina.id)
    await session.openSessionCookie(sara.id)

    const url = await redirectDi(reviewActions.relinkCalendarAction(modulo()))

    expect(url.searchParams.get('error')).toBeTruthy()
    const riga = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: cristina.id } })
    expect(riga.calendarId).toBe('sparito')
  })

  it('nemmeno la referente: il calendario e della persona, come la conferma', async () => {
    await conCalendarioSparito(cristina.id)
    await session.openSessionCookie(anna.id)

    const url = await redirectDi(reviewActions.relinkCalendarAction(modulo()))

    expect(url.searchParams.get('error')).toBeTruthy()
    const riga = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: cristina.id } })
    expect(riga.calendarId).toBe('sparito')
  })
})

describe('removeAssignmentAction — «Togli dal calendario» toglie anche dal calendario', () => {
  function moduloGiorno(day: unknown, columnLabel = 'CRISTINA'): FormData {
    const form = new FormData()
    form.set('rosterId', rosterId)
    form.set('columnLabel', columnLabel)
    if (day !== undefined) form.set('day', String(day))
    return form
  }

  async function conferma(day: number, userId: string) {
    await prisma.assignment.create({
      data: {
        rosterId,
        userId,
        day,
        code: 'M',
        columnLabel: 'CRISTINA',
        confirmedAt: new Date('2026-08-01T08:00:00Z'),
        eventId: `ev-${day}`,
        syncState: 'synced',
      },
    })
  }

  it('cancellata l assegnazione lancia subito il sync della persona: l evento non ha altra via per sparire', async () => {
    await conferma(20, cristina.id)
    esitoFinto = esitoRiuscito({ deleted: 1 })
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.removeAssignmentAction(moduloGiorno(20)))

    // Il gesto si chiama «Togli dal calendario»: la scrittura su Google è esplicita
    // (regola invariante 1), e senza questo sync l evento resterebbe là per sempre.
    expect(chiamate).toHaveLength(1)
    expect(chiamate[0]).toMatchObject({ targetUserId: cristina.id, rosterId })
    expect(url.searchParams.get('ok')).toMatch(/Giorno 20 tolto/)
    expect(url.searchParams.get('sync')).toMatch(/cancellati 1/)
    expect(await prisma.assignment.count({ where: { userId: cristina.id } })).toBe(0)
  })

  it('porta reauth e calendarMissing come il bottone di invio', async () => {
    await conferma(20, cristina.id)
    esitoFinto = esitoRiuscito({ ok: false, calendarId: '', needsReauth: true, calendarMissing: true, error: 'consenso' })
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.removeAssignmentAction(moduloGiorno(20)))

    expect(url.searchParams.get('reauth')).toBe('1')
    expect(url.searchParams.get('calendarMissing')).toBe('1')
  })

  it('su un giorno senza niente da togliere non chiama il sync e lo dice', async () => {
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.removeAssignmentAction(moduloGiorno(21)))

    expect(chiamate).toEqual([])
    expect(url.searchParams.get('error')).toMatch(/Niente da togliere per il giorno 21/)
  })

  it('senza il giorno è una richiesta incompleta: "" non vale come giorno', async () => {
    await session.openSessionCookie(cristina.id)

    const url = await redirectDi(reviewActions.removeAssignmentAction(moduloGiorno('')))

    expect(chiamate).toEqual([])
    expect(url.searchParams.get('error')).toMatch(/incompleta/i)
  })
})
