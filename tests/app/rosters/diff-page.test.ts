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

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let DiffPage: typeof import('@/app/rosters/[id]/diff/page').default
let EmptyState: typeof import('@/components/empty-state').EmptyState
let Badge: typeof import('@/components/ui/badge').Badge

let referente: { id: string }
let infermiera: { id: string }

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  session = await import('@/modules/auth/session')
  DiffPage = (await import('@/app/rosters/[id]/diff/page')).default
  EmptyState = (await import('@/components/empty-state')).EmptyState
  Badge = (await import('@/components/ui/badge')).Badge
})

afterAll(() => db.cleanup())

beforeEach(async () => {
  cookieStore.clear()
  await prisma.assignment.deleteMany()
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()
  referente = await prisma.user.create({ data: { email: 'anna@esempio.it', displayName: 'Anna', role: 'REFERENTE' } })
  infermiera = await prisma.user.create({ data: { email: 'cri@esempio.it', displayName: 'Cristina', role: 'NURSE' } })
})

function trovaElemento<P extends { children?: ReactNode }>(node: ReactNode, tipo: unknown): ReactElement<P> | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const figlio of node) {
      const trovato = trovaElemento<P>(figlio, tipo)
      if (trovato) return trovato
    }
    return undefined
  }
  const elemento = node as ReactElement<P>
  if (elemento.type === tipo) return elemento
  return trovaElemento<P>(elemento.props?.children, tipo)
}

/** Tutti gli elementi di un tipo, nell ordine in cui compaiono nell albero. */
function trovaTutti<P extends { children?: ReactNode }>(node: ReactNode, tipo: unknown): ReactElement<P>[] {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((figlio) => trovaTutti<P>(figlio, tipo))
  const elemento = node as ReactElement<P>
  const qui = elemento.type === tipo ? [elemento] : []
  return [...qui, ...trovaTutti<P>(elemento.props?.children, tipo)]
}

/** Tutto il testo letterale dell albero, per cercare frasi senza rendere i componenti. */
function testo(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(testo).join(' ')
  const el = node as ReactElement<{ children?: ReactNode }>
  return testo(el.props?.children)
}

async function versione(
  version: number,
  celle: Array<{ day: number; column: string; code: string }>,
  over: { status?: string } = {},
) {
  const roster = await prisma.roster.create({
    data: { year: 2026, month: 9, ward: '3°PIANO', version, imagePath: `v${version}.jpg`, status: over.status ?? 'extracted' },
  })
  await prisma.rosterCell.createMany({
    data: celle.map((c) => ({ rosterId: roster.id, day: c.day, columnLabel: c.column, rawCode: c.code, code: c.code, confidence: 0.9 })),
  })
  return roster
}

async function render(id: string, userId: string) {
  await session.openSessionCookie(userId)
  return DiffPage({ params: Promise.resolve({ id }) })
}

describe('/rosters/[id]/diff — solo la referente', () => {
  it('a un infermiera rimanda alla home: il controllo è lato server', async () => {
    const v1 = await versione(1, [])
    await expect(render(v1.id, infermiera.id)).rejects.toThrow('REDIRECT:/')
  })

  it('senza sessione rimanda al login', async () => {
    const v1 = await versione(1, [])
    await expect(render(v1.id, '')).rejects.toThrow(/REDIRECT:\/login/)
  })
})

