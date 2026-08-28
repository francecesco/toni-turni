import { isColonnaDiServizio, normalizeColumn } from '@/modules/extract'
import type { Role } from '@/modules/auth/policy'

/**
 * Chi vede quale colonna. Logica pura: la usano sia le pagine sia le server
 * action, e la regola invariante 6 dice che il controllo sta lato server, non
 * nell interfaccia.
 *
 * **L identità di una colonna è una sola in tutto il progetto**: `normalizeColumn`
 * (`@/modules/extract`), che tiene solo lettere e cifre. Qui non se ne deriva una
 * seconda: la versione precedente di questo modulo compattava gli spazi ma teneva
 * la punteggiatura, e con quella regola `SARA DP.` letto in una banda e `SARA DP`
 * nell altra erano due colonne diverse — la stessa infermiera spaccata in due
 * mezzi mesi. Lo stesso vale per il riconoscimento delle colonne di servizio, che
 * è `isColonnaDiServizio` della fusione delle bande e non un secondo elenco.
 */

export interface AliasLike {
  /** Chiave normalizzata (`normalizeColumn`), non un testo da mostrare. */
  label: string
  userId: string | null
  ignored: boolean
}

export interface Viewer {
  id: string
  role: Role
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
  const perChiave = new Map(aliases.map((alias) => [normalizeColumn(alias.label), alias]))

  return columns.filter((column) => {
    const alias = perChiave.get(normalizeColumn(column)) ?? null
    if (alias?.ignored) return false
    if (alias === null && isColonnaDiServizio(column)) return false
    return canSeeColumn(viewer, alias)
  })
}
