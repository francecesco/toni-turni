import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let account: typeof import('@/modules/auth/googleAccount')
let crypto: typeof import('@/lib/crypto')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret'
  process.env.APP_URL = 'https://turni.example.com'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  account = await import('@/modules/auth/googleAccount')
  crypto = await import('@/lib/crypto')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.googleAccount.deleteMany()
  await prisma.user.deleteMany()
  await prisma.user.create({
    data: { id: 'utente1', email: 'anna@example.com', displayName: 'Anna' },
  })
})

async function conAccount(over: { status?: string; calendarId?: string | null } = {}) {
  await prisma.googleAccount.create({
    data: {
      userId: 'utente1',
      refreshToken: crypto.encryptSecret('refresh-123', 'google_refresh:utente1'),
      status: over.status ?? 'ok',
      calendarId: over.calendarId ?? null,
    },
  })
}

describe('readGoogleAccountState', () => {
  it('restituisce null quando l utente non ha collegato Google', async () => {
    await expect(account.readGoogleAccountState('utente1')).resolves.toBeNull()
  })

  it('restituisce calendario e stato, mai il token', async () => {
    await conAccount({ calendarId: 'cal1' })

    const stato = await account.readGoogleAccountState('utente1')

    expect(stato).toEqual({ calendarId: 'cal1', status: 'ok' })
  })
})

describe('setCalendarId', () => {
  it('memorizza il calendario dedicato', async () => {
    await conAccount()

    await account.setCalendarId('utente1', 'cal9')

    const riga = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: 'utente1' } })
    expect(riga.calendarId).toBe('cal9')
  })

  it('non crea un account dal nulla se non esiste', async () => {
    await account.setCalendarId('utente1', 'cal9')
    expect(await prisma.googleAccount.count()).toBe(0)
  })
})

describe('clearCalendarId', () => {
  it('scollega il calendario: l id torna null, il token resta', async () => {
    // E il gesto esplicito con cui una persona autorizza l app a creare un
    // calendario nuovo: senza id salvato il prossimo sync ne cerca o ne crea uno.
    await conAccount({ calendarId: 'sparito' })

    await account.clearCalendarId('utente1')

    const riga = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: 'utente1' } })
    expect(riga.calendarId).toBeNull()
    expect(riga.refreshToken).not.toBe('')
    expect(riga.status).toBe('ok')
  })
})

describe('markNeedsReauth', () => {
  it('segna lo stato senza cancellare il token', async () => {
    await conAccount()

    await account.markNeedsReauth('utente1')

    const riga = await prisma.googleAccount.findUniqueOrThrow({ where: { userId: 'utente1' } })
    expect(riga.status).toBe('needs_reauth')
    expect(riga.refreshToken).not.toBe('')
  })
})

describe('googleClientForUser', () => {
  it('costruisce un client con il refresh token decifrato', async () => {
    await conAccount()

    const client = await account.googleClientForUser('utente1')

    expect(client.credentials.refresh_token).toBe('refresh-123')
  })

  it('rifiuta quando l utente non ha collegato Google', async () => {
    await expect(account.googleClientForUser('utente1')).rejects.toBeInstanceOf(
      account.GoogleAccountMissingError,
    )
  })

  it('rifiuta quando il consenso va rinnovato, invece di provare a scrivere', async () => {
    await conAccount({ status: 'needs_reauth' })

    await expect(account.googleClientForUser('utente1')).rejects.toBeInstanceOf(
      account.GoogleReauthRequiredError,
    )
  })

  it('rifiuta un token cifrato con il contesto di un altro utente', async () => {
    // La cifratura lega il blob al suo record: spostarlo non deve funzionare.
    await prisma.googleAccount.create({
      data: {
        userId: 'utente1',
        refreshToken: crypto.encryptSecret('refresh-123', 'google_refresh:utente2'),
        status: 'ok',
      },
    })

    await expect(account.googleClientForUser('utente1')).rejects.toThrow()
  })
})
