import { compactCode } from '@/modules/codes/normalize'
import { isColonnaDiServizio, normalizeColumn } from '@/modules/extract'

/**
 * Il diff fra due versioni della stessa tabella, calcolato **al volo** dalle celle:
 * nessuna tabella nuova, niente da tenere allineato. Confronta il codice
 * **effettivo** (la correzione a mano se c è, altrimenti la lettura) nella forma
 * compatta, perché `M 2°P` e `M2°P` sono lo stesso turno. Le colonne di servizio
 * e i totali non sono turni di nessuno e non compaiono.
 */
export type ChangeKind = 'changed' | 'added' | 'removed'

export interface DiffCell {
  day: number
  columnLabel: string
  /** Il testo letto dal modello, anche quando non è un codice della legenda. */
  rawCode: string
  code: string | null
  correctedCode?: string | null
  correctedAt?: Date | null
}

export interface VersionChange {
  /** Etichetta come sta sul foglio nuovo (o su quello vecchio se la colonna è sparita). */
  columnLabel: string
  /** Chiave `normalizeColumn`, per raggruppare. */
  columnKey: string
  day: number
  kind: ChangeKind
  before: string | null
  after: string | null
}

/**
 * `correctedAt` valorizzato con `correctedCode` null significa «il foglio qui è
 * vuoto».
 *
 * Senza correzione vale la lettura del modello, e se il codice non è in legenda
 * (`code` null) vale il **grezzo**: `M h13` è un turno letto e da rileggere, non una
 * casella vuota, e confonderli lo farebbe comparire nel diff come «tolto».
 */
export function effectiveCode(cell: DiffCell): string | null {
  if ((cell.correctedAt ?? null) !== null) return cell.correctedCode ?? null
  return cell.code ?? (cell.rawCode.trim() === '' ? null : cell.rawCode)
}

function key(cell: DiffCell): string {
  return `${normalizeColumn(cell.columnLabel)}:${cell.day}`
}

function same(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return compactCode(a) === compactCode(b)
}

export function diffVersions(previous: DiffCell[], next: DiffCell[]): VersionChange[] {
  const prima = new Map(previous.filter((c) => !isColonnaDiServizio(c.columnLabel)).map((c) => [key(c), c]))
  const dopo = new Map(next.filter((c) => !isColonnaDiServizio(c.columnLabel)).map((c) => [key(c), c]))

  const changes: VersionChange[] = []
  for (const k of new Set([...prima.keys(), ...dopo.keys()])) {
    const p = prima.get(k) ?? null
    const n = dopo.get(k) ?? null
    const before = p ? effectiveCode(p) : null
    const after = n ? effectiveCode(n) : null
    if (same(before, after)) continue

    const riferimento = n ?? p
    if (!riferimento) continue
    changes.push({
      columnLabel: riferimento.columnLabel,
      columnKey: normalizeColumn(riferimento.columnLabel),
      day: riferimento.day,
      kind: before === null ? 'added' : after === null ? 'removed' : 'changed',
      before,
      after,
    })
  }

  return changes.sort((a, b) => a.columnKey.localeCompare(b.columnKey) || a.day - b.day)
}

/**
 * Un diff sa solo quello che le due letture hanno visto, e su una lettura parziale
 * metà dei suoi verdetti sono indovinati:
 *
 * - se la **corrente** non è letta per intero, un `removed` può essere un giorno non
 *   letto invece di un turno tolto dal foglio;
 * - se la **precedente** non era letta per intero, un `added` può essere un turno che
 *   c era già ed era solo sfuggito a quella lettura.
 *
 * Si toglie il verdetto, non il cambiamento: un `changed` è stato visto due volte e
 * resta. Un avviso che grida al lupo su ogni tabella insegna a ignorarlo.
 */
export function filterChangesByCoverage(
  changes: VersionChange[],
  coverage: { previousFullyRead: boolean; currentFullyRead: boolean },
): VersionChange[] {
  return changes.filter((c) => {
    if (c.kind === 'removed') return coverage.currentFullyRead
    if (c.kind === 'added') return coverage.previousFullyRead
    return true
  })
}
