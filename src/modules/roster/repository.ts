import { prisma } from '@/lib/db'
import { listShiftCodes, matchCode } from '@/modules/codes'
import type { Extraction } from '@/modules/extract/schema'

export async function nextVersion(year: number, month: number, ward: string): Promise<number> {
  const ultima = await prisma.roster.findFirst({
    where: { year, month, ward },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return (ultima?.version ?? 0) + 1
}

export async function createRoster(input: {
  year: number
  month: number
  ward: string
  imagePath: string
}): Promise<{ id: string; version: number }> {
  const version = await nextVersion(input.year, input.month, input.ward)
  const created = await prisma.roster.create({
    data: { ...input, version, status: 'uploaded' },
    select: { id: true, version: true },
  })
  return created
}

/**
 * Salva le celle risolvendo ogni codice letto con la legenda: il testo grezzo resta
 * sempre, il codice risolto è null quando la legenda non lo conosce — sarà l utente
 * a deciderlo, e non è un errore di estrazione.
 */
export async function saveExtraction(
  rosterId: string,
  extraction: Extraction,
  meta: { provider: string; rawOutput: string },
): Promise<{ cells: number; unresolved: number }> {
  const legenda = await listShiftCodes()

  const celle = extraction.cells
    .filter((cell) => cell.code.trim() !== '')
    .map((cell) => {
      const risolto = matchCode(cell.code, legenda)
      return {
        rosterId,
        day: cell.day,
        columnLabel: cell.column,
        rawCode: cell.code,
        code: risolto?.code ?? null,
        confidence: cell.confidence,
        handCorrected: cell.handCorrected,
      }
    })

  await prisma.$transaction([
    prisma.rosterCell.deleteMany({ where: { rosterId } }),
    // createMany in un unica istruzione invece di una create per cella: stesso esito
    // osservabile (niente skipDuplicates, inutile dopo la deleteMany), molto più
    // efficiente sulle ~240 celle di una tabella reale.
    prisma.rosterCell.createMany({ data: celle }),
    prisma.roster.update({
      where: { id: rosterId },
      data: { status: 'extracted', provider: meta.provider, rawOutput: meta.rawOutput },
    }),
  ])

  return { cells: celle.length, unresolved: celle.filter((c) => c.code === null).length }
}

export async function markExtractionFailed(
  rosterId: string,
  rawOutput: string | null,
): Promise<void> {
  await prisma.roster.update({
    where: { id: rosterId },
    data: { status: 'failed', rawOutput },
  })
}

export async function getRosterWithCells(rosterId: string) {
  return prisma.roster.findUnique({
    where: { id: rosterId },
    include: { cells: { orderBy: [{ day: 'asc' }, { columnLabel: 'asc' }] } },
  })
}
