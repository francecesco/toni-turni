import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb } from '../../helpers/db'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

let db: ReturnType<typeof createTestDb>
let dbModule: typeof import('@/lib/db')
let session: typeof import('@/modules/auth/session')
let guards: typeof import('@/modules/auth/guards')

beforeAll(async () => {
  db = createTestDb()
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  dbModule = await import('@/lib/db')
  session = await import('@/modules/auth/session')
  guards = await import('@/modules/auth/guards')
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
})

describe('getCurrentUser', () => {
  it('senza cookie di sessione restituisce null', async () => {
    expect(await guards.getCurrentUser()).toBeNull()
  })

  it('con un cookie di sessione valido restituisce l utente dal database', async () => {
    const user = await dbModule.prisma.user.create({
      data: { email: 'anna@example.com', displayName: 'Anna Rossi', role: 'REFERENTE' },
    })
    await session.openSessionCookie(user.id)

    expect(await guards.getCurrentUser()).toEqual({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: 'REFERENTE',
    })
  })
})

describe('requireUser', () => {
  it('senza sessione rimanda alla pagina di accesso', async () => {
    await expect(guards.requireUser()).rejects.toThrow('REDIRECT:/login')
  })
})

describe('requireReferente', () => {
  it('con un utente NURSE rimanda alla home', async () => {
    const user = await dbModule.prisma.user.create({
      data: { email: 'mery@example.com', displayName: 'Mery', role: 'NURSE' },
    })
    await session.openSessionCookie(user.id)

    await expect(guards.requireReferente()).rejects.toThrow('REDIRECT:/')
  })

  it('con un utente REFERENTE restituisce l utente', async () => {
    const user = await dbModule.prisma.user.create({
      data: { email: 'anna@example.com', displayName: 'Anna Rossi', role: 'REFERENTE' },
    })
    await session.openSessionCookie(user.id)

    const current = await guards.requireReferente()
    expect(current.role).toBe('REFERENTE')
    expect(current.id).toBe(user.id)
  })
})
