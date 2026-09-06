import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import { ROME_TZ, wallClockToUtc } from '@/lib/time'
import type { CalendarApi } from '@/modules/calendar/api'
import { CalendarApiError, CalendarRefusedError } from '@/modules/calendar/api'
import { DEDICATED_CALENDAR_SUMMARY } from '@/modules/calendar/dedicated'
import type { EventPayload, ExistingEvent } from '@/modules/calendar/types'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let sync: typeof import('@/modules/calendar/sync')
let crypto: typeof import('@/lib/crypto')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64')
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
  process.env.APP_URL = 'https://turni.example.com'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  sync = await import('@/modules/calendar/sync')
  crypto = await import('@/lib/crypto')
})

afterAll(async () => {
  await db.cleanup()
})

const CODICI = [
  { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
  { code: 'P', label: 'Pomeriggio', kind: 'work', startTime: '14:00', endTime: '21:00' },
  {
    code: 'NOTTE',
    label: 'Notte',
    kind: 'work',
    startTime: '21:00',
    endTime: '07:00',
    crossesMidnight: true,
  },
  { code: 'RIP', label: 'Riposo', kind: 'info', startTime: null, endTime: null },
]

beforeEach(async () => {
  await prisma.assignment.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.googleAccount.deleteMany()
  await prisma.user.deleteMany()
  await prisma.shiftCode.deleteMany()

  await prisma.shiftCode.createMany({ data: CODICI })
  await prisma.user.createMany({
    data: [
      { id: 'utente1', email: 'anna@example.com', displayName: 'Anna', role: 'NURSE' },
      { id: 'referente', email: 'capo@example.com', displayName: 'Capo', role: 'REFERENTE' },
    ],
  })
  await prisma.googleAccount.create({
    data: {
      userId: 'utente1',
      refreshToken: crypto.encryptSecret('refresh-123', 'google_refresh:utente1'),
      status: 'ok',
    },
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
})

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

/** Come Google restituisce un evento che abbiamo appena scritto noi. */
function comeSuGoogle(id: string, payload: EventPayload): ExistingEvent {
  const tempo = (value: EventPayload['start']) =>
    'dateTime' in value
      ? { dateTime: wallClockToUtc(value.dateTime, value.timeZone).toISOString(), timeZone: ROME_TZ }
      : { date: value.date }

  return {
    id,
    status: 'confirmed',
    summary: payload.summary,
    description: payload.description,
    location: payload.location ?? null,
    transparency: payload.transparency,
    start: tempo(payload.start),
    end: tempo(payload.end),
    extendedProperties: { private: { ...payload.extendedProperties.private } },
  }
}

/** Calendario Google finto, in memoria. Nessuna rete, e registra ogni chiamata. */
function calendarioFinto(
  options: { calendars?: { id: string; summary: string }[]; failInsert?: Error } = {},
) {
  const events = new Map<string, ExistingEvent>()
  const calendars = new Map((options.calendars ?? []).map((c) => [c.id, c]))
  const calls: string[] = []
  let seq = 0

  const api: CalendarApi = {
    listCalendars: async () => {
      calls.push('listCalendars')
      return [...calendars.values()]
    },
    getCalendar: async (id) => {
      calls.push(`getCalendar:${id}`)
      return calendars.get(id) ?? null
    },
    createCalendar: async ({ summary }) => {
      calls.push('createCalendar')
      const creato = { id: 'cal-nuovo', summary }
      calendars.set(creato.id, creato)
      return creato
    },
    listEvents: async ({ calendarId }) => {
      calls.push(`listEvents:${calendarId}`)
      return [...events.values()]
    },
    insertEvent: async ({ calendarId, payload }) => {
      calls.push(`insert:${payload.extendedProperties.private.shiftKey}`)
      if (calendarId === 'primary') throw new CalendarRefusedError('primary')
      if (options.failInsert) throw options.failInsert
      seq += 1
      const id = `ev${seq}`
      events.set(id, comeSuGoogle(id, payload))
      return { id }
    },
    patchEvent: async ({ eventId, payload }) => {
      calls.push(`patch:${eventId}`)
      events.set(eventId, comeSuGoogle(eventId, payload))
      return { id: eventId }
    },
    deleteEvent: async ({ eventId, expectedUserId }) => {
      calls.push(`delete:${eventId}`)
      const evento = events.get(eventId)
      const shiftKey = evento?.extendedProperties?.private?.shiftKey
      if (!shiftKey || (expectedUserId && !shiftKey.startsWith(`${expectedUserId}:`))) {
        throw new CalendarRefusedError('senza shiftKey')
      }
      events.delete(eventId)
    },
  }

  return {
    api,
    calls,
    events,
    /** Aggiunge un evento non nostro, come un appuntamento personale. */
    aggiungiPersonale(id: string, summary: string) {
      events.set(id, { id, summary })
    },
    aggiungiEvento(id: string, event: ExistingEvent) {
      events.set(id, event)
    },
    scritture() {
      return calls.filter((c) => /^(insert|patch|delete):/.test(c))
    },
  }
}

function esegui(
  finto: ReturnType<typeof calendarioFinto>,
  over: { actor?: { id: string; role: 'NURSE' | 'REFERENTE' }; targetUserId?: string } = {},
) {
  return sync.syncRoster({
    actor: over.actor ?? { id: 'utente1', role: 'NURSE' },
    targetUserId: over.targetUserId ?? 'utente1',
    rosterId: 'roster1',
    apiFactory: async () => finto.api,
  })
}

describe('syncRoster — primo sync', () => {
  it('crea gli eventi dei turni confermati e salva id e stato', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await assegna({ id: 'a2', day: 2, code: 'NOTTE' })
    const finto = calendarioFinto()

    const esito = await esegui(finto)

    expect(esito.ok).toBe(true)
    expect(esito.created).toBe(2)
    expect(esito.calendarId).toBe('cal-nuovo')

    const righe = await prisma.assignment.findMany({ orderBy: { day: 'asc' } })
    expect(righe.map((r) => r.syncState)).toEqual(['synced', 'synced'])
    expect(righe.every((r) => r.eventId !== null)).toBe(true)

    // La notte finisce alle 07:00 del giorno dopo, anche passata da Google.
    const notte = [...finto.events.values()].find(
      (e) => e.extendedProperties?.private?.shiftKey === 'utente1:2026-08-02',
    )
    expect(notte?.start?.dateTime).toBe('2026-08-02T19:00:00.000Z')
    expect(notte?.end?.dateTime).toBe('2026-08-03T05:00:00.000Z')
  })

  it('crea il calendario dedicato e lo memorizza sull account', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()

    await esegui(finto)

    expect(finto.calls).toContain('createCalendar')
    const account = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: 'utente1' } })
    expect(account.calendarId).toBe('cal-nuovo')
  })

  it('riusa il calendario dedicato già esistente invece di crearne un altro', async () => {
    await prisma.googleAccount.update({
      where: { userId: 'utente1' },
      data: { calendarId: 'cal-mio' },
    })
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto({
      calendars: [{ id: 'cal-mio', summary: DEDICATED_CALENDAR_SUMMARY }],
    })

    const esito = await esegui(finto)

    expect(esito.calendarId).toBe('cal-mio')
    expect(finto.calls).not.toContain('createCalendar')
  })

  it('non scrive mai sul calendario principale', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()

    await esegui(finto)

    expect(finto.calls.some((c) => c.includes('primary'))).toBe(false)
    expect(finto.calls).toContain('listEvents:cal-nuovo')
  })
})

