import { cookies } from 'next/headers'
import { requireEnv } from '@/lib/env'
import { DEFAULT_TTL_SECONDS, SESSION_COOKIE, signSession, verifySession } from './token'

export async function openSessionCookie(userId: string): Promise<void> {
  const token = await signSession(userId, requireEnv('SESSION_SECRET'))
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEFAULT_TTL_SECONDS,
  })
}

export async function closeSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function readSessionCookie(): Promise<{ userId: string } | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  return token ? verifySession(token, requireEnv('SESSION_SECRET')) : null
}
