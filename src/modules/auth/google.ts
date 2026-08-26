import { OAuth2Client } from 'google-auth-library'
import { requireEnv } from '@/lib/env'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
]

export function googleClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirectUri: `${requireEnv('APP_URL')}/api/auth/google/callback`,
  })
}

export function buildGoogleAuthUrl(state: string): string {
  return googleClient().generateAuthUrl({
    access_type: 'offline', // necessario per ottenere il refresh token
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  })
}

export async function exchangeGoogleCode(
  code: string,
): Promise<{ email: string; name: string; refreshToken: string | null }> {
  const client = googleClient()
  const { tokens } = await client.getToken(code)
  if (!tokens.id_token) throw new Error('Google non ha restituito un id_token')

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv('GOOGLE_CLIENT_ID'),
  })
  const payload = ticket.getPayload()
  if (!payload?.email) throw new Error('Google non ha restituito un indirizzo email')

  return {
    email: payload.email,
    name: payload.name ?? payload.email,
    refreshToken: tokens.refresh_token ?? null,
  }
}
