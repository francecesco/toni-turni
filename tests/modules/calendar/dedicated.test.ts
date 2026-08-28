import { describe, expect, it, vi } from 'vitest'
import {
  DEDICATED_CALENDAR_SUMMARY,
  resolveDedicatedCalendar,
} from '@/modules/calendar/dedicated'
import type { CalendarApi, CalendarSummary } from '@/modules/calendar/api'

function apiFinto(over: Partial<CalendarApi> = {}) {
  const api: CalendarApi = {
    listCalendars: vi.fn(async () => [] as CalendarSummary[]),
    getCalendar: vi.fn(async () => null),
    createCalendar: vi.fn(async ({ summary }) => ({ id: 'nuovo', summary })),
    listEvents: vi.fn(async () => []),
    insertEvent: vi.fn(async () => ({ id: 'ev' })),
    patchEvent: vi.fn(async () => ({ id: 'ev' })),
    deleteEvent: vi.fn(async () => {}),
    ...over,
  }
  return api
}

describe('resolveDedicatedCalendar', () => {
  it('riusa il calendario già memorizzato, senza altre chiamate', async () => {
    const api = apiFinto({
      getCalendar: vi.fn(async () => ({ id: 'cal1', summary: DEDICATED_CALENDAR_SUMMARY })),
    })

    const esito = await resolveDedicatedCalendar({ api, knownCalendarId: 'cal1' })

    expect(esito).toEqual({ calendarId: 'cal1', created: false, changed: false })
    expect(api.listCalendars).not.toHaveBeenCalled()
    expect(api.createCalendar).not.toHaveBeenCalled()
  })

  it('crea il calendario dedicato quando non ce n è nessuno', async () => {
    const api = apiFinto()

    const esito = await resolveDedicatedCalendar({ api, knownCalendarId: null })

    expect(esito).toEqual({ calendarId: 'nuovo', created: true, changed: true })
    expect(api.createCalendar).toHaveBeenCalledWith({
      summary: DEDICATED_CALENDAR_SUMMARY,
      description: expect.stringContaining('Toni Turni'),
    })
  })

  it('ritrova per nome il calendario già creato, invece di crearne un secondo', async () => {
    const api = apiFinto({
      listCalendars: vi.fn(async () => [
        { id: 'personale', summary: 'Compleanni' },
        { id: 'cal7', summary: DEDICATED_CALENDAR_SUMMARY },
      ]),
    })

    const esito = await resolveDedicatedCalendar({ api, knownCalendarId: null })

    expect(esito).toEqual({ calendarId: 'cal7', created: false, changed: true })
    expect(api.createCalendar).not.toHaveBeenCalled()
  })

  it('se il calendario memorizzato è stato cancellato, ne trova o crea un altro', async () => {
    const api = apiFinto({ getCalendar: vi.fn(async () => null) })

    const esito = await resolveDedicatedCalendar({ api, knownCalendarId: 'sparito' })

    expect(esito).toEqual({ calendarId: 'nuovo', created: true, changed: true })
    expect(api.getCalendar).toHaveBeenCalledWith('sparito')
  })

  it('non restituisce mai il calendario principale', async () => {
    const api = apiFinto({
      listCalendars: vi.fn(async () => [{ id: 'primary', summary: DEDICATED_CALENDAR_SUMMARY }]),
    })

    await expect(resolveDedicatedCalendar({ api, knownCalendarId: null })).rejects.toThrow(
      /primary/,
    )
  })

  it('rifiuta un id vuoto restituito dalla creazione', async () => {
    const api = apiFinto({ createCalendar: vi.fn(async () => ({ id: '', summary: 'x' })) })

    await expect(resolveDedicatedCalendar({ api, knownCalendarId: null })).rejects.toThrow()
  })

  it('resta sul calendario memorizzato anche se l utente lo ha rinominato', async () => {
    // L id l abbiamo salvato noi alla creazione: rinominare il calendario è una
    // cosa che l utente può legittimamente fare, e non deve produrre un doppione
    // con gli stessi turni dentro.
    const api = apiFinto({
      getCalendar: vi.fn(async () => ({ id: 'cal1', summary: 'Turni di Anna' })),
    })

    const esito = await resolveDedicatedCalendar({ api, knownCalendarId: 'cal1' })

    expect(esito).toEqual({ calendarId: 'cal1', created: false, changed: false })
    expect(api.createCalendar).not.toHaveBeenCalled()
  })

  it('rifiuta un id memorizzato che punta al calendario principale', async () => {
    const api = apiFinto({
      getCalendar: vi.fn(async () => ({ id: 'primary', summary: 'Anna' })),
    })

    await expect(resolveDedicatedCalendar({ api, knownCalendarId: 'primary' })).rejects.toThrow(
      /primary/,
    )
  })
})
