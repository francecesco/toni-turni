import { prisma } from '@/lib/db'
import { authorizeApi } from '@/modules/auth'
import { ensureExtractionWorker, rosterProgress } from '@/modules/roster'

export const dynamic = 'force-dynamic'

/**
 * L avanzamento che la pagina interroga mentre aspetta. Aperta a ogni utente
 * autenticato — sono conteggi, non celle: nessun turno di nessuno esce da qui.
 *
 * Ogni interrogazione sveglia anche il worker: se il processo è stato riavviato a
 * metà estrazione, è questo che la fa riprendere senza che nessuno debba
 * ricordarsene. Il worker riprende solo le tabelle già autorizzate.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authorizeApi()
  if (!auth.ok) return auth.response

  const { id } = await context.params

  const esiste = await prisma.roster.findUnique({ where: { id }, select: { id: true } })
  if (!esiste) return new Response('Tabella non trovata', { status: 404 })

  const progresso = await rosterProgress(id)

  if (progresso.status === 'extracting' || progresso.status === 'interrupted') {
    void ensureExtractionWorker()
  }

  return Response.json(progresso, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
