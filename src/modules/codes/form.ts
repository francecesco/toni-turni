import type { ShiftCodeDef, ShiftKind } from './types'

const KINDS: ShiftKind[] = ['work', 'absence', 'info', 'unknown']
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export type ParseResult =
  | { ok: true; value: ShiftCodeDef }
  | { ok: false; errors: string[] }

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

/** Validazione pura: nessuna dipendenza da Next o dal database. */
export function parseShiftCodeForm(form: FormData): ParseResult {
  const errors: string[] = []

  const code = text(form, 'code')
  const label = text(form, 'label')
  const kind = text(form, 'kind')
  const startTime = text(form, 'startTime')
  const endTime = text(form, 'endTime')
  const location = text(form, 'location')
  const color = text(form, 'color')

  if (code === '') errors.push('Il codice è obbligatorio')
  if (label === '') errors.push('L etichetta è obbligatoria')
  if (!KINDS.includes(kind as ShiftKind)) errors.push('Tipo di turno non valido')

  const hasStart = startTime !== ''
  const hasEnd = endTime !== ''

  if (hasStart !== hasEnd) {
    errors.push('Indica entrambi gli orari, o nessuno per un evento tutto il giorno')
  }
  if (hasStart && !TIME_PATTERN.test(startTime)) errors.push('Orario di inizio non valido (HH:mm)')
  if (hasEnd && !TIME_PATTERN.test(endTime)) errors.push('Orario di fine non valido (HH:mm)')

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      code,
      label,
      kind: kind as ShiftKind,
      startTime: hasStart ? startTime : null,
      endTime: hasEnd ? endTime : null,
      // Una fine che precede l inizio significa che il turno scavalca la mezzanotte.
      crossesMidnight: hasStart && hasEnd ? endTime <= startTime : false,
      location: location === '' ? null : location,
      color: color === '' ? null : color,
      // Salvare dalle impostazioni è la conferma della referente: l avviso sparisce.
      needsReview: false,
    },
  }
}