describe('syncRoster — idempotenza', () => {
  it('eseguito due volte non produce nessuna scrittura la seconda volta', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await assegna({ id: 'a2', day: 2, code: 'NOTTE' })
    await assegna({ id: 'a3', day: 3, code: 'RIP' })
    const finto = calendarioFinto()

    await esegui(finto)
    const dopoPrimo = finto.scritture().length
    const secondo = await esegui(finto)

    expect(dopoPrimo).toBe(3)
    expect(finto.scritture()).toHaveLength(3)
    expect(secondo).toMatchObject({ ok: true, created: 0, updated: 0, deleted: 0, unchanged: 3 })
  })

  it('aggiorna solo il turno cambiato e lascia stare gli altri', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await assegna({ id: 'a2', day: 2, code: 'M' })
    const finto = calendarioFinto()
    await esegui(finto)

    await prisma.assignment.update({ where: { id: 'a2' }, data: { code: 'P' } })
    const esito = await esegui(finto)

    expect(esito).toMatchObject({ updated: 1, created: 0, deleted: 0, unchanged: 1 })
    expect(finto.scritture().filter((c) => c.startsWith('patch'))).toHaveLength(1)
  })

  it('cancella l evento di un turno rimosso dalla tabella', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await assegna({ id: 'a2', day: 2, code: 'M' })
    const finto = calendarioFinto()
    await esegui(finto)

    await prisma.assignment.delete({ where: { id: 'a2' } })
    const esito = await esegui(finto)

    expect(esito).toMatchObject({ deleted: 1, unchanged: 1 })
    expect(finto.events.size).toBe(1)
  })

  it('ripara un doppione rimasto da un sync interrotto', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()
    await esegui(finto)

    // Stesso shiftKey, secondo evento: è quello che resterebbe da un sync a metà.
    const originale = [...finto.events.values()][0]
    finto.aggiungiEvento('ev-doppio', { ...originale, id: 'ev-doppio' })

    const esito = await esegui(finto)

    expect(esito.deleted).toBe(1)
    expect(finto.events.size).toBe(1)
  })
})