describe('/rosters/[id]/diff — cosa mostra', () => {
  it('sulla prima versione dice che non c è una foto precedente', async () => {
    const v1 = await versione(1, [{ day: 1, column: 'CRISTINA', code: 'M' }])
    const pagina = await render(v1.id, referente.id)
    expect(trovaElemento(pagina, EmptyState)).toBeDefined()
    expect(testo(pagina)).toMatch(/prima foto|foto precedente/i)
  })

  it('con diff vuoto dice che non ci sono differenze', async () => {
    await versione(1, [{ day: 1, column: 'CRISTINA', code: 'M' }])
    const v2 = await versione(2, [{ day: 1, column: 'CRISTINA', code: 'M' }])
    const pagina = await render(v2.id, referente.id)
    expect(testo(pagina)).toMatch(/nessuna differenza/i)
  })

  it('elenca i cambiamenti per colonna e giorno, e dice se la persona ha già riconfermato', async () => {
    await versione(1, [
      { day: 5, column: 'CRISTINA', code: 'M' },
      { day: 7, column: 'MERY', code: 'P' },
    ])
    const v2 = await versione(2, [
      { day: 5, column: 'CRISTINA', code: 'P' },
      { day: 7, column: 'MERY', code: 'P' },
      { day: 9, column: 'MERY', code: 'M' },
    ])
    // Cristina ha già riconfermato il P del giorno 5
    await prisma.assignment.create({
      data: { rosterId: v2.id, userId: infermiera.id, day: 5, code: 'P', columnLabel: 'CRISTINA', confirmedAt: new Date(), syncState: 'confirmed' },
    })
    await prisma.columnAlias.deleteMany()
    await prisma.columnAlias.create({ data: { label: 'CRISTINA', userId: infermiera.id, ignored: false } })

    const t = testo(await render(v2.id, referente.id))
    expect(t).toContain('CRISTINA')
    expect(t).toContain('5 (M → P)')
    expect(t).toContain('MERY')
    expect(t).toContain('9 nuovo (M)')
  })

  it('due colonne con lo stesso nome normalizzato finiscono in una sola card', async () => {
    // Fra due versioni la stessa persona può comparire con etichette diverse
    // (`SARA DP.` poi `SARA DP`): sono la stessa identità per `normalizeColumn`. Il
    // giorno 6 sparisce (rimane con l etichetta vecchia, presa da chi c era prima),
    // il giorno 5 cambia (etichetta nuova): senza raggruppare per `columnKey`
    // sarebbero due card per la stessa persona.
    await versione(1, [
      { day: 5, column: 'SARA DP.', code: 'M' },
      { day: 6, column: 'SARA DP.', code: 'M' },
    ])
    const v2 = await versione(2, [{ day: 5, column: 'SARA DP', code: 'P' }])
    await prisma.assignment.create({
      data: { rosterId: v2.id, userId: infermiera.id, day: 5, code: 'P', columnLabel: 'SARA DP', confirmedAt: new Date(), syncState: 'confirmed' },
    })
    await prisma.columnAlias.deleteMany()
    await prisma.columnAlias.create({ data: { label: 'SARADP', userId: infermiera.id, ignored: false } })

    const pagina = await render(v2.id, referente.id)
    const t = testo(pagina)
    expect(t).toContain('5 (M → P)')
    expect(t).toContain('6 tolto (era M)')
    expect(t).toMatch(/riconfermato/i)
    // Una sola card: una sola intestazione «SARA DP[.]», non due (una per etichetta).
    expect(t.match(/SARA DP/g)).toHaveLength(1)
  })

  it('su una lettura parziale non dichiara "tolto" un giorno forse solo non letto', async () => {
    await versione(1, [{ day: 5, column: 'CRISTINA', code: 'M' }])
    const v2 = await versione(2, [{ day: 6, column: 'CRISTINA', code: 'P' }], { status: 'partial' })

    const t = testo(await render(v2.id, referente.id))
    expect(t).not.toMatch(/tolto/i)
    expect(t).toContain('Lettura parziale')
  })
})

describe('/rosters/[id]/diff — il badge di un cambiamento, uno per volta', () => {
  /**
   * Un cambiamento solo per render, così il badge che si guarda è senza dubbio il suo:
   * con più cambiamenti «c è scritto riconfermato da qualche parte» non dice su quale
   * giorno. L ultimo badge dell albero è quello della riga (il primo è il conto dei
   * giorni sulla card).
   */
  async function badgeDelCambiamento(id: string): Promise<string> {
    const pagina = await render(id, referente.id)
    const badges = trovaTutti<{ children?: ReactNode }>(pagina, Badge)
    expect(badges.length).toBeGreaterThan(1)
    return testo(badges[badges.length - 1].props.children).trim()
  }

  async function alias(userId: string, label = 'CRISTINA') {
    await prisma.columnAlias.deleteMany()
    await prisma.columnAlias.create({ data: { label, userId, ignored: false } })
  }

  it('un giorno cambiato e già riconfermato porta «riconfermato»', async () => {
    await versione(1, [{ day: 5, column: 'CRISTINA', code: 'M' }])
    const v2 = await versione(2, [{ day: 5, column: 'CRISTINA', code: 'P' }])
    await prisma.assignment.create({
      data: { rosterId: v2.id, userId: infermiera.id, day: 5, code: 'P', columnLabel: 'CRISTINA', confirmedAt: new Date(), syncState: 'confirmed' },
    })
    await alias(infermiera.id)

    expect(await badgeDelCambiamento(v2.id)).toBe('riconfermato')
  })

  it('un giorno tolto con la conferma ancora là dice «da togliere», non «da riconfermare»', async () => {
    // Non c è niente da riconfermare: il turno non c è più. Quello che resta da fare è
    // togliere la conferma (e con essa l evento sul calendario).
    await versione(1, [
      { day: 20, column: 'CRISTINA', code: 'M' },
      { day: 21, column: 'CRISTINA', code: 'M' },
    ])
    const v2 = await versione(2, [{ day: 21, column: 'CRISTINA', code: 'M' }])
    await prisma.assignment.create({
      data: { rosterId: v2.id, userId: infermiera.id, day: 20, code: 'M', columnLabel: 'CRISTINA', confirmedAt: new Date(), syncState: 'synced' },
    })
    await alias(infermiera.id)

    expect(await badgeDelCambiamento(v2.id)).toBe('da togliere')
  })

  it('un giorno tolto e già senza conferma dice «tolto»: non resta niente da fare', async () => {
    await versione(1, [
      { day: 20, column: 'CRISTINA', code: 'M' },
      { day: 21, column: 'CRISTINA', code: 'M' },
    ])
    const v2 = await versione(2, [{ day: 21, column: 'CRISTINA', code: 'M' }])
    await alias(infermiera.id)

    expect(await badgeDelCambiamento(v2.id)).toBe('tolto')
  })
})
