import { ROME_TZ, wallClockToUtc } from '@/lib/time'
import { parseShiftKey } from './shiftKey'
import type {
  DesiredEvent,
  EventPayload,
  EventTime,
  ExistingEvent,
  SkippedShift,
  SyncPlan,
  SyncStep,
} from './types'

type NormalizedSlot =
  | { kind: 'timed'; startMs: number; endMs: number }
  | { kind: 'allDay'; startDate: string; endDate: string }
  | { kind: 'sconosciuto' }

function normalizeDesiredTime(start: EventTime, end: EventTime): NormalizedSlot {
  if ('dateTime' in start && 'dateTime' in end) {
    return {
      kind: 'timed',
      startMs: wallClockToUtc(start.dateTime, start.timeZone || ROME_TZ).getTime(),
      endMs: wallClockToUtc(end.dateTime, end.timeZone || ROME_TZ).getTime(),
    }
  }
  if ('date' in start && 'date' in end) {
    return { kind: 'allDay', startDate: start.date, endDate: end.date }
  }
  return { kind: 'sconosciuto' }
}

type GoogleTime = { dateTime?: string | null; date?: string | null; timeZone?: string | null } | null | undefined

/**
 * Google restituisce gli orari con l offset già applicato ("...T21:00:00+02:00").
 * Il confronto va fatto sull istante, non sulla stringa: altrimenti ogni evento
 * risulterebbe diverso a ogni giro e il sync non sarebbe più idempotente — e nella
 * notte del cambio d ora i due estremi hanno offset diversi.
 */
function normalizeExistingTime(start: GoogleTime, end: GoogleTime): NormalizedSlot {
  if (start?.dateTime && end?.dateTime) {
    const startMs = new Date(start.dateTime).getTime()
    const endMs = new Date(end.dateTime).getTime()
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { kind: 'sconosciuto' }
    return { kind: 'timed', startMs, endMs }
  }
  if (start?.date && end?.date) {
    return { kind: 'allDay', startDate: start.date, endDate: end.date }
  }
  return { kind: 'sconosciuto' }
}

function sameSlot(a: NormalizedSlot, b: NormalizedSlot): boolean {
  if (a.kind === 'timed' && b.kind === 'timed') {
    return a.startMs === b.startMs && a.endMs === b.endMs
  }
  if (a.kind === 'allDay' && b.kind === 'allDay') {
    return a.startDate === b.startDate && a.endDate === b.endDate
  }
  return false
}

function text(value: string | null | undefined): string {
  return value ?? ''
}

/** Vero solo se l evento su Google dice già esattamente ciò che vogliamo dire. */
export function sameEvent(payload: EventPayload, existing: ExistingEvent): boolean {
  if (text(existing.summary) !== payload.summary) return false
  if (text(existing.description) !== payload.description) return false
  if (text(existing.location) !== text(payload.location)) return false
  // Google omette `transparency` sugli eventi che occupano il tempo.
  if ((existing.transparency ?? 'opaque') !== payload.transparency) return false
  if (text(existing.extendedProperties?.private?.code) !== payload.extendedProperties.private.code) {
    return false
  }

  return sameSlot(
    normalizeDesiredTime(payload.start, payload.end),
    normalizeExistingTime(existing.start, existing.end),
  )
}

interface OwnedEvent {
  event: ExistingEvent
  shiftKey: string
  date: string
}

/**
 * Calcola il piano di sync. La regola che conta più di tutte: un evento entra nel
 * piano solo se porta una `shiftKey` valida di questo utente e con la data dentro
 * la finestra sincronizzata. Tutto il resto viene contato e lasciato dov è.
 */
export function planSync(input: {
  userId: string
  window: { from: string; to: string }
  desired: DesiredEvent[]
  skipped: SkippedShift[]
  protectedKeys: string[]
  existing: ExistingEvent[]
}): SyncPlan {
  const protectedKeys = new Set(input.protectedKeys)

  let foreignEvents = 0
  let outOfWindowEvents = 0
  const owned = new Map<string, OwnedEvent[]>()

  for (const event of input.existing) {
    // Un evento annullato non esiste più: né da aggiornare né da cancellare.
    if (event.status === 'cancelled') continue

    const parsed = parseShiftKey(event.extendedProperties?.private?.shiftKey ?? '')
    if (!parsed || parsed.userId !== input.userId) {
      foreignEvents += 1
      continue
    }

    if (parsed.date < input.window.from || parsed.date > input.window.to) {
      outOfWindowEvents += 1
      continue
    }

    const key = `${parsed.userId}:${parsed.date}`
    const group = owned.get(key) ?? []
    group.push({ event, shiftKey: key, date: parsed.date })
    owned.set(key, group)
  }

  const upserts: SyncStep[] = []
  const deletions: SyncStep[] = []
  let protectedEvents = 0

  const desiderati = [...input.desired].sort((a, b) => a.date.localeCompare(b.date))

  for (const d of desiderati) {
    const group = (owned.get(d.shiftKey) ?? []).sort((a, b) => a.event.id.localeCompare(b.event.id))
    const [survivor, ...duplicati] = group

    if (!survivor) {
      upserts.push({
        action: 'create',
        shiftKey: d.shiftKey,
        date: d.date,
        assignmentId: d.assignmentId,
        payload: d.payload,
      })
    } else if (sameEvent(d.payload, survivor.event)) {
      upserts.push({
        action: 'keep',
        shiftKey: d.shiftKey,
        date: d.date,
        assignmentId: d.assignmentId,
        eventId: survivor.event.id,
      })
    } else {
      upserts.push({
        action: 'update',
        shiftKey: d.shiftKey,
        date: d.date,
        assignmentId: d.assignmentId,
        eventId: survivor.event.id,
        payload: d.payload,
      })
    }

    // Un doppione porta la nostra chiave: cancellarlo è l unico modo di tornare
    // idempotenti dopo un sync interrotto a metà.
    for (const duplicato of duplicati) {
      deletions.push({
        action: 'delete',
        shiftKey: d.shiftKey,
        date: d.date,
        eventId: duplicato.event.id,
        reason: 'evento_duplicato',
      })
    }

    owned.delete(d.shiftKey)
  }

  // Quello che resta è nostro, dentro la finestra, e non corrisponde a nessun turno.
  for (const [key, group] of [...owned.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (protectedKeys.has(key)) {
      protectedEvents += group.length
      continue
    }

    for (const { event, date } of group.sort((a, b) => a.event.id.localeCompare(b.event.id))) {
      deletions.push({
        action: 'delete',
        shiftKey: key,
        date,
        eventId: event.id,
        reason: 'turno_rimosso',
      })
    }
  }

  return {
    steps: [...upserts, ...deletions],
    skipped: input.skipped,
    foreignEvents,
    outOfWindowEvents,
    protectedEvents,
  }
}
