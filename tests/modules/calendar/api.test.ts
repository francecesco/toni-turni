import { describe, expect, it, vi } from 'vitest'
import {
  CalendarApiError,
  createCalendarApi,
  isReauthNeeded,
  type CalendarTransport,
} from '@/modules/calendar/api'
import type { EventPayload } from '@/modules/calendar/types'

interface Call {
  url: string
  method: string
  params?: Record<string, string>
  data?: unknown
}

/** Trasporto finto: registra le chiamate e risponde dalla coda. Nessuna rete. */
function transport(responses: unknown[] = [{}]) {
  const calls: Call[] = []
  const queue = [...responses]

  const request = vi.fn(async (options: Call) => {
    calls.push(options)
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next instanceof Error) throw next
    return { data: next }
  })

  return { calls, request: request as unknown as CalendarTransport['request'] }
}

function gaxiosError(status: number, message = 'errore', body?: unknown) {
  const error = new Error(message) as Error & { status: number; response?: { data: unknown } }
  error.status = status
  if (body) error.response = { data: body }
  return error
}

const PAYLOAD: EventPayload = {
  summary: 'Mattino (M)',
  description: 'Turno dalla tabella del reparto, sincronizzato da Toni Turni.',
  transparency: 'opaque',
  start: { dateTime: '2026-08-10T07:00:00', timeZone: 'Europe/Rome' },
  end: { dateTime: '2026-08-10T14:00:00', timeZone: 'Europe/Rome' },
  extendedProperties: { private: { shiftKey: 'utente1:2026-08-10', code: 'M' } },
}

const NOSTRO = {
  id: 'ev1',
  extendedProperties: { private: { shiftKey: 'utente1:2026-08-10', code: 'M' } },
}

describe('listEvents', () => {
  it('chiede solo la finestra indicata e non gli eventi cancellati', async () => {
    const t = transport([{ items: [{ id: 'ev1' }] }])
    const api = createCalendarApi(t)

    const eventi = await api.listEvents({
      calendarId: 'cal@group.calendar.google.com',
      timeMin: '2026-07-31T22:00:00.000Z',
      timeMax: '2026-08-31T22:00:00.000Z',
    })

    expect(eventi).toEqual([{ id: 'ev1' }])
    expect(t.calls[0].method).toBe('GET')
    expect(t.calls[0].url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/cal%40group.calendar.google.com/events',
    )
    expect(t.calls[0].params).toMatchObject({
      timeMin: '2026-07-31T22:00:00.000Z',
      timeMax: '2026-08-31T22:00:00.000Z',
      showDeleted: 'false',
    })
  })

  it('segue la paginazione finché Google restituisce un pageToken', async () => {
    const t = transport([
      { items: [{ id: 'ev1' }], nextPageToken: 'p2' },
      { items: [{ id: 'ev2' }] },
    ])
    const api = createCalendarApi(t)

    const eventi = await api.listEvents({
      calendarId: 'cal1',
      timeMin: '2026-08-01T00:00:00.000Z',
      timeMax: '2026-09-01T00:00:00.000Z',
    })

    expect(eventi.map((e) => e.id)).toEqual(['ev1', 'ev2'])
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].params?.pageToken).toBe('p2')
  })
})

describe('scritture: il calendario principale è vietato', () => {
  it('rifiuta di creare, aggiornare o cancellare su "primary", senza chiamare la rete', async () => {
    const t = transport()
    const api = createCalendarApi(t)

    await expect(api.insertEvent({ calendarId: 'primary', payload: PAYLOAD })).rejects.toThrow(
      /primary/,
    )
    await expect(
      api.patchEvent({ calendarId: 'primary', eventId: 'ev1', payload: PAYLOAD }),
    ).rejects.toThrow(/primary/)
    await expect(api.deleteEvent({ calendarId: 'primary', eventId: 'ev1' })).rejects.toThrow(
      /primary/,
    )

    expect(t.calls).toHaveLength(0)
  })

  it('rifiuta un calendarId vuoto', async () => {
    const t = transport()
    const api = createCalendarApi(t)

    await expect(api.insertEvent({ calendarId: '', payload: PAYLOAD })).rejects.toThrow()
    expect(t.calls).toHaveLength(0)
  })
})

