import type { Role } from '@/modules/auth/policy'

/**
 * Chi vede quale colonna. Logica pura: la usano sia le pagine sia le server
 * action, e la regola invariante 6 dice che il controllo sta lato server, non
 * nell interfaccia.
 */

export interface AliasLike {
  label: string
  userId: string | null
  ignored: boolean
}

export interface Viewer {
  id: string
  role: Role
}

/** Forma canonica del nome di colonna: è la chiave di confronto in tutto il modulo. */
export function normalizeLabel(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ')
}

// Per parola intera: "TOTINI" è un cognome plausibile, "TOT M" no.
const NON_NURSE_PATTERNS = [/^AIUTO\b/, /^TOT\b/]

/** Colonne che non sono assegnazioni di turno: aiuti e totali. */
export function isNonNurseLabel(label: string): boolean {
  const normalizzata = normalizeLabel(label)
  return NON_NURSE_PATTERNS.some((pattern) => pattern.test(normalizzata))
}

export function canSeeColumn(viewer: Viewer, alias: AliasLike | null): boolean {
  if (viewer.role === 'REFERENTE') return true
  if (alias === null || alias.ignored) return false
  return alias.userId === viewer.id
}

/**
 * Le colonne che questo utente può vedere, nell ordine in cui arrivano.
 * Una colonna ignorata non è di nessuno: non compare nemmeno alla referente.
 */
export function visibleColumns(
  viewer: Viewer,
  columns: string[],
  aliases: AliasLike[],
): string[] {
  const perLabel = new Map(aliases.map((alias) => [normalizeLabel(alias.label), alias]))

  return columns.filter((column) => {
    const alias = perLabel.get(normalizeLabel(column)) ?? null
    if (alias?.ignored) return false
    if (alias === null && isNonNurseLabel(column)) return false
    return canSeeColumn(viewer, alias)
  })
}
