import { prisma } from '@/lib/db'

/**
 * Le versioni della stessa tabella: stesso `(year, month, ward)`, `version` crescente.
 * Serve al diff (Fase 5) e al riporto delle conferme. Conta solo l ultima versione:
 * qui non si costruisce una storia, si trova «quella prima di questa».
 */
export interface RosterVersionRef {
  id: string
  year: number
  month: number
  ward: string
  version: number
}

export async function previousVersionOf(rosterId: string): Promise<RosterVersionRef | null> {
  const corrente = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { year: true, month: true, ward: true, version: true },
  })
  if (!corrente) return null

  return prisma.roster.findFirst({
    where: {
      year: corrente.year,
      month: corrente.month,
      ward: corrente.ward,
      version: { lt: corrente.version },
    },
    orderBy: { version: 'desc' },
    select: { id: true, year: true, month: true, ward: true, version: true },
  })
}

/** Le celle di una versione con i soli campi che il diff e il riporto usano. */
export async function cellsForDiff(rosterId: string) {
  return prisma.rosterCell.findMany({
    where: { rosterId },
    orderBy: [{ columnLabel: 'asc' }, { day: 'asc' }],
    select: {
      day: true,
      columnLabel: true,
      rawCode: true,
      code: true,
      correctedCode: true,
      correctedAt: true,
      correctedBy: true,
    },
  })
}
