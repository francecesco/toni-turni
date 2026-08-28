import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../../helpers/db'
import { SESSION_COOKIE, verifySession } from '@/modules/auth/token'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

let db: ReturnType<typeof createTestDb>
let dbModule: typeof import('@/lib/db')
let route: typeof import('@/app/api/auth/dev-login/route')

beforeAll(async () => {
  db = createTestDb()
  process.env.DATABASE_URL = db.url
  process.env.APP_URL = 'http://localhost:3000'
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  dbModule = await import('@/lib/db')
  route = await import('@/app/api/auth/dev-login/route')
})

afterAll(async () => {
  await dbModule.prisma.$disconnect()
  await db.cleanup()
})

beforeEach(async () => {
  cookieStore.clear()
  vi.unstubAllEnvs()
  await dbModule.prisma.googleAccount.deleteMany()
  await dbModule.prisma.user.deleteMany()
})

function devLoginRequest(email: string): Request {
  const body = new URLSearchParams({ email })
  return new Request('http://localhost:3000/api/auth/dev-login', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

async function createReferente(email = 'anna@example.com') {
  return dbModule.prisma.user.create({
    data: { email, displayName: 'Anna Rossi', role: 'REFERENTE' },
  })
}

describe('POST /api/auth/dev-login — inerzia in produzione', () => {
  it('risponde 404 con NODE_ENV=production anche se la variabile è impostata e l utente esiste', async () => {
    await createReferente()
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com')

    const response = await route.POST(devLoginRequest('anna@example.com'))

    expect(response.status).toBe(404)
    expect(cookieStore.has(SESSION_COOKIE)).toBe(false)
  })
})

describe('POST /api/auth/dev-login — cancello chiuso per default', () => {
  it('risponde 404 se la variabile non è impostata', async () => {
    await createReferente()

    const response = await route.POST(devLoginRequest('anna@example.com'))

    expect(response.status).toBe(404)
    expect(cookieStore.has(SESSION_COOKIE)).toBe(false)
  })

  it('risponde 404 se la variabile è impostata ma vuota', async () => {
    await createReferente()
    vi.stubEnv('DEV_LOGIN_EMAILS', '   ')

    const response = await route.POST(devLoginRequest('anna@example.com'))

    expect(response.status).toBe(404)
    expect(cookieStore.has(SESSION_COOKIE)).toBe(false)
  })
})

describe('POST /api/auth/dev-login — elenco chiuso e utenti esistenti', () => {
  it('risponde 404 per un email fuori dall elenco, anche se l utente esiste', async () => {
    await createReferente('anna@example.com')
    await dbModule.prisma.user.create({
      data: { email: 'carla@example.com', displayName: 'Carla', role: 'NURSE' },
    })
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com')

    const response = await route.POST(devLoginRequest('carla@example.com'))

    expect(response.status).toBe(404)
    expect(cookieStore.has(SESSION_COOKIE)).toBe(false)
  })

  it('risponde 404 per un email nell elenco ma assente dal database, senza crearla', async () => {
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com')

    const response = await route.POST(devLoginRequest('anna@example.com'))

    expect(response.status).toBe(404)
    expect(cookieStore.has(SESSION_COOKIE)).toBe(false)
    expect(await dbModule.prisma.user.count()).toBe(0)
  })
})

describe('POST /api/auth/dev-login — sessione identica a quella di Google', () => {
  it('apre la sessione dell utente in elenco e rimanda alla home', async () => {
    const user = await createReferente()
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com')

    const response = await route.POST(devLoginRequest('anna@example.com'))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000/')

    const token = cookieStore.get(SESSION_COOKIE)
    expect(token).toBeDefined()
    // Lo stesso cookie e la stessa firma del login Google: se cambiassero, l accesso
    // di prova starebbe provando un altra applicazione.
    await expect(verifySession(token as string, process.env.SESSION_SECRET as string)).resolves.toEqual({
      userId: user.id,
    })
  })

  it('accetta l email con maiuscole e spazi, come il login Google', async () => {
    const user = await createReferente()
    vi.stubEnv('DEV_LOGIN_EMAILS', ' Anna@Example.com ')

    const response = await route.POST(devLoginRequest('  ANNA@example.com '))

    expect(response.status).toBe(303)
    const token = cookieStore.get(SESSION_COOKIE)
    await expect(verifySession(token as string, process.env.SESSION_SECRET as string)).resolves.toEqual({
      userId: user.id,
    })
  })

  it('non fabbrica nessun GoogleAccount: il sync deve chiedere di autorizzare Google', async () => {
    await createReferente()
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com')

    await route.POST(devLoginRequest('anna@example.com'))

    expect(await dbModule.prisma.googleAccount.count()).toBe(0)
  })
})
