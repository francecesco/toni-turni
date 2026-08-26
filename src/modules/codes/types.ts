export type ShiftKind = 'work' | 'absence' | 'info' | 'unknown'

export interface ShiftCodeDef {
  code: string
  label: string
  kind: ShiftKind
  /** "HH:mm" locale di Europe/Rome; null insieme a endTime per gli eventi tutto il giorno. */
  startTime: string | null
  endTime: string | null
  crossesMidnight: boolean
  location: string | null
  color: string | null
  /** Default incerto: la referente deve confermarlo prima di fidarsene. */
  needsReview: boolean
}

export type CalendarSlot =
  | {
      type: 'timed'
      start: { dateTime: string; timeZone: string }
      end: { dateTime: string; timeZone: string }
    }
  | { type: 'allDay'; start: { date: string }; end: { date: string } }
  | { type: 'none' }
