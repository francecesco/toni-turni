import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient

beforeAll(() => {
  db = createTestDb()
  prisma = db.prisma
})

afterAll(async () => {
  await db.cleanup()
})

describe('schema', () => {
  it('persiste un utente con ruolo di default NURSE', async () => {
    const user = await prisma.user.create({
      data: { email: 'anna@example.com', displayName: 'Anna' },
    })
    expect(user.role).toBe('NURSE')
  })

  it('impedisce due utenti con la stessa email', async () => {
    await prisma.user.create({ data: { email: 'mery@example.com', displayName: 'Mery' } })
    await expect(
      prisma.user.create({ data: { email: 'mery@example.com', displayName: 'Doppione' } }),
    ).rejects.toThrow()
  })

  it('cancella il GoogleAccount insieme all utente', async () => {
    const user = await prisma.user.create({
      data: { email: 'carmen@example.com', displayName: 'Carmen' },
    })
    await prisma.googleAccount.create({
      data: { userId: user.id, refreshToken: 'cifrato' },
    })

    await prisma.user.delete({ where: { id: user.id } })

    expect(await prisma.googleAccount.findUnique({ where: { userId: user.id } })).toBeNull()
  })

  it('salva un codice turno con orari e flag oltre mezzanotte', async () => {
    const code = await prisma.shiftCode.create({
      data: {
        code: 'NOTTE',
        label: 'Notte',
        kind: 'work',
        startTime: '21:00',
        endTime: '07:00',
        crossesMidnight: true,
      },
    })
    expect(code.crossesMidnight).toBe(true)
    expect(code.needsReview).toBe(false)
  })
})
