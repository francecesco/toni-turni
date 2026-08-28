import { prisma } from '@/lib/db'
import { authorizeApi } from '@/modules/auth'
import {
  DEFAULT_COLUMNS_PER_BAND,
  DEFAULT_DAY_COLUMN_FRACTION,
  DEFAULT_OVERLAP_FRACTION,
  imageDimensions,
  planBands,
  readRosterImage,
  renderBandPreview,
} from '@/modules/ingest'

/**
 * L anteprima dei tagli disegnata sulla foto: è quello che la referente guarda
 * per capire se le bande cadono sulle colonne della tabella, **prima** di
 * autorizzare l invio al provider AI. Solo la referente, come la foto.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeApi({ referente: true })
  if (!auth.ok) return auth.response

  const { id } = await context.params

  const roster = await prisma.roster.findUnique({
    where: { id },
    select: {
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
  if (roster.columnCount === null) {
    return new Response('Numero di colonne non dichiarato: niente da disegnare', { status: 409 })
  }

  let image: Buffer
  try {
    image = await readRosterImage(id)
  } catch {
    return new Response('Foto non disponibile', { status: 404 })
  }

  const { width, height } = await imageDimensions(image)
  const piano = planBands({
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
  })

  const anteprima = await renderBandPreview(image, piano)

  return new Response(new Uint8Array(anteprima), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' },
  })
}
