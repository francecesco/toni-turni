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
let ActionDock: typeof import('@/components/action-dock').ActionDock
let ColumnSummary: typeof import('@/app/rosters/[id]/review/column-summary').ColumnSummary
let ChangesBox: typeof import('@/app/rosters/[id]/review/changes-box').ChangesBox
let actions: typeof import('@/app/rosters/[id]/review/actions')

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
  ActionDock = (await import('@/components/action-dock')).ActionDock
  ColumnSummary = (await import('@/app/rosters/[id]/review/column-summary')).ColumnSummary
  ChangesBox = (await import('@/app/rosters/[id]/review/changes-box')).ChangesBox
  actions = await import('@/app/rosters/[id]/review/actions')
})

afterAll(() => db.cleanup())

beforeEach(async () => {
  cookieStore.clear()
  await prisma.assignment.deleteMany()
  await prisma.columnAlias.deleteMany()
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()
  await prisma.shiftCode.deleteMany()

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
 * Cammina l albero JSX ritornato dalla pagina cercando un elemento per
 * **identità del componente** (`element.type === tipo`), senza invocare nessuna
 * funzione: un componente non ancora reso resta un semplice `{type, props}`, e le
 * sue `props.children` letterali bastano per trovarlo.
 */
function trovaElemento<P extends { children?: ReactNode }>(
  node: ReactNode,
  tipo: unknown,
): ReactElement<P> | undefined {
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

async function renderReview(
  userId: string,
  searchParams: Record<string, string> = {},
): Promise<ReactNode> {
  await session.openSessionCookie(userId)
  return ReviewPage({
    params: Promise.resolve({ id: rosterId }),
    searchParams: Promise.resolve(searchParams),
  })
}

async function menuVoci(userId: string): Promise<{ href: string; label: string }[]> {
  const pagina = await renderReview(userId)
  const header = trovaElemento<{
    menuItems?: { href: string; label: string }[]
    children?: ReactNode
  }>(pagina, AppHeader)
  // Senza questa riga, il giorno in cui la pagina smettesse di rendere
  // `AppHeader` la prova d'assenza («l infermiera non vede la voce») passerebbe
  // **a vuoto**: `header` sarebbe `undefined`, `menuItems` `[]` per mancanza
  // dell header e non per la regola di visibilità che si vuole provare.
  expect(header).toBeDefined()
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

  it('alla referente mostra «Cosa è cambiato» solo da una seconda versione in su', async () => {
    const prime = await menuVoci(referente.id)
    expect(prime.some((v) => v.label === 'Cosa è cambiato')).toBe(false)

    const v2 = await prisma.roster.create({
      data: { year: 2026, month: 8, ward: '3°PIANO', version: 2, imagePath: 'v2.jpg', status: 'extracted' },
    })
    await session.openSessionCookie(referente.id)
    const pagina = await ReviewPage({ params: Promise.resolve({ id: v2.id }), searchParams: Promise.resolve({}) })
    const header = trovaElemento<{ menuItems?: { href: string; label: string }[]; children?: ReactNode }>(pagina, AppHeader)
    expect(header?.props.menuItems).toContainEqual({ href: `/rosters/${v2.id}/diff`, label: 'Cosa è cambiato' })
  })

  it('a un infermiera non la mostra mai', async () => {
    const v2 = await prisma.roster.create({
      data: { year: 2026, month: 8, ward: '3°PIANO', version: 2, imagePath: 'v2.jpg', status: 'extracted' },
    })
    await session.openSessionCookie(infermiera.id)
    const pagina = await ReviewPage({ params: Promise.resolve({ id: v2.id }), searchParams: Promise.resolve({}) })
    const header = trovaElemento<{ menuItems?: { href: string; label: string }[]; children?: ReactNode }>(pagina, AppHeader)
    expect(header).toBeDefined()
    expect((header?.props.menuItems ?? []).some((v) => v.label === 'Cosa è cambiato')).toBe(false)
  })
})

describe('solo chi possiede la colonna vede il dock di conferma', () => {
  beforeEach(async () => {
    await prisma.shiftCode.create({
      data: { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
    })
    await prisma.rosterCell.create({
      data: {
        rosterId,
        day: 1,
        columnLabel: 'CRISTINA',
        rawCode: 'M',
        code: 'M',
        confidence: 0.9,
      },
    })
    await prisma.columnAlias.create({
      data: { label: 'CRISTINA', userId: infermiera.id, ignored: false },
    })
  })

  it("per l'intestataria della colonna, l'ActionDock con «Confermo» c'è", async () => {
    const pagina = await renderReview(infermiera.id)
    const dock = trovaElemento(pagina, ActionDock)
    expect(dock).toBeDefined()
  })

  it("per la referente che guarda la colonna di un altra, l'ActionDock non c'è: confermarla scriverebbe sul calendario di quell altra persona senza il suo consenso", async () => {
    const pagina = await renderReview(referente.id)
    const dock = trovaElemento(pagina, ActionDock)
    expect(dock).toBeUndefined()
  })
})

describe('un dock senza niente da confermare né da sincronizzare non compare', () => {
  beforeEach(async () => {
    // Una cella con codice sconosciuto: la colonna esiste (compare in
    // `rosterColumnLabels`, quindi `scelta` non è null) ma non c è niente di
    // confermabile — `codiceEffettivo` resta null e `riassunto.confirmable` è 0.
    // Prima della correzione il dock restava e stampava «Confermo tutti i 0
    // turni», un bottone che non fa niente di sensato.
    await prisma.rosterCell.create({
      data: {
        rosterId,
        day: 1,
        columnLabel: 'CRISTINA',
        rawCode: 'RSF?',
        code: null,
        confidence: 0.9,
      },
    })
    await prisma.columnAlias.create({
      data: { label: 'CRISTINA', userId: infermiera.id, ignored: false },
    })
  })

  it('non rende l ActionDock quando confirmable e confirmed sono entrambi zero', async () => {
    const pagina = await renderReview(infermiera.id)
    const dock = trovaElemento(pagina, ActionDock)
    expect(dock).toBeUndefined()
  })
})

describe('la referente atterra sulla propria colonna, non sulla prima in ordine alfabetico', () => {
  beforeEach(async () => {
    await prisma.shiftCode.create({
      data: { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
    })
    // Colonne apposta in ordine alfabetico diverso da quello di creazione: CARMEN
    // viene prima di RENATA, e prima di questa correzione `visibili[0]` avrebbe
    // portato la referente proprio su CARMEN.
    for (const nome of ['CARMEN', 'CRISTINA', 'RENATA']) {
      await prisma.rosterCell.create({
        data: { rosterId, day: 1, columnLabel: nome, rawCode: 'M', code: 'M', confidence: 0.9 },
      })
    }
    await prisma.columnAlias.create({
      data: { label: 'CARMEN', userId: infermiera.id, ignored: false },
    })
    await prisma.columnAlias.create({
      data: { label: 'RENATA', userId: referente.id, ignored: false },
    })
  })

  it('la referente con una colonna sua atterra sulla sua, non su CARMEN', async () => {
    const pagina = await renderReview(referente.id)
    const summary = trovaElemento<{ columnLabel?: string; children?: ReactNode }>(pagina, ColumnSummary)
    expect(summary).toBeDefined()
    expect(summary?.props.columnLabel).toBe('RENATA')
  })

  it("un infermiera vede solo la propria e atterra lì comunque", async () => {
    const pagina = await renderReview(infermiera.id)
    const summary = trovaElemento<{ columnLabel?: string; children?: ReactNode }>(pagina, ColumnSummary)
    expect(summary).toBeDefined()
    expect(summary?.props.columnLabel).toBe('CARMEN')
  })
})

describe('quando il calendario collegato non esiste piu su Google', () => {
  beforeEach(async () => {
    await prisma.rosterCell.create({
      data: { rosterId, day: 1, columnLabel: 'CRISTINA', rawCode: 'M', code: 'M', confidence: 0.9 },
    })
    await prisma.columnAlias.create({
      data: { label: 'CRISTINA', userId: infermiera.id, ignored: false },
    })
  })

  /** Tutti i `<form>` dell albero, per trovare quello con una data server action. */
  function formConAzione(node: ReactNode, azione: unknown): ReactElement<{ action?: unknown }> | undefined {
    if (node === null || node === undefined || typeof node !== 'object') return undefined
    if (Array.isArray(node)) {
      for (const figlio of node) {
        const trovato = formConAzione(figlio, azione)
        if (trovato) return trovato
      }
      return undefined
    }
    const elemento = node as ReactElement<{ action?: unknown; children?: ReactNode }>
    if (elemento.type === 'form' && elemento.props.action === azione) return elemento
    return formConAzione(elemento.props?.children, azione)
  }

  it('mostra il bottone «Ricollega il calendario», che e la sola via per crearne uno nuovo', async () => {
    const pagina = await renderReview(infermiera.id, { colonna: 'CRISTINA', calendarMissing: '1' })
    const form = formConAzione(pagina, actions.relinkCalendarAction)
    expect(form).toBeDefined()
  })

  it('senza quel flag il bottone non c e', async () => {
    const pagina = await renderReview(infermiera.id, { colonna: 'CRISTINA' })
    expect(formConAzione(pagina, actions.relinkCalendarAction)).toBeUndefined()
  })
})

describe('la griglia dice cosa è cambiato rispetto alla foto precedente', () => {
  let v2: string

  beforeEach(async () => {
    await prisma.columnAlias.create({ data: { label: 'CRISTINA', userId: infermiera.id, ignored: false } })
    // v1 (rosterId, già creata dal beforeEach del file): giorno 5 = M
    await prisma.rosterCell.create({
      data: { rosterId, day: 5, columnLabel: 'CRISTINA', rawCode: 'M', code: 'M', confidence: 0.9 },
    })
    // v2: giorno 5 = P
    const nuova = await prisma.roster.create({
      data: { year: 2026, month: 8, ward: '3°PIANO', version: 2, imagePath: 'v2.jpg', status: 'extracted' },
    })
    v2 = nuova.id
    await prisma.rosterCell.create({
      data: { rosterId: v2, day: 5, columnLabel: 'CRISTINA', rawCode: 'P', code: 'P', confidence: 0.9 },
    })
  })

  async function renderReviewDi(id: string, userId: string): Promise<ReactNode> {
    await session.openSessionCookie(userId)
    return ReviewPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ colonna: 'CRISTINA' }) })
  }

  it('sulla versione 2 il riquadro dei cambiamenti riceve il diff della colonna', async () => {
    const pagina = await renderReviewDi(v2, infermiera.id)
    const box = trovaElemento<{ changes: unknown[]; children?: ReactNode }>(pagina, ChangesBox)
    expect(box).toBeDefined()
    expect(box?.props.changes).toEqual([
      expect.objectContaining({ day: 5, kind: 'changed', before: 'M', after: 'P' }),
    ])
  })

  it('sulla prima versione il riquadro riceve un diff vuoto', async () => {
    const pagina = await renderReviewDi(rosterId, infermiera.id)
    const box = trovaElemento<{ changes: unknown[]; children?: ReactNode }>(pagina, ChangesBox)
    expect(box).toBeDefined()
    expect(box?.props.changes).toEqual([])
  })
})
