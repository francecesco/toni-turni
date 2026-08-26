import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import { DEFAULT_SHIFT_CODES } from '@/modules/codes/defaults'
import { seedShiftCodes } from '../../../prisma/seed'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient

beforeAll(() => {
  db = createTestDb()
  prisma = db.prisma
})

afterAll(async () => {
  await db.cleanup()
})

describe('seedShiftCodes', () => {
  it('carica tutta la legenda di default', async () => {
    await seedShiftCodes(prisma)
    expect(await prisma.shiftCode.count()).toBe(DEFAULT_SHIFT_CODES.length)
  })

  it('è idempotente e non sovrascrive le modifiche della referente', async () => {
    await seedShiftCodes(prisma)
    await prisma.shiftCode.update({ where: { code: 'M' }, data: { endTime: '13:30' } })

    await seedShiftCodes(prisma)

    const m = await prisma.shiftCode.findUnique({ where: { code: 'M' } })
    expect(m?.endTime).toBe('13:30')
    expect(await prisma.shiftCode.count()).toBe(DEFAULT_SHIFT_CODES.length)
  })
})
