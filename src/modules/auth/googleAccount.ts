import type { OAuth2Client } from 'google-auth-library'
import { prisma } from '@/lib/db'
import { decryptSecret } from '@/lib/crypto'
import { googleClient } from './google'

/** Contesto di cifratura del refresh token: lega il blob al suo utente (AAD). */
export function refreshTokenContext(userId: string): string {
  return `google_refresh:${userId}`
}

export class GoogleAccountMissingError extends Error {
  constructor(userId: string) {
    super(`Nessun account Google collegato per l utente ${userId}`)
    this.name = 'GoogleAccountMissingError'
  }
}

export class GoogleReauthRequiredError extends Error {
  constructor(userId: string) {
    super(`Il consenso Google dell utente ${userId} va rinnovato`)
    this.name = 'GoogleReauthRequiredError'
  }
}

export interface GoogleAccountState {
  calendarId: string | null
  /** ok | needs_reauth */
  status: string
}

export async function readGoogleAccountState(userId: string): Promise<GoogleAccountState | null> {
  // Il refresh token non esce da qui: chi deve solo sapere se c è un calendario
  // non ha motivo di vederlo.
  const row = await prisma.googleAccount.findUnique({
    where: { userId },
    select: { calendarId: true, status: true },
  })
  return row ? { calendarId: row.calendarId, status: row.status } : null
}

export async function setCalendarId(userId: string, calendarId: string): Promise<void> {
  // updateMany e non upsert: senza un consenso Google non esiste un account da
  // creare, e inventarne uno senza token non servirebbe a nulla.
  await prisma.googleAccount.updateMany({ where: { userId }, data: { calendarId } })
}

/**
 * Scollega il calendario dedicato: l id torna null, il token resta. È il gesto
 * esplicito con cui una persona autorizza l app a crearne uno nuovo al prossimo
 * sync, quando quello collegato non esiste più su Google.
 */
export async function clearCalendarId(userId: string): Promise<void> {
  await prisma.googleAccount.updateMany({ where: { userId }, data: { calendarId: null } })
}

export async function markNeedsReauth(userId: string): Promise<void> {
  await prisma.googleAccount.updateMany({ where: { userId }, data: { status: 'needs_reauth' } })
}

export async function markReauthResolved(userId: string): Promise<void> {
  await prisma.googleAccount.updateMany({ where: { userId }, data: { status: 'ok' } })
}

/**
 * Client OAuth pronto per le chiamate a nome dell utente: `OAuth2Client` rinnova
 * l access token dal refresh token quando serve, quindi non ne conserviamo nessuno.
 */
export async function googleClientForUser(userId: string): Promise<OAuth2Client> {
  const row = await prisma.googleAccount.findUnique({
    where: { userId },
    select: { refreshToken: true, status: true },
  })
  if (!row) throw new GoogleAccountMissingError(userId)
  if (row.status === 'needs_reauth') throw new GoogleReauthRequiredError(userId)

  const refreshToken = decryptSecret(row.refreshToken, refreshTokenContext(userId))

  const client = googleClient()
  client.setCredentials({ refresh_token: refreshToken })
  return client
}
