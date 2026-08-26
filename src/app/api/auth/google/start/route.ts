import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { buildGoogleAuthUrl, OAUTH_STATE_COOKIE } from '@/modules/auth'

export async function GET() {
  const state = randomBytes(16).toString('hex')

  const store = await cookies()
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(buildGoogleAuthUrl(state))
}
