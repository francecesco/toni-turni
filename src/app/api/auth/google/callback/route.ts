import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { requireEnv } from '@/lib/env'
import {
  decideRegistration,
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
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const store = await cookies()
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value
  store.delete(OAUTH_STATE_COOKIE)

  // Lo state protegge dal CSRF sul callback: senza confronto, un attaccante
  // potrebbe far completare a un utente un login che non ha iniziato.
  if (!code || !state || state !== expectedState) return loginError('state')

  const profile = await exchangeGoogleCode(code)
  const email = normalizeEmail(profile.email)

  const existing = await prisma.user.findUnique({ where: { email } })

  if (!existing) {
    const [existingUsers, invites] = await Promise.all([
      prisma.user.count(),
      prisma.invite.findMany({ where: { usedAt: null } }),
    ])

    const decision = decideRegistration(email, {
      existingUsers,
      invitedEmails: invites.map((invite) => invite.email),
    })

    if (!decision.allowed) return loginError('not_invited')

    const created = await prisma.user.create({
      data: { email, displayName: profile.name, role: decision.role },
    })
    await prisma.invite.updateMany({ where: { email }, data: { usedAt: new Date() } })
    await openSessionCookie(created.id)
  } else {
    await openSessionCookie(existing.id)
  }

  const user = existing ?? (await prisma.user.findUniqueOrThrow({ where: { email } }))

  // Google restituisce il refresh token solo al primo consenso: se manca,
  // conserviamo quello già salvato invece di sovrascriverlo con null.
  if (profile.refreshToken) {
    await prisma.googleAccount.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        refreshToken: encryptSecret(profile.refreshToken, `google_refresh:${user.id}`),
        status: 'ok',
      },
      update: {
        refreshToken: encryptSecret(profile.refreshToken, `google_refresh:${user.id}`),
        status: 'ok',
      },
    })
  }

  return NextResponse.redirect(requireEnv('APP_URL'))
}
