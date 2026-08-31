import Link from 'next/link'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { ReactElement, ReactNode } from 'react'
import { createTestDb } from '../../helpers/db'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

// Il worker parlerebbe col provider AI: qui interessa solo che la pagina lo
// svegli senza aspettarlo, non che giri per davvero.
vi.mock('@/modules/roster/worker', () => ({
  ensureExtractionWorker: vi.fn().mockResolvedValue([]),
  processResumableRosters: vi.fn(),
  staleAfterMs: () => 600_000,
}))

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let RostersPage: typeof import('@/app/rosters/page').default

let referente: { id: string }

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  session = await import('@/modules/auth/session')
  RostersPage = (await import('@/app/rosters/page')).default
})

afterAll(() => db.cleanup())

beforeEach(async () => {
  cookieStore.clear()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()

  referente = await prisma.user.create({
    data: { email: 'referente@esempio.it', displayName: 'Anna', role: 'REFERENTE' },
  })
})

/**
 * Cammina l albero JSX ritornato dalla pagina cercando ogni elemento per
 * **identità del componente** (`element.type === tipo`), senza invocare
 * nessuna funzione: un componente non ancora reso resta un semplice
 * `{type, props}`. `next/link` produce un elemento `Link`, non un `<a>`, finché
 * non viene reso — cercare `'a'` non troverebbe mai niente e la prova
 * passerebbe a vuoto in silenzio.
 */
function trovaTutti<P extends { children?: ReactNode }>(
  node: ReactNode,
  tipo: unknown,
  trovati: ReactElement<P>[] = [],
): ReactElement<P>[] {
  if (node === null || node === undefined || typeof node !== 'object') return trovati
  if (Array.isArray(node)) {
    for (const figlio of node) trovaTutti<P>(figlio, tipo, trovati)
    return trovati
  }
  const elemento = node as ReactElement<P>
  if (elemento.type === tipo) trovati.push(elemento)
  trovaTutti<P>(elemento.props?.children, tipo, trovati)
  return trovati
}

async function renderRosters(userId: string): Promise<ReactNode> {
  await session.openSessionCookie(userId)
  return RostersPage()
}

describe('il selettore dei mesi porta dove sta davvero la tabella', () => {
  it('una tabella ancora in estrazione porta alla pagina di stato, non alla griglia di conferma', async () => {
    const roster = await prisma.roster.create({
      data: { year: 2026, month: 9, ward: '3°PIANO', imagePath: 'settembre.jpg', status: 'extracting' },
    })

    const pagina = await renderRosters(referente.id)
    const link = trovaTutti<{ href?: string; children?: ReactNode }>(pagina, Link).find(
      (el) => el.props.href === `/rosters/${roster.id}`,
    )
    // Senza questa asserzione, un `find` che non trova niente restituirebbe
    // `undefined` e la prova passerebbe a vuoto anche se la pagina puntasse
    // ancora, per errore, a `/review`.
    expect(link).toBeDefined()
  })

  it('una tabella letta porta alla griglia di conferma', async () => {
    const roster = await prisma.roster.create({
      data: { year: 2026, month: 8, ward: '3°PIANO', imagePath: 'agosto.jpg', status: 'extracted' },
    })

    const pagina = await renderRosters(referente.id)
    const link = trovaTutti<{ href?: string; children?: ReactNode }>(pagina, Link).find(
      (el) => el.props.href === `/rosters/${roster.id}/review`,
    )
    expect(link).toBeDefined()
  })
})
