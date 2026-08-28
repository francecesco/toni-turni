import { OAuth2Client } from 'google-auth-library'
import { requireEnv } from '@/lib/env'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  // Permette di creare calendari secondari e di gestire gli eventi solo su quelli
  // creati dall app. Serve per il calendario dedicato: con `calendar.events` da
  // solo, la creazione di un calendario risponde 403. Non dà accesso agli altri
  // calendari dell utente.
  'https://www.googleapis.com/auth/calendar.app.created',
]

export function googleClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirectUri: `${requireEnv('APP_URL')}/api/auth/google/callback`,
  })
}

export class EmailNotVerifiedError extends Error {}

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

  // L intero modello di autorizzazione (chi diventa referente, chi risulta invitata)
  // si basa su questa email: senza il controllo, basterebbe un indirizzo non
  // verificato per impersonare chiunque.
  if (payload.email_verified !== true) {
    throw new EmailNotVerifiedError('Google non ha verificato questo indirizzo email')
  }

  return {
    email: payload.email,
    name: payload.name ?? payload.email,
    refreshToken: tokens.refresh_token ?? null,
  }
}
