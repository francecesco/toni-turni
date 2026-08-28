import { prisma } from '@/lib/db'
import { listShiftCodes, matchCode } from '@/modules/codes'
import { storedExtractionSchema, type BandFailure, type Extraction } from '@/modules/extract'

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
 *
 * `meta.missingBands` sono le bande che il modello non ha letto, o ha letto solo
 * in parte (estrazione a ritagli): finiscono nel database come JSON e portano lo
 * stato a `partial`. Sono la ragione per cui questo stato esiste: tre celle non
 * lette per un problema tecnico non devono somigliare a tre celle vuote sul
 * foglio, perché una cella che manca in silenzio è un turno che scompare. Un
 * salvataggio senza buchi le **ripulisce**, altrimenti resterebbe la
 * dichiarazione di un buco che non c è più.
 *
 * `meta.conflicts` sono le celle che la fusione ha scartato o risolto: un
 * segnale che prima si fermava in memoria.
 *
 * L estrazione passa da `storedExtractionSchema` **prima** di toccare il database
 * (regola invariante 3): la fusione garantisce per costruzione due delle tre
 * invarianti, ma "per costruzione" è una proprietà del codice di oggi e non un
 * controllo, e questa è l ultima porta prima dei dati dell utente.
 */
export async function saveExtraction(
  rosterId: string,
  extraction: Extraction,
  meta: {
    provider: string
    rawOutput: string
    missingBands?: BandFailure[]
    conflicts?: number
  },
): Promise<{ cells: number; unresolved: number }> {
  const validata = storedExtractionSchema.parse(extraction)
  const legenda = await listShiftCodes()

  const celle = validata.cells
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

  const buchi = meta.missingBands ?? []
  const parziale = buchi.length > 0

  await prisma.$transaction([
    prisma.rosterCell.deleteMany({ where: { rosterId } }),
    // createMany in un unica istruzione invece di una create per cella: stesso esito
    // osservabile (niente skipDuplicates, inutile dopo la deleteMany), molto più
    // efficiente sulle ~240 celle di una tabella reale.
    prisma.rosterCell.createMany({ data: celle }),
    prisma.roster.update({
      where: { id: rosterId },
      data: {
        status: parziale ? 'partial' : 'extracted',
        provider: meta.provider,
        rawOutput: meta.rawOutput,
        missingBands: parziale ? JSON.stringify(buchi) : null,
        conflicts: meta.conflicts ?? 0,
      },
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

/** Coordinate della tabella, senza le celle: mese e reparto per chi sincronizza. */
export async function getRosterMonth(rosterId: string): Promise<{
  id: string
  year: number
  month: number
  ward: string
  version: number
} | null> {
  return prisma.roster.findUnique({
    where: { id: rosterId },
    select: { id: true, year: true, month: true, ward: true, version: true },
  })
}

export async function getRosterWithCells(rosterId: string) {
  return prisma.roster.findUnique({
    where: { id: rosterId },
    include: { cells: { orderBy: [{ day: 'asc' }, { columnLabel: 'asc' }] } },
  })
}
