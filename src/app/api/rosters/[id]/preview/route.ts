import { prisma } from '@/lib/db'
import { authorizeApi } from '@/modules/auth'
import { readRosterImage, renderRosterPreview } from '@/modules/ingest'
import { daysInMonth } from '@/modules/roster'

/**
 * L anteprima dei tagli disegnata sul riquadro raddrizzato: è quello che la
 * referente guarda per capire se il rilevamento ha trovato la tabella e dove
 * cadranno i confini fra una lettura e l altra, **prima** di autorizzare l invio
 * al provider AI. Solo la referente, come la foto: l immagine contiene i turni di
 * tutte le colleghe.
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
    select: { year: true, month: true },
  })
  if (!roster) return new Response('Tabella non trovata', { status: 404 })

  let image: Buffer
  try {
    image = await readRosterImage(id)
  } catch {
    return new Response('Foto non disponibile', { status: 404 })
  }

  let anteprima: Buffer
  try {
    anteprima = await renderRosterPreview(image, {
      daysInMonth: daysInMonth(roster.year, roster.month),
    })
  } catch (error) {
    // Il riquadro non trovato è un esito da dire, non un 500: la foto va rifatta.
    return new Response(
      `Non si riesce a riconoscere la tabella nella foto: ${(error as Error).message}`,
      { status: 409 },
    )
  }

  return new Response(new Uint8Array(anteprima), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' },
  })
}
