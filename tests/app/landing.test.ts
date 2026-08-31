import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../helpers/db'

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
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let homePage: typeof import('@/app/page')
let referente: { id: string }

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  session = await import('@/modules/auth/session')
  homePage = await import('@/app/page')

  // **Referente di proposito.** Per un ruolo `NURSE`, `reviewableRosters`
  // restituisce `[]` se non ha un `ColumnAlias` *e* la tabella non ha celle nella
  // sua colonna: con un infermiera nuda queste prove misurerebbero il filtro di
  // visibilità (che ha già le sue prove altrove) invece della regola
  // d'atterraggio. La referente vede tutte le tabelle, che è quello che serve qui
  // — ed è anche un'utente reale: la referente è un'infermiera con una colonna sua.
  referente = await prisma.user.create({
    data: { email: 'referente@esempio.it', displayName: 'Anna', role: 'REFERENTE' },
  })
})

afterAll(() => db.cleanup())

beforeEach(async () => {
  cookieStore.clear()
  await prisma.roster.deleteMany()
  await session.openSessionCookie(referente.id)
})

/**
 * Una tabella per un mese, alla versione data. `imagePath` è obbligatorio nello
 * schema, e `Roster` non ha un campo per chi l'ha caricata: il vincolo di unicità
 * è `[year, month, ward, version]`.
 */
async function tabella(year: number, month: number, version = 1): Promise<string> {
  const roster = await prisma.roster.create({
    data: { year, month, version, ward: '3°PIANO', imagePath: 'prova.jpg', status: 'extracted' },
  })
  return roster.id
}

/** Il redirect è mockato come un throw: qui si legge la destinazione. */
async function destinazioneDi(pagina: () => Promise<unknown>): Promise<string> {
  try {
    await pagina()
  } catch (errore) {
    const messaggio = errore instanceof Error ? errore.message : String(errore)
    if (messaggio.startsWith('REDIRECT:')) return messaggio.slice('REDIRECT:'.length)
    throw errore
  }
  throw new Error('la pagina non ha reindirizzato')
}

describe('la home apre sui turni del mese', () => {
  it('reindirizza alla griglia della tabella del mese corrente', async () => {
    const oggi = new Date()
    const anno = oggi.getFullYear()
    const mese = oggi.getMonth() + 1
    await tabella(anno, mese === 1 ? 12 : mese - 1)
    const corrente = await tabella(anno, mese)

    expect(await destinazioneDi(() => homePage.default())).toBe(`/rosters/${corrente}/review`)
  })

  it('a parità di mese usa la versione più alta', async () => {
    const oggi = new Date()
    await tabella(oggi.getFullYear(), oggi.getMonth() + 1, 1)
    const seconda = await tabella(oggi.getFullYear(), oggi.getMonth() + 1, 2)

    expect(await destinazioneDi(() => homePage.default())).toBe(`/rosters/${seconda}/review`)
  })

  it('senza il mese corrente cade sulla tabella più recente', async () => {
    const vecchia = await tabella(2024, 3)
    await tabella(2024, 1)

    expect(await destinazioneDi(() => homePage.default())).toBe(`/rosters/${vecchia}/review`)
  })

  it('senza nessuna tabella non reindirizza: rende lo stato vuoto', async () => {
    // Un redirect qui manderebbe l app in un ciclo, o su una griglia inesistente.
    await expect(homePage.default()).resolves.toBeTruthy()
  })

  it('a un infermiera senza colonna mostra lo stato vuoto, non un guasto', async () => {
    // `reviewableRosters` non le dà niente finché la referente non le associa una
    // colonna: la tabella esiste ma non è sua. Deve leggere una spiegazione, non
    // finire su una griglia vuota.
    const oggi = new Date()
    await tabella(oggi.getFullYear(), oggi.getMonth() + 1)

    const cristina = await prisma.user.create({
      data: { email: `cristina-${Date.now()}@esempio.it`, displayName: 'Cristina', role: 'NURSE' },
    })
    cookieStore.clear()
    await session.openSessionCookie(cristina.id)

    await expect(homePage.default()).resolves.toBeTruthy()
  })
})
