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
let ReviewPage: typeof import('@/app/rosters/[id]/review/page').default
let AppHeader: typeof import('@/components/app-header').AppHeader

let referente: { id: string }
let infermiera: { id: string }
let rosterId: string

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  session = await import('@/modules/auth/session')
  ReviewPage = (await import('@/app/rosters/[id]/review/page')).default
  AppHeader = (await import('@/components/app-header')).AppHeader
})

afterAll(() => db.cleanup())

beforeEach(async () => {
  cookieStore.clear()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()

  referente = await prisma.user.create({
    data: { email: 'referente@esempio.it', displayName: 'Anna', role: 'REFERENTE' },
  })
  infermiera = await prisma.user.create({
    data: { email: 'infermiera@esempio.it', displayName: 'Cristina', role: 'NURSE' },
  })

  const roster = await prisma.roster.create({
    data: { year: 2026, month: 8, ward: '3°PIANO', imagePath: 'prova.jpg', status: 'extracted' },
  })
  rosterId = roster.id
})

/**
 * Trova, nell albero JSX ritornato dalla pagina, l elemento `AppHeader` (senza
 * invocarlo: si confronta `element.type` con il componente importato).
 */
function trovaAppHeader(node: ReactNode): ReactElement<{ menuItems?: { href: string; label: string }[] }> | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const figlio of node) {
      const trovato = trovaAppHeader(figlio)
      if (trovato) return trovato
    }
    return undefined
  }
  const elemento = node as ReactElement<{ menuItems?: { href: string; label: string }[]; children?: ReactNode }>
  if (elemento.type === AppHeader) return elemento
  return trovaAppHeader(elemento.props?.children)
}

async function menuVoci(userId: string): Promise<{ href: string; label: string }[]> {
  await session.openSessionCookie(userId)
  const pagina = await ReviewPage({
    params: Promise.resolve({ id: rosterId }),
    searchParams: Promise.resolve({}),
  })
  const header = trovaAppHeader(pagina)
  return header?.props.menuItems ?? []
}

describe('la griglia di conferma ridà alla referente la strada per le colonne', () => {
  it('alla referente mostra la voce «Colonne e persone», verso la pagina delle colonne di questa tabella', async () => {
    const voci = await menuVoci(referente.id)
    expect(voci).toContainEqual({
      href: `/rosters/${rosterId}/columns`,
      label: 'Colonne e persone',
    })
  })

  it('a un infermiera non mostra quella voce', async () => {
    const voci = await menuVoci(infermiera.id)
    expect(voci.some((voce) => voce.label === 'Colonne e persone')).toBe(false)
  })
})
