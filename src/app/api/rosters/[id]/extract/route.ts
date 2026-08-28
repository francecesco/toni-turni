import { prisma } from '@/lib/db'
import { authorizeApi } from '@/modules/auth'
import {
  DEFAULT_COLUMNS_PER_BAND,
  DEFAULT_DAY_COLUMN_FRACTION,
  DEFAULT_OVERLAP_FRACTION,
  imageDimensions,
  planBands,
  readRosterImage,
} from '@/modules/ingest'
import { ensureExtractionWorker, prepareExtraction } from '@/modules/roster'

/**
 * L atto esplicito con cui la referente autorizza l invio della foto al provider
 * AI (regola invariante 9). Registra l autorizzazione, crea le bande pendenti e
 * **risponde subito**: leggere una tabella sono 10-20 minuti e non può stare
 * dentro una richiesta HTTP. Il worker gira dopo, in-process, con lo stato su
 * SQLite.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeApi({ referente: true })
  if (!auth.ok) return auth.response

  const { id } = await context.params

  const roster = await prisma.roster.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      columnCount: true,
      columnsPerBand: true,
      dayColumnFraction: true,
      areaLeft: true,
      areaTop: true,
      areaRight: true,
      areaBottom: true,
    },
  })
  if (!roster) return new Response('Tabella non trovata', { status: 404 })

  const indietro = (message: string) =>
    Response.redirect(
      new URL(`/rosters/${id}?error=${encodeURIComponent(message)}`, request.url),
      303,
    )

  if (roster.status === 'extracted') {
    return indietro('Questa tabella è già stata letta per intero')
  }
  if (roster.columnCount === null) {
    return indietro(
      'Il numero di colonne della tabella non è stato dichiarato: ricarica la foto indicandolo',
    )
  }

  let bandCount: number
  try {
    const image = await readRosterImage(id)
    const { width, height } = await imageDimensions(image)
    bandCount = planBands({
      width,
      height,
      columns: roster.columnCount,
      columnsPerBand: roster.columnsPerBand ?? DEFAULT_COLUMNS_PER_BAND,
      dayColumnFraction: roster.dayColumnFraction ?? DEFAULT_DAY_COLUMN_FRACTION,
      overlapFraction: DEFAULT_OVERLAP_FRACTION,
      area: {
        left: roster.areaLeft ?? 0,
        top: roster.areaTop ?? 0,
        right: roster.areaRight ?? 1,
        bottom: roster.areaBottom ?? 1,
      },
    }).length
  } catch (error) {
    return indietro(`Non si riesce a preparare le bande: ${(error as Error).message}`)
  }

  await prepareExtraction(id, bandCount, new Date())

  // Volutamente non attesa: la risposta parte adesso, il lavoro continua dopo.
  void ensureExtractionWorker()

  return Response.redirect(new URL(`/rosters/${id}`, request.url), 303)
}
