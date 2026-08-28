import { authorizeApi } from '@/modules/auth'
import { readRosterImage } from '@/modules/ingest'

/**
 * La foto della tabella. **Solo la referente**: l immagine contiene i turni di
 * tutte le colleghe, e la regola invariante 6 dice che un infermiera vede solo la
 * propria colonna. Se la retention l ha già cancellata, 404 e non un errore.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeApi({ referente: true })
  if (!auth.ok) return auth.response

  const { id } = await context.params

  let image: Buffer
  try {
    image = await readRosterImage(id)
  } catch {
    return new Response('Foto non disponibile: cancellata dalla retention o mai salvata', {
      status: 404,
    })
  }

  return new Response(new Uint8Array(image), {
    headers: {
      'Content-Type': 'image/jpeg',
      // Dati personali di terzi: niente cache condivisa, niente indicizzazione.
      'Cache-Control': 'private, no-store',
    },
  })
}
