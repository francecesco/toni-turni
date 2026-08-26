import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TTL_SECONDS, SESSION_COOKIE, signSession, verifySession } from '@/modules/auth/token'

const SECRET = 'segreto-di-test-abbastanza-lungo-32+'

// Usato solo dal describe "openSessionCookie" più sotto: il mock di next/headers va
// dichiarato qui, al livello più alto del file, perché vi.mock viene issato sopra
// gli import solo quando compare a questo livello (non dentro un describe/it).
const sessionCookieSetCalls: Array<[string, string, Record<string, unknown>]> = []

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string, options: Record<string, unknown>) =>
      void sessionCookieSetCalls.push([name, value, options]),
    delete: () => {},
  }),
}))

describe('signSession / verifySession', () => {
  it('restituisce l id utente firmato', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(token, SECRET)).toEqual({ userId: 'user-123' })
  })

  it('rifiuta un token firmato con un altro segreto', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(token, 'un-altro-segreto-abbastanza-lungo')).toBeNull()
  })

  it('rifiuta un token manomesso', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(`${token}x`, SECRET)).toBeNull()
  })

  it('rifiuta un token scaduto', async () => {
    const token = await signSession('user-123', SECRET, -60)
    expect(await verifySession(token, SECRET)).toBeNull()
  })

  it('rifiuta una stringa che non è un token', async () => {
    expect(await verifySession('qualsiasi-cosa', SECRET)).toBeNull()
  })
})

describe('openSessionCookie — flag del cookie di sessione', () => {
  let session: typeof import('@/modules/auth/session')

  beforeAll(async () => {
    process.env.SESSION_SECRET = SECRET
    session = await import('@/modules/auth/session')
  })

  it('imposta httpOnly, sameSite=lax e un maxAge', async () => {
    sessionCookieSetCalls.length = 0
    await session.openSessionCookie('user-123')

    expect(sessionCookieSetCalls).toHaveLength(1)
    const [name, , options] = sessionCookieSetCalls[0]!
    expect(name).toBe(SESSION_COOKIE)
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.maxAge).toBe(DEFAULT_TTL_SECONDS)
  })
})