describe('syncRoster — quello che non si tocca', () => {
  it('non tocca un evento senza shiftKey, nemmeno se è nel calendario dedicato', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()
    finto.aggiungiPersonale('dentista', 'Dentista')

    const esito = await esegui(finto)

    expect(esito.foreignEvents).toBe(1)
    expect(finto.events.has('dentista')).toBe(true)
    expect(finto.calls).not.toContain('delete:dentista')
  })

  it('non tocca l evento di un altra utente', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()
    finto.aggiungiEvento('altrui', {
      id: 'altrui',
      extendedProperties: { private: { shiftKey: 'utente2:2026-08-01' } },
    })

    const esito = await esegui(finto)

    expect(esito.foreignEvents).toBe(1)
    expect(finto.events.has('altrui')).toBe(true)
  })

  it('non cancella l evento di un turno non ancora confermato', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()
    await esegui(finto)

    // La nuova versione della tabella riporta il giorno in bozza: l evento resta.
    await prisma.assignment.update({
      where: { id: 'a1' },
      data: { confirmedAt: null, syncState: 'draft' },
    })
    const esito = await esegui(finto)

    expect(esito).toMatchObject({ deleted: 0, protectedEvents: 1 })
    expect(esito.skipped).toEqual([{ date: '2026-08-01', code: 'M', reason: 'non_confermato' }])
    expect(finto.events.size).toBe(1)
  })

  it('un codice sconosciuto non si sincronizza e non blocca gli altri', async () => {
    await assegna({ id: 'a1', day: 1, code: 'QQQ' })
    await assegna({ id: 'a2', day: 2, code: 'M' })
    const finto = calendarioFinto()

    const esito = await esegui(finto)

    expect(esito.created).toBe(1)
    expect(esito.skipped).toEqual([
      { date: '2026-08-01', code: 'QQQ', reason: 'codice_sconosciuto' },
    ])
    const riga = await prisma.assignment.findUniqueOrThrow({ where: { id: 'a1' } })
    expect(riga.eventId).toBeNull()
  })

  it('senza nessuna assegnazione si rifiuta di sincronizzare, invece di svuotare il mese', async () => {
    const finto = calendarioFinto()

    const esito = await esegui(finto)

    expect(esito.ok).toBe(false)
    expect(esito.error).toMatch(/nessun turno/i)
    expect(finto.calls).toEqual([])
  })

  it('non sincronizza i turni di un altra utente su richiesta di un infermiera', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()

    const esito = await esegui(finto, {
      actor: { id: 'utente1', role: 'NURSE' },
      targetUserId: 'utente2',
    })

    expect(esito.ok).toBe(false)
    expect(esito.error).toMatch(/colonna/i)
    expect(finto.calls).toEqual([])
  })

  it('la referente può sincronizzare la colonna di un altra', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()

    const esito = await esegui(finto, {
      actor: { id: 'referente', role: 'REFERENTE' },
      targetUserId: 'utente1',
    })

    expect(esito.ok).toBe(true)
    expect(esito.created).toBe(1)
  })

  it('non scrive nulla se sono solo bozze', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M', confirmed: false })
    const finto = calendarioFinto()

    const esito = await esegui(finto)

    expect(esito.created).toBe(0)
    expect(finto.scritture()).toEqual([])
  })
})

