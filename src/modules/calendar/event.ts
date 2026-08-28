import { compactCode, matchCode, toCalendarSlot, type ShiftCodeDef } from '@/modules/codes'
import { isIsoDate, shiftKeyFor } from './shiftKey'
import type { AssignmentRecord, DesiredEvent, EventPayload, SkippedShift } from './types'

const DESCRIPTION = 'Turno dalla tabella del reparto, sincronizzato da Toni Turni.'

/**
 * Titolo leggibile sul telefono: etichetta e codice della carta, senza ripetere il
 * codice quando è già l etichetta (es. "Notte", non "Notte (NOTTE)").
 */
function summaryFor(def: ShiftCodeDef): string {
  return compactCode(def.code) === compactCode(def.label)
    ? def.label
    : `${def.label} (${def.code})`
}

export function buildEventPayload(
  def: ShiftCodeDef,
  isoDate: string,
  shiftKey: string,
): EventPayload | null {
  const slot = toCalendarSlot(def, isoDate)
  if (slot.type === 'none') return null

  return {
    summary: summaryFor(def),
    description: DESCRIPTION,
    // Solo i turni di lavoro occupano il tempo: riposi, smonti e ferie restano
    // "libero", così non fanno sembrare occupata una giornata che non lo è.
    transparency: def.kind === 'work' ? 'opaque' : 'transparent',
    ...(def.location ? { location: def.location } : {}),
    start: slot.start,
    end: slot.end,
    extendedProperties: { private: { shiftKey, code: def.code } },
  }
}

/**
 * Traduce i turni in eventi desiderati. Tutto ciò che non si può tradurre con
 * certezza finisce fra i saltati e la sua chiave fra le `protectedKeys`: un turno
 * che non sappiamo leggere non autorizza a cancellare l evento già presente.
 */
export function buildDesiredEvents(input: {
  userId: string
  shifts: AssignmentRecord[]
  codes: ShiftCodeDef[]
  window?: { from: string; to: string }
}): { desired: DesiredEvent[]; skipped: SkippedShift[]; protectedKeys: string[] } {
  const desired: DesiredEvent[] = []
  const skipped: SkippedShift[] = []
  const protectedKeys = new Set<string>()
  const seenDates = new Set<string>()

  const ordered = [...input.shifts].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
  )

  for (const shift of ordered) {
    const skip = (reason: SkippedShift['reason']) => {
      skipped.push({ date: shift.date, code: shift.code, reason })
      // La chiave si può proteggere solo se la data è utilizzabile.
      if (isIsoDate(shift.date)) protectedKeys.add(shiftKeyFor(input.userId, shift.date))
    }

    if (!isIsoDate(shift.date)) {
      skipped.push({ date: shift.date, code: shift.code, reason: 'data_non_valida' })
      continue
    }

    if (input.window && (shift.date < input.window.from || shift.date > input.window.to)) {
      // Fuori finestra: non è nostro compito qui, e la chiave non va protetta
      // perché il sync del mese giusto se ne occupa.
      skipped.push({ date: shift.date, code: shift.code, reason: 'fuori_intervallo' })
      continue
    }

    if (seenDates.has(shift.date)) {
      skip('giorno_duplicato')
      continue
    }

    if (!shift.confirmed) {
      skip('non_confermato')
      seenDates.add(shift.date)
      continue
    }

    const def = matchCode(shift.code, input.codes)
    if (!def) {
      skip('codice_sconosciuto')
      seenDates.add(shift.date)
      continue
    }

    const shiftKey = shiftKeyFor(input.userId, shift.date)
    const payload = buildEventPayload(def, shift.date, shiftKey)
    if (!payload) {
      // kind unknown: il codice esiste in legenda ma non ha un significato certo.
      skip('codice_sconosciuto')
      seenDates.add(shift.date)
      continue
    }

    seenDates.add(shift.date)
    desired.push({
      shiftKey,
      date: shift.date,
      code: def.code,
      assignmentId: shift.id,
      payload,
    })
  }

  return { desired, skipped, protectedKeys: [...protectedKeys] }
}
