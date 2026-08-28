import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

// Il worker parlerebbe col provider AI: qui interessa solo che venga svegliato.
const ensureExtractionWorker = vi.fn()
vi.mock('@/modules/roster/worker', () => ({
  ensureExtractionWorker: (...args: unknown[]) => ensureExtractionWorker(...args),
  processResumableRosters: vi.fn(),
  staleAfterMs: () => 600_000,
}))

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let uploadRoute: typeof import('@/app/api/rosters/route')
let extractRoute: typeof import('@/app/api/rosters/[id]/extract/route')
let progressRoute: typeof import('@/app/api/rosters/[id]/progress/route')
let imageRoute: typeof import('@/app/api/rosters/[id]/image/route')
let previewRoute: typeof import('@/app/api/rosters/[id]/preview/route')
let storage: typeof import('@/modules/ingest/storage')

let referente: { id: string }
let infermiera: { id: string }

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'turni-route-uploads-'))
  process.env.IMAGE_RETENTION_DAYS = '90'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  session = await import('@/modules/auth/session')
  storage = await import('@/modules/ingest/storage')
  uploadRoute = await import('@/app/api/rosters/route')
  extractRoute = await import('@/app/api/rosters/[id]/extract/route')
  progressRoute = await import('@/app/api/rosters/[id]/progress/route')
  imageRoute = await import('@/app/api/rosters/[id]/image/route')
  previewRoute = await import('@/app/api/rosters/[id]/preview/route')
})

afterAll(async () => {
  await db.cleanup()
  delete process.env.UPLOAD_DIR
})

beforeEach(async () => {
  cookieStore.clear()
  ensureExtractionWorker.mockClear()
  await prisma.assignment.deleteMany()
  await prisma.columnAlias.deleteMany()
  await prisma.rosterCell.deleteMany()
  await prisma.rosterBand.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()

  referente = await prisma.user.create({
    data: { email: 'anna@example.com', displayName: 'Anna', role: 'REFERENTE' },
  })
  infermiera = await prisma.user.create({
    data: { email: 'cri@example.com', displayName: 'Cristina', role: 'NURSE' },
  })
})

async function foto(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: '#ffffff' } })
    .jpeg()
    .toBuffer()
}

async function moduloDiCaricamento(overrides: Record<string, string> = {}): Promise<FormData> {
  const form = new FormData()
  const jpeg = await foto()
  form.set('photo', new File([new Uint8Array(jpeg)], 'turni.jpg', { type: 'image/jpeg' }))
  form.set('year', '2026')
  form.set('month', '8')
  form.set('ward', '3°PIANO')
  for (const [key, value] of Object.entries(overrides)) form.set(key, value)
  return form
}

function richiestaDiCaricamento(form: FormData): Request {
  return new Request('http://localhost:3000/api/rosters', { method: 'POST', body: form })
}

async function tabella(overrides: Record<string, unknown> = {}) {
  const roster = await prisma.roster.create({
    data: {
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      imagePath: 'x.jpg',
      status: 'uploaded',
      ...overrides,
    },
  })
  return roster
}

async function tabellaConFoto(overrides: Record<string, unknown> = {}) {
  const roster = await tabella(overrides)
  await storage.saveRosterImage(roster.id, await foto())
  return roster
}

