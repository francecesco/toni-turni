import type { CalendarApi } from './api'
import { CalendarRefusedError } from './api'

/**
 * Nome del calendario creato dall app. Non si scrive da nessun altra parte:
 * i turni non finiscono mai nel calendario principale dell utente.
 */
export const DEDICATED_CALENDAR_SUMMARY = 'Turni — Toni Turni'

const DEDICATED_CALENDAR_DESCRIPTION =
  'Calendario creato da Toni Turni per i turni del reparto. Gli eventi qui dentro sono gestiti dall app: le modifiche fatte a mano vengono riscritte al prossimo sync.'

export interface DedicatedCalendar {
  calendarId: string
  /** Vero se il calendario è stato creato adesso. */
  created: boolean
  /** Vero se l id va salvato: era assente, oppure quello memorizzato non esiste più. */
  changed: boolean
}

function assertNotPrimary(calendarId: string): void {
  if (calendarId.trim() === '') {
    throw new CalendarRefusedError('Google ha restituito un calendario senza id')
  }
  if (calendarId === 'primary') {
    throw new CalendarRefusedError(
      'Il calendario dedicato non può essere "primary": lì stanno gli appuntamenti personali',
    )
  }
}

/**
 * Trova o crea il calendario dedicato dell utente.
 *
 * L id memorizzato ha la precedenza e vale anche se l utente ha rinominato il
 * calendario: l id l abbiamo salvato noi alla creazione, e un rinomina non deve
 * generare un doppione con gli stessi turni dentro. Se l id non esiste più si
 * cerca per nome, e solo in ultima istanza si crea.
 */
export async function resolveDedicatedCalendar(input: {
  api: CalendarApi
  knownCalendarId: string | null
}): Promise<DedicatedCalendar> {
  const known = input.knownCalendarId?.trim() ?? ''

  if (known !== '') {
    assertNotPrimary(known)
    const existing = await input.api.getCalendar(known)
    if (existing) {
      assertNotPrimary(existing.id)
      return { calendarId: existing.id, created: false, changed: false }
    }
  }

  const calendars = await input.api.listCalendars()
  const found = calendars.find((calendar) => calendar.summary === DEDICATED_CALENDAR_SUMMARY)
  if (found) {
    assertNotPrimary(found.id)
    return { calendarId: found.id, created: false, changed: true }
  }

  const created = await input.api.createCalendar({
    summary: DEDICATED_CALENDAR_SUMMARY,
    description: DEDICATED_CALENDAR_DESCRIPTION,
  })
  assertNotPrimary(created.id)

  return { calendarId: created.id, created: true, changed: true }
}
