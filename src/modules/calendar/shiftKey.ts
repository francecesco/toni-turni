/**
 * `shiftKey` è l unico marchio che distingue un evento creato dall app da un
 * appuntamento personale dell utente. Update e delete filtrano su questa chiave:
 * se il parsing è permissivo, il filtro non protegge più nulla. Per questo qui si
 * valida in modo stretto in entrambe le direzioni.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Vera solo per una data che esiste davvero nel calendario (no 2026-02-30). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false

  const [, year, month, day] = match
  const asUtc = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(asUtc.getTime())) return false

  // Date normalizza il 30 febbraio in un 2 marzo: il confronto lo smaschera.
  return (
    asUtc.getUTCFullYear() === Number(year) &&
    asUtc.getUTCMonth() + 1 === Number(month) &&
    asUtc.getUTCDate() === Number(day)
  )
}

export function shiftKeyFor(userId: string, isoDate: string): string {
  if (userId === '' || userId.includes(':')) {
    throw new Error(`userId non ammesso in una shiftKey: "${userId}"`)
  }
  if (!isIsoDate(isoDate)) {
    throw new Error(`Data non valida per una shiftKey: "${isoDate}"`)
  }
  return `${userId}:${isoDate}`
}

export function parseShiftKey(key: string): { userId: string; date: string } | null {
  const parts = key.split(':')
  if (parts.length !== 2) return null

  const [userId, date] = parts
  if (userId === '' || !isIsoDate(date)) return null

  return { userId, date }
}

/** Vero solo se la chiave è nostra e appartiene proprio a questo utente. */
export function belongsTo(key: string | undefined | null, userId: string): boolean {
  if (typeof key !== 'string') return false
  const parsed = parseShiftKey(key)
  return parsed !== null && parsed.userId === userId
}
