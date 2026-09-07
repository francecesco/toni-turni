import { prisma } from '@/lib/db'
import { requireEnv } from '@/lib/env'
import { authorizeApi } from '@/modules/auth'
import { rosterImageExists } from '@/modules/ingest'
import { ensureExtractionWorker, prepareExtraction } from '@/modules/roster'

/**
 * L atto esplicito con cui la referente autorizza l invio della foto al provider
 * AI (regola invariante 9). Registra l autorizzazione e **risponde subito**:
 * leggere una tabella e il rilevamento del riquadro piu almeno una chiamata al
 * modello, e non può stare dentro una richiesta
 * HTTP. Il worker gira dopo, in-process, con lo stato su SQLite.
 *
 * Il piano delle bande **non** si fa qui: dipende dal riquadro rilevato sulla
 * foto, che costa secondi di calcolo, e rifarlo in due posti sarebbe due volte la
 * stessa geometria con il rischio che divergano. Lo fa il job alla prima passata;
 * una tabella autorizzata e senza bande è ripresa da `resumableRosters`.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeApi({ referente: true })
  if (!auth.ok) return auth.response

  const { id } = await context.params
  // Da `APP_URL`, non da `request.url`: il server standalone lo compone con l host su
  // cui ascolta (`0.0.0.0:3000`) e il browser finirebbe su https://0.0.0.0.
  const appUrl = requireEnv('APP_URL')

  const roster = await prisma.roster.findUnique({
    where: { id },
    select: { id: true, status: true },
  })
  if (!roster) return new Response('Tabella non trovata', { status: 404 })

  const indietro = (message: string) =>
    Response.redirect(
      new URL(`/rosters/${id}?error=${encodeURIComponent(message)}`, appUrl),
      303,
    )

  if (roster.status === 'extracted') {
    return indietro('Questa tabella è già stata letta per intero')
  }

  // Un `stat`, non un rilevamento: se la retention ha già cancellato la foto,
  // autorizzare un invio che non può avvenire lascerebbe solo un guasto da capire.
  if (!(await rosterImageExists(id))) {
    return indietro(
      'La foto non è più sul server: è stata cancellata dalla conservazione automatica',
    )
  }

  await prepareExtraction(id, [], new Date())

  // Volutamente non attesa: la risposta parte adesso, il lavoro continua dopo.
  void ensureExtractionWorker()

  return Response.redirect(new URL(`/rosters/${id}`, appUrl), 303)
}
