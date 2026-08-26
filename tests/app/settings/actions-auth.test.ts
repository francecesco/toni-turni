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

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

let db: ReturnType<typeof createTestDb>
let dbModule: typeof import('@/lib/db')
let session: typeof import('@/modules/auth/session')
let codesActions: typeof import('@/app/settings/codes/actions')
let usersActions: typeof import('@/app/settings/users/actions')

beforeAll(async () => {
  db = createTestDb()
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  dbModule = await import('@/lib/db')
  session = await import('@/modules/auth/session')
  codesActions = await import('@/app/settings/codes/actions')
  usersActions = await import('@/app/settings/users/actions')
})

afterAll(async () => {
  await dbModule.prisma.$disconnect()
  await db.cleanup()
})

beforeEach(async () => {
  cookieStore.clear()
  await dbModule.prisma.googleAccount.deleteMany()
  await dbModule.prisma.invite.deleteMany()
  await dbModule.prisma.shiftCode.deleteMany()
  await dbModule.prisma.user.deleteMany()
})

function shiftCodeForm(): FormData {
  const form = new FormData()
  form.set('code', 'M')
  form.set('label', 'Mattino')
  form.set('kind', 'work')
  form.set('startTime', '07:00')
  form.set('endTime', '14:00')
  return form
}

function inviteForm(): FormData {
  const form = new FormData()
  form.set('email', 'nuova@example.com')
  return form
}

describe('autorizzazione delle server action di /settings', () => {
  it('saveShiftCode rimanda alla home e non scrive nulla se chiamata da un utente NURSE', async () => {
    const nurse = await dbModule.prisma.user.create({
      data: { email: 'mery@example.com', displayName: 'Mery', role: 'NURSE' },
    })
    await session.openSessionCookie(nurse.id)

    const before = await dbModule.prisma.shiftCode.count()
    await expect(codesActions.saveShiftCode(shiftCodeForm())).rejects.toThrow('REDIRECT:/')
    const after = await dbModule.prisma.shiftCode.count()

    expect(after).toBe(before)
  })

  it('inviteUser rimanda alla home e non scrive nulla se chiamata da un utente NURSE', async () => {
    const nurse = await dbModule.prisma.user.create({
      data: { email: 'mery@example.com', displayName: 'Mery', role: 'NURSE' },
    })
    await session.openSessionCookie(nurse.id)

    const before = await dbModule.prisma.invite.count()
    await expect(usersActions.inviteUser(inviteForm())).rejects.toThrow('REDIRECT:/')
    const after = await dbModule.prisma.invite.count()

    expect(after).toBe(before)
  })
})
