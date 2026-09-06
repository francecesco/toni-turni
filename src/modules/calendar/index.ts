export type {
  AssignmentRecord,
  DeleteReason,
  DesiredEvent,
  EventPayload,
  EventTime,
  ExistingEvent,
  SkipReason,
  SkippedShift,
  SyncFailure,
  SyncOutcome,
  SyncPlan,
  SyncStep,
} from './types'

export type { CalendarApi, CalendarSummary, CalendarTransport } from './api'
export { CalendarApiError, CalendarRefusedError, createCalendarApi, isReauthNeeded } from './api'

export type { DedicatedCalendar } from './dedicated'
export { DEDICATED_CALENDAR_SUMMARY, DedicatedCalendarMissingError,
  resolveDedicatedCalendar } from './dedicated'

export { buildDesiredEvents, buildEventPayload } from './event'
export { planSync, sameEvent } from './diff'
export { belongsTo, isIsoDate, parseShiftKey, shiftKeyFor } from './shiftKey'
export type { MonthWindow } from './window'
export { daysInMonth, isoDateFor, monthWindow } from './window'

export type { SyncAuthorization } from './policy'
export { authorizeSync } from './policy'
export { describeOutcome } from './report'
export { withSyncLock } from './lock'
export { listAssignmentsForSync, recordFailure, recordSynced } from './repository'

export type { SyncActor, SyncRosterInput } from './sync'
export { syncRoster } from './sync'
