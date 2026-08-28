import { prisma } from '@/lib/db'
import { withWriteLock } from '@/modules/roster'
import { normalizeLabel, type AliasLike } from './access'

/**
 * `ColumnAlias`: il nome di colonna letto dalla foto ("CRISTINA", "SARA DP.")
 * associato a un utente. L associazione si fa una volta e vale per i mesi
 * successivi. Un nome non associato **non blocca niente**: resta da assegnare.
 */

export type ColumnAliasRow = AliasLike

function toRow(row: { label: string; userId: string | null; ignored: boolean }): ColumnAliasRow {
  return { label: row.label, userId: row.userId, ignored: row.ignored }
}

export async function listColumnAliases(): Promise<ColumnAliasRow[]> {
  const rows = await prisma.columnAlias.findMany({ orderBy: { label: 'asc' } })
  return rows.map(toRow)
}

export async function aliasFor(label: string): Promise<ColumnAliasRow | null> {
  const row = await prisma.columnAlias.findUnique({ where: { label: normalizeLabel(label) } })
  return row === null ? null : toRow(row)
}

/** Le colonne che l estrazione ha letto su questa tabella, in ordine alfabetico. */
export async function rosterColumnLabels(rosterId: string): Promise<string[]> {
  const rows = await prisma.rosterCell.findMany({
    where: { rosterId },
    distinct: ['columnLabel'],
    orderBy: { columnLabel: 'asc' },
    select: { columnLabel: true },
  })
  return rows.map((r) => r.columnLabel)
}

export async function assignColumnToUser(label: string, userId: string): Promise<void> {
  const normalizzata = normalizeLabel(label)
  await withWriteLock(async () => {
    await prisma.columnAlias.upsert({
      where: { label: normalizzata },
      create: { label: normalizzata, userId, ignored: false },
      update: { userId, ignored: false },
    })
  })
}

/** Una colonna che non è il turno di nessuno: aiuti, totali, intestazioni spurie. */
export async function ignoreColumnLabel(label: string): Promise<void> {
  const normalizzata = normalizeLabel(label)
  await withWriteLock(async () => {
    await prisma.columnAlias.upsert({
      where: { label: normalizzata },
      create: { label: normalizzata, userId: null, ignored: true },
      update: { userId: null, ignored: true },
    })
  })
}

export async function clearColumnLabel(label: string): Promise<void> {
  const normalizzata = normalizeLabel(label)
  await withWriteLock(async () => {
    await prisma.columnAlias.deleteMany({ where: { label: normalizzata } })
  })
}
