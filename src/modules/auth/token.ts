import { jwtVerify, SignJWT } from 'jose'

export const SESSION_COOKIE = 'turni_session'
export const OAUTH_STATE_COOKIE = 'turni_oauth_state'
export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30

function keyFrom(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signSession(
  userId: string,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(keyFrom(secret))
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret))
    return typeof payload.sub === 'string' ? { userId: payload.sub } : null
  } catch {
    return null
  }
}
