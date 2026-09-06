import type { CalendarApi } from './api'
import { CalendarRefusedError } from './api'

/**
 * Nome del calendario creato dall app, deciso dal proprietario. Non si scrive da
 * nessun altra parte: i turni non finiscono mai nel calendario principale
 * dell utente. È anche la chiave con cui si **ritrova** il calendario quando l id
 * memorizzato manca: cambiarlo dopo il primo sync farebbe creare un doppione a
 * chi non ha ancora l id salvato.
 */
export const DEDICATED_CALENDAR_SUMMARY = 'Turni Toniolo'

const DEDICATED_CALENDAR_DESCRIPTION =
  'Calendario creato da Toni Turni per i turni del reparto. Gli eventi qui dentro sono gestiti dall app: le modifiche fatte a mano vengono riscritte al prossimo sync.'

/**
 * L id memorizzato punta a un calendario che su Google non esiste più. È un
 * errore a sé, e non un `CalendarRefusedError` qualsiasi, perché l interfaccia ci
 * attacca un bottone: «Ricollega il calendario» azzera l id salvato, e solo dopo
 * quel gesto un sync può crearne uno nuovo. Deciso il 2026-09-06: un calendario
 * nuovo nasce per mano di una persona, mai per decisione dell app.
 */
export class DedicatedCalendarMissingError extends CalendarRefusedError {
  constructor() {
    super(
      `Il calendario «${DEDICATED_CALENDAR_SUMMARY}» collegato al tuo account non esiste più su Google. Per sicurezza l app non ne crea un altro da sola: premi «Ricollega il calendario», poi rimanda i turni.`,
    )
    this.name = 'DedicatedCalendarMissingError'
  }
}

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
 * generare un doppione con gli stessi turni dentro. Se l id non esiste più **ci si
 * ferma** (`DedicatedCalendarMissingError`): la ricerca per nome e la creazione
 * valgono solo quando nessun id è memorizzato.
 */
export async function resolveDedicatedCalendar(input: {
  api: CalendarApi
  knownCalendarId: string | null
}): Promise<DedicatedCalendar> {
  const known = input.knownCalendarId?.trim() ?? ''

  if (known !== '') {
    assertNotPrimary(known)
    const existing = await input.api.getCalendar(known)
    if (!existing) throw new DedicatedCalendarMissingError()
    assertNotPrimary(existing.id)
    return { calendarId: existing.id, created: false, changed: false }
  }

  const calendars = await input.api.listCalendars()
  const omonimi = calendars.filter((calendar) => calendar.summary === DEDICATED_CALENDAR_SUMMARY)
  if (omonimi.length > 1) {
    // Prendere il primo vorrebbe dire che l ordine di Google decide dove vanno i
    // turni, e a ogni sync potrebbe cambiare. Meglio fermarsi e dirlo.
    throw new CalendarRefusedError(
      `Su Google ci sono ${omonimi.length} calendari chiamati «${DEDICATED_CALENDAR_SUMMARY}»: tienine uno solo, poi riprova`,
    )
  }
  const found = omonimi[0]
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
