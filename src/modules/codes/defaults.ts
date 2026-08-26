import type { ShiftCodeDef } from './types'

function work(
  code: string,
  label: string,
  startTime: string,
  endTime: string,
  extra: Partial<ShiftCodeDef> = {},
): ShiftCodeDef {
  return {
    code,
    label,
    kind: 'work',
    startTime,
    endTime,
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: false,
    ...extra,
  }
}

function allDay(code: string, label: string, kind: 'absence' | 'info'): ShiftCodeDef {
  return {
    code,
    label,
    kind,
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: false,
  }
}

const FLOORS = ['1', '2', '4'] as const

const floorShifts: ShiftCodeDef[] = FLOORS.flatMap((floor) => [
  work(`M${floor}°P`, `Mattino ${floor}° piano`, '07:00', '14:00', { location: `${floor}° Piano` }),
  work(`P${floor}°P`, `Pomeriggio ${floor}° piano`, '14:00', '21:00', { location: `${floor}° Piano` }),
])

/**
 * Legenda iniziale, confermata con la referente il 2026-08-26.
 * needsReview: true dove il significato non è ancora certo — l app lo segnala
 * finché la referente non lo corregge in Impostazioni.
 */
export const DEFAULT_SHIFT_CODES: ShiftCodeDef[] = [
  work('M', 'Mattino', '07:00', '14:00'),
  work('P', 'Pomeriggio', '14:00', '21:00'),
  work('M/P', 'Giornata lunga', '07:00', '21:00'),
  work('NOTTE', 'Notte', '21:00', '07:00', { crossesMidnight: true }),
  allDay('SN', 'Smonto notte', 'info'),
  allDay('RP', 'Riposo programmato', 'info'),
  allDay('RIP', 'Riposo', 'info'),
  allDay('F', 'Ferie', 'absence'),
  allDay('ASS', 'Assenza', 'absence'),
  work('M+', 'Mattino prolungato', '07:00', '14:00', { needsReview: true }),
  work('P+', 'Pomeriggio prolungato', '14:00', '21:00', { needsReview: true }),
  work('M RSF', 'Mattino RSF', '07:00', '14:00', { location: 'RSF', needsReview: true }),
  work('P RSF', 'Pomeriggio RSF', '14:00', '21:00', { location: 'RSF', needsReview: true }),
  ...floorShifts,
]
