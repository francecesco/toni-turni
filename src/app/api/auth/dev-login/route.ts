import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireEnv } from '@/lib/env'
import { devLoginAllows, isDevLoginEnabled, normalizeEmail, openSessionCookie } from '@/modules/auth'

/**
 * Accesso di prova per il solo sviluppo. Vedi `src/modules/auth/devLogin.ts` per le
 * tre condizioni e il perché di ognuna.
 *
 * Ogni rifiuto è un 404 identico, senza corpo utile: la route non deve rivelare né
 * di esistere, né se un email è configurata, né se un utente è nel database.
 *
 * È un POST e non un GET perché apre una sessione: un GET si attiverebbe anche da
 * un link o da un `<img src>` su una pagina qualsiasi che il browser apre.
 *
 * Non crea nessun `GoogleAccount`: un refresh token inventato, cifrato nel
 * database, farebbe fallire il sync in modo incomprensibile o — peggio — farebbe
 * credere che il collegamento con Google funzioni. Senza account Google il sync
 * dice «autorizza Google», che è la verità.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isDevLoginEnabled()) return notFound()

  const form = await request.formData()
  const email = normalizeEmail(String(form.get('email') ?? ''))

  if (!devLoginAllows(email)) return notFound()

  // Nessuna creazione: solo un utente che esiste già può essere impersonato.
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.warn(
      `Accesso di prova: nessun utente con email ${email} nel database. Creane uno prima (vedi .env.example).`,
    )
    return notFound()
  }

  // La sessione è la stessa del login Google — stesso cookie, stessa firma, stessa
  // scadenza — perché un cookie diverso vorrebbe dire provare un altra applicazione.
  await openSessionCookie(user.id)

  console.warn(`Accesso di prova senza Google usato come ${user.email} (${user.role}).`)

  // 303 fa eseguire al browser un GET sulla home invece di ripetere il POST.
  return NextResponse.redirect(requireEnv('APP_URL'), { status: 303 })
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}
