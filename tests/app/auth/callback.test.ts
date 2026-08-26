import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../../helpers/db'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from '@/modules/auth/token'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

vi.mock('@/modules/auth/google', async () => {
  const actual = await vi.importActual<typeof import('@/modules/auth/google')>(
    '@/modules/auth/google',
  )
  return { ...actual, exchangeGoogleCode: vi.fn() }
})

let db: ReturnType<typeof createTestDb>
let dbModule: typeof import('@/lib/db')
let googleModule: typeof import('@/modules/auth/google')
let route: typeof import('@/app/api/auth/google/callback/route')

const STATE = 'test-state-abc123'

beforeAll(async () => {
  db = createTestDb()
  // Il singleton di @/lib/db e i client OAuth leggono l ambiente al primo import:
  // va impostato prima e la cache dev di Prisma va azzerata.
  process.env.DATABASE_URL = db.url
  process.env.APP_URL = 'http://localhost:3000'
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  dbModule = await import('@/lib/db')
  googleModule = await import('@/modules/auth/google')
  route = await import('@/app/api/auth/google/callback/route')
})

afterAll(async () => {
  await dbModule.prisma.$disconnect()
  await db.cleanup()
})

beforeEach(async () => {
  cookieStore.clear()
  await dbModule.prisma.googleAccount.deleteMany()
  await dbModule.prisma.invite.deleteMany()
  await dbModule.prisma.user.deleteMany()
  vi.mocked(googleModule.exchangeGoogleCode).mockReset()
})

function callbackRequest(params: Record<string, string>): Request {
  const url = new URL('http://localhost:3000/api/auth/google/callback')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url)
}

function locationOf(response: Response): string {
  return response.headers.get('location') ?? ''
}

describe('GET /api/auth/google/callback — state anti-CSRF', () => {
  it('rifiuta uno state diverso da quello nel cookie', async () => {
    cookieStore.set(OAUTH_STATE_COOKIE, STATE)

    const response = await route.GET(callbackRequest({ code: 'auth-code', state: 'altro-state' }))

    expect(locationOf(response)).toBe('http://localhost:3000/login?error=state')
    expect(await dbModule.prisma.user.count()).toBe(0)
  })

  it('rifiuta uno state assente', async () => {
    cookieStore.set(OAUTH_STATE_COOKIE, STATE)

    const response = await route.GET(callbackRequest({ code: 'auth-code' }))

    expect(locationOf(response)).toBe('http://localhost:3000/login?error=state')
    expect(await dbModule.prisma.user.count()).toBe(0)
  })
})

describe('GET /api/auth/google/callback — registrazione', () => {
  it('il primo accesso in assoluto crea la referente e cifra il refresh token', async () => {
    cookieStore.set(OAUTH_STATE_COOKIE, STATE)
    vi.mocked(googleModule.exchangeGoogleCode).mockResolvedValue({
      email: 'anna@example.com',
      name: 'Anna Rossi',
      refreshToken: 'refresh-token-in-chiaro',
    })

    const response = await route.GET(callbackRequest({ code: 'auth-code', state: STATE }))

    expect(locationOf(response)).toBe('http://localhost:3000/')
    expect(cookieStore.has(SESSION_COOKIE)).toBe(true)

    const user = await dbModule.prisma.user.findUniqueOrThrow({
      where: { email: 'anna@example.com' },
    })
    expect(user.role).toBe('REFERENTE')

    const account = await dbModule.prisma.googleAccount.findUniqueOrThrow({
      where: { userId: user.id },
    })
    expect(account.refreshToken).not.toBe('refresh-token-in-chiaro')
    expect(decryptSecret(account.refreshToken, `google_refresh:${user.id}`)).toBe(
      'refresh-token-in-chiaro',
    )
  })

  it('rifiuta un email non invitata quando esiste già un utente', async () => {
    await dbModule.prisma.user.create({
      data: { email: 'anna@example.com', displayName: 'Anna Rossi', role: 'REFERENTE' },
    })

    cookieStore.set(OAUTH_STATE_COOKIE, STATE)
    vi.mocked(googleModule.exchangeGoogleCode).mockResolvedValue({
      email: 'sconosciuta@example.com',
      name: 'Sconosciuta',
      refreshToken: null,
    })

    const response = await route.GET(callbackRequest({ code: 'auth-code', state: STATE }))

    expect(locationOf(response)).toBe('http://localhost:3000/login?error=not_invited')
    expect(await dbModule.prisma.user.count()).toBe(1)
  })

  it('accetta un email invitata anche se la riga Invite ha maiuscole e spazi diversi', async () => {
    const referente = await dbModule.prisma.user.create({
      data: { email: 'anna@example.com', displayName: 'Anna Rossi', role: 'REFERENTE' },
    })
    await dbModule.prisma.invite.create({
      data: { email: '  Mery@Example.com ', invitedBy: referente.id },
    })

    cookieStore.set(OAUTH_STATE_COOKIE, STATE)
    vi.mocked(googleModule.exchangeGoogleCode).mockResolvedValue({
      email: 'mery@example.com',
      name: 'Mery',
      refreshToken: null,
    })

    const response = await route.GET(callbackRequest({ code: 'auth-code', state: STATE }))

    expect(locationOf(response)).toBe('http://localhost:3000/')

    const user = await dbModule.prisma.user.findUniqueOrThrow({
      where: { email: 'mery@example.com' },
    })
    expect(user.role).toBe('NURSE')

    const invite = await dbModule.prisma.invite.findUniqueOrThrow({
      where: { email: '  Mery@Example.com ' },
    })
    expect(invite.usedAt).not.toBeNull()
  })
})

describe('GET /api/auth/google/callback — refresh token mancante su un accesso successivo', () => {
  it('non azzera il refresh token già salvato quando Google non lo restituisce di nuovo', async () => {
    const user = await dbModule.prisma.user.create({
      data: { email: 'anna@example.com', displayName: 'Anna Rossi', role: 'REFERENTE' },
    })
    const previousEncrypted = encryptSecret('vecchio-refresh-token', `google_refresh:${user.id}`)
    await dbModule.prisma.googleAccount.create({
      data: { userId: user.id, refreshToken: previousEncrypted, status: 'ok' },
    })

    cookieStore.set(OAUTH_STATE_COOKIE, STATE)
    vi.mocked(googleModule.exchangeGoogleCode).mockResolvedValue({
      email: 'anna@example.com',
      name: 'Anna Rossi',
      refreshToken: null,
    })

    const response = await route.GET(callbackRequest({ code: 'auth-code', state: STATE }))

    expect(locationOf(response)).toBe('http://localhost:3000/')

    const account = await dbModule.prisma.googleAccount.findUniqueOrThrow({
      where: { userId: user.id },
    })
    expect(account.refreshToken).toBe(previousEncrypted)
  })
})

describe('GET /api/auth/google/callback — email non verificata', () => {
  it('rifiuta un email Google non verificata e non crea nessun utente', async () => {
    cookieStore.set(OAUTH_STATE_COOKIE, STATE)
    vi.mocked(googleModule.exchangeGoogleCode).mockRejectedValue(
      new googleModule.EmailNotVerifiedError('non verificata'),
    )

    const response = await route.GET(callbackRequest({ code: 'auth-code', state: STATE }))

    expect(locationOf(response)).toBe('http://localhost:3000/login?error=email_not_verified')
    expect(await dbModule.prisma.user.count()).toBe(0)
  })
})
