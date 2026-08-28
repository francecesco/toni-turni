/** Un turno confermato (o ancora in bozza) letto dalla tabella `Assignment`. */
export interface AssignmentRecord {
  id: string
  /** Data locale del turno, YYYY-MM-DD. */
  date: string
  code: string
  /** Vero solo con `confirmedAt` valorizzato: senza conferma non si scrive nulla. */
  confirmed: boolean
  eventId: string | null
}

export type SkipReason =
  | 'non_confermato'
  | 'codice_sconosciuto'
  | 'giorno_duplicato'
  | 'fuori_intervallo'
  | 'data_non_valida'

export interface SkippedShift {
  date: string
  code: string | null
  reason: SkipReason
}

export type EventTime = { dateTime: string; timeZone: string } | { date: string }

/** Corpo dell evento come lo mandiamo a Google: solo i campi che l app governa. */
export interface EventPayload {
  summary: string
  description: string
  location?: string
  transparency: 'opaque' | 'transparent'
  start: EventTime
  end: EventTime
  extendedProperties: { private: { shiftKey: string; code: string } }
}

/** Un evento come Google lo restituisce, ridotto ai campi che ci interessano. */
export interface ExistingEvent {
  id: string
  status?: string | null
  summary?: string | null
  description?: string | null
  location?: string | null
  transparency?: string | null
  start?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null
  extendedProperties?: { private?: Record<string, string> | null } | null
}

export interface DesiredEvent {
  shiftKey: string
  date: string
  code: string
  assignmentId: string
  payload: EventPayload
}

export type DeleteReason = 'turno_rimosso' | 'evento_duplicato'

export type SyncStep =
  | { action: 'create'; shiftKey: string; date: string; assignmentId: string; payload: EventPayload }
  | {
      action: 'update'
      shiftKey: string
      date: string
      assignmentId: string
      eventId: string
      payload: EventPayload
    }
  | { action: 'keep'; shiftKey: string; date: string; assignmentId: string; eventId: string }
  | { action: 'delete'; shiftKey: string; date: string; eventId: string; reason: DeleteReason }

export interface SyncPlan {
  steps: SyncStep[]
  skipped: SkippedShift[]
  /** Eventi lasciati intatti perché senza shiftKey o con la chiave di un altro utente. */
  foreignEvents: number
  /** Eventi nostri fuori dalla finestra sincronizzata: li governa il sync del loro mese. */
  outOfWindowEvents: number
  /** Eventi nostri conservati perché il turno del giorno è saltato (non confermato, codice ignoto). */
  protectedEvents: number
}

export interface SyncFailure {
  shiftKey: string
  action: SyncStep['action']
  message: string
}

export interface SyncOutcome {
  ok: boolean
  calendarId: string
  created: number
  updated: number
  deleted: number
  unchanged: number
  skipped: SkippedShift[]
  failures: SyncFailure[]
  foreignEvents: number
  outOfWindowEvents: number
  protectedEvents: number
  /** Valorizzato quando il sync non è nemmeno partito (autorizzazione, token, calendario). */
  error?: string
  /**
   * Il consenso Google non è più valido: l unica via d uscita è rifarlo. È un campo a
   * sé e non una frase da riconoscere nel messaggio, perché l interfaccia ci attacca
   * un bottone e un messaggio non è un contratto.
   */
  needsReauth?: boolean
}
