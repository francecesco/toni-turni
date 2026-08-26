import { addDays, ROME_TZ } from '@/lib/time'
import type { CalendarSlot, ShiftCodeDef } from './types'

export function toCalendarSlot(def: ShiftCodeDef, isoDate: string): CalendarSlot {
  if (def.kind === 'unknown') return { type: 'none' }

  if (def.startTime === null || def.endTime === null) {
    // Google tratta la data di fine degli eventi all-day come esclusiva.
    return { type: 'allDay', start: { date: isoDate }, end: { date: addDays(isoDate, 1) } }
  }

  const endDate = def.crossesMidnight ? addDays(isoDate, 1) : isoDate

  return {
    type: 'timed',
    start: { dateTime: `${isoDate}T${def.startTime}:00`, timeZone: ROME_TZ },
    end: { dateTime: `${endDate}T${def.endTime}:00`, timeZone: ROME_TZ },
  }
}