describe('insertEvent e patchEvent', () => {
  it('crea l evento sul calendario indicato', async () => {
    const t = transport([{ id: 'nuovo' }])
    const api = createCalendarApi(t)

    const creato = await api.insertEvent({ calendarId: 'cal1', payload: PAYLOAD })

    expect(creato).toEqual({ id: 'nuovo' })
    expect(t.calls[0].method).toBe('POST')
    expect(t.calls[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal1/events')
    expect(t.calls[0].data).toEqual(PAYLOAD)
  })

  it('aggiorna con PATCH, per non azzerare i campi che non gestiamo', async () => {
    const t = transport([{ id: 'ev1' }])
    const api = createCalendarApi(t)

    await api.patchEvent({ calendarId: 'cal1', eventId: 'ev1', payload: PAYLOAD })

    expect(t.calls[0].method).toBe('PATCH')
    expect(t.calls[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal1/events/ev1')
  })
})

describe('deleteEvent: la protezione finale', () => {
  it('rilegge l evento e cancella solo se porta una shiftKey', async () => {
    const t = transport([NOSTRO, {}])
    const api = createCalendarApi(t)

    await api.deleteEvent({ calendarId: 'cal1', eventId: 'ev1' })

    expect(t.calls.map((c) => c.method)).toEqual(['GET', 'DELETE'])
  })

  it('non cancella un evento senza shiftKey, nemmeno se glielo si chiede', async () => {
    // È la protezione che salva l appuntamento personale dell utente da un errore
    // a monte: la verifica avviene sull evento appena riletto, non sul piano.
    const t = transport([{ id: 'ev1', summary: 'Dentista' }])
    const api = createCalendarApi(t)

    await expect(api.deleteEvent({ calendarId: 'cal1', eventId: 'ev1' })).rejects.toThrow(
      /shiftKey/,
    )
    expect(t.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('non cancella un evento con la shiftKey di un altro utente quando si indica il proprietario', async () => {
    const t = transport([
      { id: 'ev1', extendedProperties: { private: { shiftKey: 'utente2:2026-08-10' } } },
    ])
    const api = createCalendarApi(t)

    await expect(
      api.deleteEvent({ calendarId: 'cal1', eventId: 'ev1', expectedUserId: 'utente1' }),
    ).rejects.toThrow(/shiftKey/)
    expect(t.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('un evento già scomparso non è un errore: il sync resta ripetibile', async () => {
    const t = transport([gaxiosError(404, 'Not Found')])
    const api = createCalendarApi(t)

    await expect(api.deleteEvent({ calendarId: 'cal1', eventId: 'ev1' })).resolves.toBeUndefined()
  })
})

describe('calendari', () => {
  it('elenca i calendari dell utente', async () => {
    const t = transport([{ items: [{ id: 'cal1', summary: 'Turni' }] }])
    const api = createCalendarApi(t)

    const calendari = await api.listCalendars()

    expect(calendari).toEqual([{ id: 'cal1', summary: 'Turni' }])
    expect(t.calls[0].url).toBe('https://www.googleapis.com/calendar/v3/users/me/calendarList')
  })

  it('crea il calendario dedicato con il fuso di Roma', async () => {
    const t = transport([{ id: 'nuovo', summary: 'Turni' }])
    const api = createCalendarApi(t)

    await api.createCalendar({ summary: 'Turni', description: 'x' })

    expect(t.calls[0].method).toBe('POST')
    expect(t.calls[0].url).toBe('https://www.googleapis.com/calendar/v3/calendars')
    expect(t.calls[0].data).toEqual({ summary: 'Turni', description: 'x', timeZone: 'Europe/Rome' })
  })

  it('getCalendar restituisce null quando il calendario non esiste più', async () => {
    const api = createCalendarApi(transport([gaxiosError(404)]))
    await expect(api.getCalendar('sparito')).resolves.toBeNull()
  })

  it('getCalendar restituisce null anche su 410 Gone', async () => {
    const api = createCalendarApi(transport([gaxiosError(410)]))
    await expect(api.getCalendar('sparito')).resolves.toBeNull()
  })
})

describe('errori', () => {
  it('traduce l errore HTTP in CalendarApiError con lo stato', async () => {
    const api = createCalendarApi(transport([gaxiosError(500, 'Backend Error')]))

    await expect(api.listCalendars()).rejects.toMatchObject({
      name: 'CalendarApiError',
      status: 500,
      needsReauth: false,
    })
  })

  it('riconosce un token da rinnovare su 401', async () => {
    const api = createCalendarApi(transport([gaxiosError(401, 'Unauthorized')]))

    await expect(api.listCalendars()).rejects.toMatchObject({ needsReauth: true })
  })

  it('riconosce un consenso revocato da invalid_grant', async () => {
    const api = createCalendarApi(
      transport([gaxiosError(400, 'Bad Request', { error: 'invalid_grant' })]),
    )

    const errore = await api.listCalendars().catch((e) => e)
    expect(errore).toBeInstanceOf(CalendarApiError)
    expect(errore.needsReauth).toBe(true)
  })

  it('isReauthNeeded riconosce l errore anche da un altra copia della classe', async () => {
    // Sotto il bundler la stessa classe può esistere due volte: il riconoscimento
    // deve essere strutturale, o il caso "token revocato" sfuggirebbe.
    expect(isReauthNeeded(new CalendarApiError('x', { needsReauth: true }))).toBe(true)
    expect(isReauthNeeded({ needsReauth: true })).toBe(true)
    expect(isReauthNeeded(new CalendarApiError('x', { status: 500 }))).toBe(false)
    expect(isReauthNeeded(new Error('x'))).toBe(false)
    expect(isReauthNeeded(null)).toBe(false)
  })

  it('riporta il messaggio di Google quando c è', async () => {
    const api = createCalendarApi(
      transport([
        gaxiosError(403, 'Forbidden', { error: { message: 'Rate Limit Exceeded', code: 403 } }),
      ]),
    )

    await expect(api.listCalendars()).rejects.toThrow(/Rate Limit Exceeded/)
  })
})
