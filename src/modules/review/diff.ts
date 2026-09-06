import { compactCode } from '@/modules/codes/normalize'
import { isColonnaDiServizio } from '@/modules/extract/band-schema'
import { normalizeColumn } from '@/modules/extract/schema'

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

/** `correctedAt` valorizzato con `correctedCode` null significa «il foglio qui è vuoto». */
export function effectiveCode(cell: DiffCell): string | null {
  if ((cell.correctedAt ?? null) !== null) return cell.correctedCode ?? null
  return cell.code
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