describe('POST /api/rosters — solo la referente carica tabelle', () => {
  it('senza sessione risponde 401 e non crea nulla', async () => {
    const response = await uploadRoute.POST(richiestaDiCaricamento(await moduloDiCaricamento()))

    expect(response.status).toBe(401)
    expect(await prisma.roster.count()).toBe(0)
  })

  it("con una sessione NURSE risponde 403 e non crea nulla, nemmeno l'immagine", async () => {
    await session.openSessionCookie(infermiera.id)

    const response = await uploadRoute.POST(richiestaDiCaricamento(await moduloDiCaricamento()))

    expect(response.status).toBe(403)
    expect(await prisma.roster.count()).toBe(0)
  })

  it('con una sessione REFERENTE crea la tabella, salva la foto normalizzata e rimanda alla pagina', async () => {
    await session.openSessionCookie(referente.id)

    const response = await uploadRoute.POST(richiestaDiCaricamento(await moduloDiCaricamento()))

    expect(response.status).toBe(303)
    const roster = await prisma.roster.findFirstOrThrow()
    expect(response.headers.get('location')).toContain(`/rosters/${roster.id}`)
    expect(roster.status).toBe('uploaded')
    // Nessuna autorizzazione all invio: la foto resta locale.
    expect(roster.requestedAt).toBeNull()
    expect(ensureExtractionWorker).not.toHaveBeenCalled()
    // La foto normalizzata è sul volume e si rilegge.
    const salvata = await storage.readRosterImage(roster.id)
    const meta = await sharp(salvata).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('un mese fuori intervallo viene rifiutato con un messaggio, senza creare la tabella', async () => {
    await session.openSessionCookie(referente.id)

    const response = await uploadRoute.POST(
      richiestaDiCaricamento(await moduloDiCaricamento({ month: '13' })),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('/rosters/upload?error=')
    expect(await prisma.roster.count()).toBe(0)
  })

  it('un file che non è un immagine viene rifiutato con un messaggio', async () => {
    await session.openSessionCookie(referente.id)
    const form = await moduloDiCaricamento()
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'finta.jpg', { type: 'image/jpeg' }))

    const response = await uploadRoute.POST(richiestaDiCaricamento(form))

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toContain('error=')
    expect(await prisma.roster.count()).toBe(0)
  })

  it('un reparto vuoto viene rifiutato: serve a scartare la colonna fantasma del foglio', async () => {
    await session.openSessionCookie(referente.id)

    const response = await uploadRoute.POST(
      richiestaDiCaricamento(await moduloDiCaricamento({ ward: '   ' })),
    )

    expect(response.headers.get('location')).toContain('error=')
    expect(await prisma.roster.count()).toBe(0)
  })

  it('ricaricare lo stesso mese crea una nuova versione invece di sovrascrivere', async () => {
    await session.openSessionCookie(referente.id)
    await uploadRoute.POST(richiestaDiCaricamento(await moduloDiCaricamento()))
    await uploadRoute.POST(richiestaDiCaricamento(await moduloDiCaricamento()))

    const versioni = await prisma.roster.findMany({ orderBy: { version: 'asc' } })
    expect(versioni.map((r) => r.version)).toEqual([1, 2])
  })
})

describe("POST /api/rosters/[id]/extract — l'invio al provider AI è un atto esplicito", () => {
  it('con una sessione NURSE risponde 403 e non autorizza nulla', async () => {
    const roster = await tabella()
    await session.openSessionCookie(infermiera.id)

    const response = await extractRoute.POST(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(403)
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } })
    expect(row.requestedAt).toBeNull()
    expect(row.status).toBe('uploaded')
    expect(ensureExtractionWorker).not.toHaveBeenCalled()
  })

  it('con una sessione REFERENTE registra l autorizzazione e sveglia il worker', async () => {
    const roster = await tabellaConFoto()
    await session.openSessionCookie(referente.id)

    const response = await extractRoute.POST(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(303)
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } })
    expect(row.requestedAt).not.toBeNull()
    expect(row.status).toBe('extracting')
    // Il piano delle bande dipende dal riquadro rilevato sulla foto, che costa
    // secondi: lo fa il job, e una tabella autorizzata senza bande si riprende.
    expect(await prisma.rosterBand.count({ where: { rosterId: roster.id } })).toBe(0)
    expect(ensureExtractionWorker).toHaveBeenCalledTimes(1)
  })

  it('se la retention ha già cancellato la foto non autorizza niente', async () => {
    const roster = await tabella()
    await session.openSessionCookie(referente.id)

    const response = await extractRoute.POST(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.headers.get('location')).toContain('error=')
    const row = await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } })
    expect(row.requestedAt).toBeNull()
    expect(ensureExtractionWorker).not.toHaveBeenCalled()
  })

  it('riautorizzare una ripresa non riscrive la data della prima autorizzazione', async () => {
    const primaVolta = new Date('2026-08-20T09:00:00Z')
    const roster = await tabellaConFoto({ status: 'interrupted', requestedAt: primaVolta })
    await session.openSessionCookie(referente.id)

    await extractRoute.POST(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ id: roster.id }) },
    )

    const row = await prisma.roster.findUniqueOrThrow({ where: { id: roster.id } })
    expect(row.requestedAt).toEqual(primaVolta)
    expect(row.status).toBe('extracting')
  })

  it('su una tabella già letta non riautorizza niente', async () => {
    const roster = await tabella({ status: 'extracted', requestedAt: new Date() })
    await session.openSessionCookie(referente.id)

    const response = await extractRoute.POST(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/extract`, { method: 'POST' }),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.headers.get('location')).toContain('error=')
    expect(ensureExtractionWorker).not.toHaveBeenCalled()
  })
})

describe('GET /api/rosters/[id]/progress — l avanzamento che la pagina interroga', () => {
  it('senza sessione risponde 401', async () => {
    const roster = await tabella()

    const response = await progressRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/progress`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(401)
  })

  it('a un utente autenticato dichiara bande fatte, totali e mancanti', async () => {
    const roster = await tabella()
    const repo = await import('@/modules/roster/repository')
    await repo.prepareExtraction(
      roster.id,
      [
        { index: 0, dayFrom: 1, dayTo: 16 },
        { index: 1, dayFrom: 17, dayTo: 31 },
        { index: 2, dayFrom: 1, dayTo: 16 },
      ],
      new Date(),
    )
    await repo.markBandFailed(roster.id, 2, 'illeggibile', null, new Date())
    await session.openSessionCookie(infermiera.id)

    const response = await progressRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/progress`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'extracting',
      bandsTotal: 3,
      bandsDone: 0,
      missingBands: [0, 1, 2],
    })
  })

  it('su una tabella inesistente risponde 404', async () => {
    await session.openSessionCookie(infermiera.id)

    const response = await progressRoute.GET(
      new Request('http://localhost:3000/api/rosters/inesistente/progress'),
      { params: Promise.resolve({ id: 'inesistente' }) },
    )

    expect(response.status).toBe(404)
  })
})

describe('GET /api/rosters/[id]/image e /preview — la foto è dato personale di terzi', () => {
  it("un'infermiera non scarica la foto della tabella: vedrebbe i turni delle colleghe", async () => {
    const roster = await tabella()
    await storage.saveRosterImage(roster.id, await foto())
    await session.openSessionCookie(infermiera.id)

    const response = await imageRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/image`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(403)
  })

  it('la referente scarica la foto', async () => {
    const roster = await tabella()
    await storage.saveRosterImage(roster.id, await foto())
    await session.openSessionCookie(referente.id)

    const response = await imageRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/image`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
  })

  it('se la retention ha cancellato la foto risponde 404 invece di rompersi', async () => {
    const roster = await tabella()
    await session.openSessionCookie(referente.id)

    const response = await imageRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/image`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(404)
  })

  it("l'anteprima dei tagli è solo della referente", async () => {
    const roster = await tabella()
    await storage.saveRosterImage(roster.id, await foto())
    await session.openSessionCookie(infermiera.id)

    const vietata = await previewRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/preview`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(vietata.status).toBe(403)
  })

  it("disegna i tagli sul riquadro raddrizzato di una foto vera", async () => {
    const roster = await tabella()
    await storage.saveRosterImage(
      roster.id,
      readFileSync(join(process.cwd(), 'fixtures', 'roster-2026-08-3piano.jpeg')),
    )
    await session.openSessionCookie(referente.id)

    const permessa = await previewRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/preview`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(permessa.status).toBe(200)
    expect(permessa.headers.get('content-type')).toBe('image/jpeg')
    const meta = await sharp(Buffer.from(await permessa.arrayBuffer())).metadata()
    // Il riquadro raddrizzato, non la foto: è quello che il modello vedrà.
    expect(meta.width).toBe(1600)
  })

  it('su una foto in cui non si riconosce una tabella lo dice, invece di rompersi', async () => {
    const roster = await tabella()
    // Carta bianca: nessun filetto, nessuna tabella.
    await storage.saveRosterImage(roster.id, await foto())
    await session.openSessionCookie(referente.id)

    const response = await previewRoute.GET(
      new Request(`http://localhost:3000/api/rosters/${roster.id}/preview`),
      { params: Promise.resolve({ id: roster.id }) },
    )

    expect(response.status).toBe(409)
    expect(await response.text()).toMatch(/tabella/i)
  })
})