describe('syncRoster — guasti', () => {
  it('con il consenso Google da rinnovare si ferma senza chiamare nulla', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await prisma.googleAccount.update({
      where: { userId: 'utente1' },
      data: { status: 'needs_reauth' },
    })

    const esito = await sync.syncRoster({
      actor: { id: 'utente1', role: 'NURSE' },
      targetUserId: 'utente1',
      rosterId: 'roster1',
    })

    expect(esito.ok).toBe(false)
    expect(esito.error).toMatch(/rinnov/i)
    // Il chiamante non deve leggere il messaggio per capire che serve un nuovo
    // consenso: l interfaccia deve poter mostrare il bottone "riautorizza".
    expect(esito.needsReauth).toBe(true)
  })

  it('se il calendario collegato non esiste piu su Google, si ferma senza crearne un altro', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await prisma.googleAccount.update({
      where: { userId: 'utente1' },
      data: { calendarId: 'sparito' },
    })
    const finto = calendarioFinto() // nessun calendario: 'sparito' non c e

    const esito = await esegui(finto)

    expect(esito.ok).toBe(false)
    expect(esito.error).toMatch(/non esiste più/i)
    // Campo a se, come needsReauth: l interfaccia ci attacca il bottone «Ricollega».
    expect(esito.calendarMissing).toBe(true)
    expect(finto.calls).not.toContain('createCalendar')
    expect(finto.calls).not.toContain('listCalendars')
    // L id resta: azzerarlo e un gesto della persona, non dell app.
    const account = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: 'utente1' } })
    expect(account.calendarId).toBe('sparito')
  })

  it('un token revocato durante il sync segna l account come da riautorizzare', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    const finto = calendarioFinto()
    finto.api.listEvents = async () => {
      throw new CalendarApiError('invalid_grant', { status: 400, needsReauth: true })
    }

    const esito = await esegui(finto)

    expect(esito.ok).toBe(false)
    expect(esito.needsReauth).toBe(true)
    const account = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: 'utente1' } })
    expect(account.status).toBe('needs_reauth')
  })

  it('un guasto su un evento non impedisce gli altri e viene registrato', async () => {
    await assegna({ id: 'a1', day: 1, code: 'M' })
    await assegna({ id: 'a2', day: 2, code: 'M' })

    const finto = calendarioFinto()
    let chiamate = 0
    const insertOriginale = finto.api.insertEvent
    finto.api.insertEvent = async (input) => {
      chiamate += 1
      if (chiamate === 1) throw new CalendarApiError('quota superata', { status: 403 })
      return insertOriginale(input)
    }

    const esito = await esegui(finto)

    expect(esito.ok).toBe(false)
    expect(esito.created).toBe(1)
    expect(esito.failures).toEqual([
      { shiftKey: 'utente1:2026-08-01', action: 'create', message: 'quota superata' },
    ])

    const fallita = await prisma.assignment.findUniqueOrThrow({ where: { id: 'a1' } })
    expect(fallita.syncState).toBe('failed')
    expect(fallita.syncError).toBe('quota superata')
    const riuscita = await prisma.assignment.findUniqueOrThrow({ where: { id: 'a2' } })
    expect(riuscita.syncState).toBe('synced')
  })

  it('una tabella inesistente non è un errore silenzioso', async () => {
    const esito = await sync.syncRoster({
      actor: { id: 'utente1', role: 'NURSE' },
      targetUserId: 'utente1',
      rosterId: 'non-esiste',
    })

    expect(esito.ok).toBe(false)
    expect(esito.error).toMatch(/tabella/i)
  })
})
