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

async function createReferente(email = 'anna@example.com'): Promise<{ id: string; email: string }> {
  const referente = await dbModule.prisma.user.create({
    data: { email, displayName: 'Anna Rossi', role: 'REFERENTE' },
  })
  await session.openSessionCookie(referente.id)
  return referente
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

  it('removeShiftCode rimanda alla home e non scrive nulla se chiamata da un utente NURSE', async () => {
    const nurse = await dbModule.prisma.user.create({
      data: { email: 'mery@example.com', displayName: 'Mery', role: 'NURSE' },
    })
    await session.openSessionCookie(nurse.id)
    await dbModule.prisma.shiftCode.create({
      data: { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
    })

    const form = new FormData()
    form.set('code', 'M')

    await expect(codesActions.removeShiftCode(form)).rejects.toThrow('REDIRECT:/')
    expect(await dbModule.prisma.shiftCode.findUnique({ where: { code: 'M' } })).not.toBeNull()
  })

  it('revokeInvite rimanda alla home e non scrive nulla se chiamata da un utente NURSE', async () => {
    const nurse = await dbModule.prisma.user.create({
      data: { email: 'mery@example.com', displayName: 'Mery', role: 'NURSE' },
    })
    await session.openSessionCookie(nurse.id)
    await dbModule.prisma.invite.create({
      data: { email: 'nuova@example.com', invitedBy: 'anna@example.com' },
    })

    const form = new FormData()
    form.set('email', 'nuova@example.com')

    await expect(usersActions.revokeInvite(form)).rejects.toThrow('REDIRECT:/')
    expect(await dbModule.prisma.invite.findUnique({ where: { email: 'nuova@example.com' } })).not
      .toBeNull()
  })
})

describe('saveShiftCode e inviteUser sotto una sessione REFERENTE', () => {
  it('saveShiftCode crea davvero il codice turno con gli orari attesi', async () => {
    await createReferente()

    const result = await codesActions.saveShiftCode(shiftCodeForm())

    expect(result).toEqual({ errors: [] })
    const row = await dbModule.prisma.shiftCode.findUniqueOrThrow({ where: { code: 'M' } })
    expect(row.startTime).toBe('07:00')
    expect(row.endTime).toBe('14:00')
  })

  it('inviteUser crea davvero la riga Invite con invitedBy uguale all email della referente', async () => {
    const referente = await createReferente()

    const result = await usersActions.inviteUser(inviteForm())

    expect(result).toEqual({ errors: [] })
    const invite = await dbModule.prisma.invite.findUniqueOrThrow({
      where: { email: 'nuova@example.com' },
    })
    expect(invite.invitedBy).toBe(referente.email)
  })
})

describe('saveShiftCode — errori di validazione arrivano all utente', () => {
  it('un orario non nel formato HH:mm rimanda a /settings/codes con il messaggio e non scrive', async () => {
    await createReferente()

    const form = shiftCodeForm()
    form.set('startTime', '7')

    await expect(codesActions.saveShiftCode(form)).rejects.toThrow(
      'REDIRECT:/settings/codes?error=',
    )
    expect(await dbModule.prisma.shiftCode.count()).toBe(0)
  })
})

describe('inviteUser — errori di validazione arrivano all utente', () => {
  it('un email non valida rimanda a /settings/users con il messaggio e non scrive', async () => {
    await createReferente()

    const form = new FormData()
    form.set('email', 'non-un-email')

    await expect(usersActions.inviteUser(form)).rejects.toThrow(
      'REDIRECT:/settings/users?error=Indirizzo%20email%20non%20valido',
    )
    expect(await dbModule.prisma.invite.count()).toBe(0)
  })
})

describe('saveShiftCode — collisione di codici equivalenti', () => {
  it('salvare "m" dopo "M" viene rifiutato e non crea una seconda riga', async () => {
    await createReferente()
    await codesActions.saveShiftCode(shiftCodeForm())

    const collidingForm = shiftCodeForm()
    collidingForm.set('code', 'm')

    await expect(codesActions.saveShiftCode(collidingForm)).rejects.toThrow(
      'REDIRECT:/settings/codes?error=',
    )
    expect(await dbModule.prisma.shiftCode.count()).toBe(1)
    const row = await dbModule.prisma.shiftCode.findUniqueOrThrow({ where: { code: 'M' } })
    expect(row.endTime).toBe('14:00')
  })

  it('salvare di nuovo lo stesso codice "M" con un altro orario aggiorna la riga esistente', async () => {
    await createReferente()
    await codesActions.saveShiftCode(shiftCodeForm())

    const updateForm = shiftCodeForm()
    updateForm.set('endTime', '13:30')

    const result = await codesActions.saveShiftCode(updateForm)

    expect(result).toEqual({ errors: [] })
    expect(await dbModule.prisma.shiftCode.count()).toBe(1)
    const row = await dbModule.prisma.shiftCode.findUniqueOrThrow({ where: { code: 'M' } })
    expect(row.endTime).toBe('13:30')
  })
})

describe('removeShiftCode — doppio Elimina (due schede aperte)', () => {
  it('elimina il codice e una seconda chiamata sullo stesso codice non lancia', async () => {
    await createReferente()
    await dbModule.prisma.shiftCode.create({
      data: { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
    })

    const form = new FormData()
    form.set('code', 'M')

    await codesActions.removeShiftCode(form)
    expect(await dbModule.prisma.shiftCode.findUnique({ where: { code: 'M' } })).toBeNull()

    await expect(codesActions.removeShiftCode(form)).resolves.toBeUndefined()
  })
})
