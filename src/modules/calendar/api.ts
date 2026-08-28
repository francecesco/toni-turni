import { ROME_TZ } from '@/lib/time'
import { belongsTo, parseShiftKey } from './shiftKey'
import type { EventPayload, ExistingEvent } from './types'

const BASE = 'https://www.googleapis.com/calendar/v3'

/**
 * Il minimo che ci serve da un client HTTP autenticato. `OAuth2Client` di
 * google-auth-library lo soddisfa così com è: rinnova l access token da solo e non
 * porta con sé il peso di `googleapis`, che su una ZimaBoard non ha senso installare.
 */
export interface CalendarTransport {
  request<T>(options: {
    url: string
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    params?: Record<string, string>
    data?: unknown
  }): Promise<{ data: T }>
}

export interface CalendarSummary {
  id: string
  summary: string
}

export interface CalendarApi {
  listCalendars(): Promise<CalendarSummary[]>
  getCalendar(calendarId: string): Promise<CalendarSummary | null>
  createCalendar(input: { summary: string; description?: string }): Promise<CalendarSummary>
  listEvents(input: {
    calendarId: string
    timeMin: string
    timeMax: string
  }): Promise<ExistingEvent[]>
  insertEvent(input: { calendarId: string; payload: EventPayload }): Promise<{ id: string }>
  patchEvent(input: {
    calendarId: string
    eventId: string
    payload: EventPayload
  }): Promise<{ id: string }>
  deleteEvent(input: {
    calendarId: string
    eventId: string
    expectedUserId?: string
  }): Promise<void>
}

export class CalendarApiError extends Error {
  readonly status?: number
  /** Il consenso Google non è più valido: va rifatto il login, non ritentato il sync. */
  readonly needsReauth: boolean

  constructor(message: string, options: { status?: number; needsReauth?: boolean } = {}) {
    super(message)
    this.name = 'CalendarApiError'
    this.status = options.status
    this.needsReauth = options.needsReauth ?? false
  }
}

/**
 * Riconosce un errore che chiede di rifare il consenso. Il controllo è strutturale
 * e non un `instanceof`: sotto il bundler di Next, o con i moduli ricaricati, la
 * stessa classe può esistere in due copie e `instanceof` risponderebbe di no
 * proprio nel caso che ci interessa di più.
 */
export function isReauthNeeded(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { needsReauth?: unknown }).needsReauth === true
}

/** Errore di rifiuto locale: la richiesta non è nemmeno partita. */
export class CalendarRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalendarRefusedError'
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof candidate.status === 'number') return candidate.status
  if (typeof candidate.response?.status === 'number') return candidate.response.status
  return undefined
}

function bodyOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  return (error as { response?: { data?: unknown } }).response?.data
}

