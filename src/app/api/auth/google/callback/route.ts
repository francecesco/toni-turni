import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { requireEnv } from '@/lib/env'
import {
  decideRegistration,
  EmailNotVerifiedError,
  exchangeGoogleCode,
  normalizeEmail,
  OAUTH_STATE_COOKIE,
  openSessionCookie,
} from '@/modules/auth'

function loginError(reason: string) {
  return NextResponse.redirect(`${requireEnv('APP_URL')}/login?error=${reason}`)
}

export async function GET(request: Request) {
  const url = new URL(request.url)

  // Google torna con ?error=... quando l utente annulla il consenso o qualcosa va
  // storto sul suo lato: senza questo controllo il messaggio mostrato in /login
  // sarebbe quello (fuorviante) dello state scaduto.
  const oauthError = url.searchParams.get('error')
  if (oauthError) return loginError(oauthError === 'access_denied' ? 'denied' : 'google')

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const store = await cookies()
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value
  store.delete(OAUTH_STATE_COOKIE)

  // Lo state protegge dal CSRF sul callback: senza confronto, un attaccante
  // potrebbe far completare a un utente un login che non ha iniziato.
  if (!code || !state || state !== expectedState) return loginError('state')

  let profile
  try {
    profile = await exchangeGoogleCode(code)
  } catch (error) {
    if (error instanceof EmailNotVerifiedError) return loginError('email_not_verified')
    // Qualsiasi altro errore (es. "invalid_grant" quando l URL di callback viene
    // ricaricato o si torna indietro col browser su un code già consumato) non deve
    // finire sulla pagina di errore generica di Next. Logghiamo solo il nome
    // dell errore: il messaggio/response di Google può contenere il code o i token.
    console.error('Scambio del code OAuth non riuscito:', error instanceof Error ? error.name : 'errore sconosciuto')
    return loginError('google')
  }

  const email = normalizeEmail(profile.email)

  const existing = await prisma.user.findUnique({ where: { email } })

  if (!existing) {
    let created
    try {
      created = await prisma.$transaction(async (tx) => {
        const existingUsers = await tx.user.count()
        const invites = await tx.invite.findMany({ where: { usedAt: null } })

        const decision = decideRegistration(email, {
          existingUsers,
          invitedEmails: invites.map((invite) => invite.email),
        })
        if (!decision.allowed) return null

        const user = await tx.user.create({
          data: { email, displayName: profile.name, role: decision.role },
        })

        // Si marca usato esattamente l invito che ha autorizzato l accesso, non una
        // riga cercata di nuovo per stringa: il confronto qui sopra è normalizzato.
        const matched = invites.find((invite) => normalizeEmail(invite.email) === email)
        if (matched) {
          await tx.invite.update({ where: { email: matched.email }, data: { usedAt: new Date() } })
        }

        return user
      })
    } catch {
      // Registrazione concorrente sulla stessa email: la seconda perde la corsa.
      return loginError('retry')
    }

    if (!created) return loginError('not_invited')
    await openSessionCookie(created.id)
  } else {
    await openSessionCookie(existing.id)
  }

  const user = existing ?? (await prisma.user.findUniqueOrThrow({ where: { email } }))

  // Google restituisce il refresh token solo al primo consenso: se manca,
  // conserviamo quello già salvato invece di sovrascriverlo con null.
  if (profile.refreshToken) {
    const encryptedRefreshToken = encryptSecret(profile.refreshToken, `google_refresh:${user.id}`)
    await prisma.googleAccount.upsert({
      where: { userId: user.id },
      create: { userId: user.id, refreshToken: encryptedRefreshToken, status: 'ok' },
      update: { refreshToken: encryptedRefreshToken, status: 'ok' },
    })
  }

  return NextResponse.redirect(requireEnv('APP_URL'))
}