function messageOf(error: unknown): string {
  const body = bodyOf(error)
  if (typeof body === 'object' && body !== null) {
    const nested = (body as { error?: unknown }).error
    if (typeof nested === 'string') return nested
    if (typeof nested === 'object' && nested !== null) {
      const message = (nested as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  return error instanceof Error ? error.message : String(error)
}

function isRevoked(error: unknown): boolean {
  const status = statusOf(error)
  if (status === 401) return true

  const body = bodyOf(error)
  if (status === 400 && typeof body === 'object' && body !== null) {
    return (body as { error?: unknown }).error === 'invalid_grant'
  }
  return false
}

function toCalendarError(error: unknown): CalendarApiError {
  if (error instanceof CalendarApiError) return error
  return new CalendarApiError(messageOf(error), {
    status: statusOf(error),
    needsReauth: isRevoked(error),
  })
}

/**
 * Il calendario principale dell utente non è mai una destinazione lecita: lì stanno
 * i suoi appuntamenti personali. Vale anche per un id vuoto, che Google
 * interpreterebbe come un percorso diverso da quello che crediamo.
 */
function assertWritableCalendar(calendarId: string): void {
  if (calendarId.trim() === '') {
    throw new CalendarRefusedError('calendarId mancante: nessuna scrittura possibile')
  }
  if (calendarId === 'primary') {
    throw new CalendarRefusedError(
      'Scrittura rifiutata sul calendario primary: l app scrive solo sul calendario dedicato',
    )
  }
}

export function createCalendarApi(transport: CalendarTransport): CalendarApi {
  async function call<T>(options: {
    url: string
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    params?: Record<string, string>
    data?: unknown
  }): Promise<T> {
    try {
      const response = await transport.request<T>(options)
      return response.data
    } catch (error) {
      throw toCalendarError(error)
    }
  }

  function eventsUrl(calendarId: string, eventId?: string): string {
    const base = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`
    return eventId ? `${base}/${encodeURIComponent(eventId)}` : base
  }

  async function getEvent(calendarId: string, eventId: string): Promise<ExistingEvent | null> {
    try {
      return await call<ExistingEvent>({ url: eventsUrl(calendarId, eventId), method: 'GET' })
    } catch (error) {
      const status = error instanceof CalendarApiError ? error.status : undefined
      if (status === 404 || status === 410) return null
      throw error
    }
  }

  return {
    async listCalendars() {
      const items: CalendarSummary[] = []
      let pageToken: string | undefined

      do {
        const page = await call<{ items?: CalendarSummary[]; nextPageToken?: string }>({
          url: `${BASE}/users/me/calendarList`,
          method: 'GET',
          params: { ...(pageToken ? { pageToken } : {}), maxResults: '250' },
        })
        items.push(...(page.items ?? []))
        pageToken = page.nextPageToken
      } while (pageToken)

      return items
    },

    async getCalendar(calendarId) {
      if (calendarId.trim() === '') return null
      try {
        return await call<CalendarSummary>({
          url: `${BASE}/calendars/${encodeURIComponent(calendarId)}`,
          method: 'GET',
        })
      } catch (error) {
        const status = error instanceof CalendarApiError ? error.status : undefined
        if (status === 404 || status === 410) return null
        throw error
      }
    },

    async createCalendar(input) {
      return call<CalendarSummary>({
        url: `${BASE}/calendars`,
        method: 'POST',
        data: { ...input, timeZone: ROME_TZ },
      })
    },

    async listEvents({ calendarId, timeMin, timeMax }) {
      if (calendarId.trim() === '') {
        throw new CalendarRefusedError('calendarId mancante: nessuna lettura possibile')
      }

      const items: ExistingEvent[] = []
      let pageToken: string | undefined

      do {
        const page = await call<{ items?: ExistingEvent[]; nextPageToken?: string }>({
          url: eventsUrl(calendarId),
          method: 'GET',
          params: {
            timeMin,
            timeMax,
            showDeleted: 'false',
            // Nessun singleEvents: gli eventi che creiamo noi sono singoli, e le
            // eventuali ricorrenze altrui non ci riguardano.
            maxResults: '2500',
            ...(pageToken ? { pageToken } : {}),
          },
        })
        items.push(...(page.items ?? []))
        pageToken = page.nextPageToken
      } while (pageToken)

      return items
    },

    async insertEvent({ calendarId, payload }) {
      assertWritableCalendar(calendarId)
      return call<{ id: string }>({ url: eventsUrl(calendarId), method: 'POST', data: payload })
    },

    async patchEvent({ calendarId, eventId, payload }) {
      assertWritableCalendar(calendarId)
      // PATCH e non PUT: tocchiamo solo i campi che l app governa.
      return call<{ id: string }>({
        url: eventsUrl(calendarId, eventId),
        method: 'PATCH',
        data: payload,
      })
    },

    async deleteEvent({ calendarId, eventId, expectedUserId }) {
      assertWritableCalendar(calendarId)

      // Ultimo controllo prima di un azione irreversibile, sull evento riletto in
      // questo istante: se non porta una shiftKey nostra, non si cancella.
      const event = await getEvent(calendarId, eventId)
      if (event === null) return

      const shiftKey = event.extendedProperties?.private?.shiftKey
      const ours =
        expectedUserId === undefined
          ? typeof shiftKey === 'string' && parseShiftKey(shiftKey) !== null
          : belongsTo(shiftKey, expectedUserId)

      if (!ours) {
        throw new CalendarRefusedError(
          `Cancellazione rifiutata: l evento ${eventId} non porta una shiftKey dell app`,
        )
      }

      try {
        await call<unknown>({ url: eventsUrl(calendarId, eventId), method: 'DELETE' })
      } catch (error) {
        const status = error instanceof CalendarApiError ? error.status : undefined
        // Già cancellato altrove: il sync deve restare ripetibile.
        if (status === 404 || status === 410) return
        throw error
      }
    },
  }
}
