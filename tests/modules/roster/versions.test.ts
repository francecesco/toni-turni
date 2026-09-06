import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let versions: typeof import('@/modules/roster/versions')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  versions = await import('@/modules/roster/versions')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
})

async function tabella(version: number, over: { month?: number; ward?: string; status?: string } = {}) {
  return prisma.roster.create({
    data: {
      year: 2026,
      month: over.month ?? 9,
      ward: over.ward ?? '3°PIANO',
      version,
      imagePath: `v${version}.jpg`,
      status: over.status ?? 'extracted',
    },
  })
}

describe('previousVersionOf', () => {
  it('sulla prima versione non c è niente prima', async () => {
    const v1 = await tabella(1)
    expect(await versions.previousVersionOf(v1.id)).toBeNull()
  })

  it('restituisce la versione immediatamente inferiore dello stesso mese e reparto', async () => {
    const v1 = await tabella(1)
    await tabella(2)
    const v3 = await tabella(3)
    const prima = await versions.previousVersionOf(v3.id)
    expect(prima?.version).toBe(2)
    expect(prima?.id).not.toBe(v1.id)
  })

  it('non confonde un altro mese o un altro reparto', async () => {
    await tabella(1, { month: 8 })
    await tabella(1, { ward: '2°PIANO' })
    const v2 = await tabella(2)
    // v1 di settembre 3°PIANO non esiste: prima di v2 non c è niente
    expect(await versions.previousVersionOf(v2.id)).toBeNull()
  })

  it('con un id inesistente risponde null, non lancia', async () => {
    expect(await versions.previousVersionOf('non-esiste')).toBeNull()
  })

  it('salta una versione fallita: non ha celle, non è una base di confronto', async () => {
    const v1 = await tabella(1, { status: 'extracted' })
    await tabella(2, { status: 'failed' })
    const v3 = await tabella(3, { status: 'extracted' })

    const prima = await versions.previousVersionOf(v3.id)

    expect(prima?.id).toBe(v1.id)
  })
})

describe('cellsForDiff', () => {
  it('restituisce le celle con lettura, correzione a mano e provenienza', async () => {
    const v1 = await tabella(1)
    await prisma.rosterCell.create({
      data: {
        rosterId: v1.id,
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M',
        code: 'M',
        confidence: 0.9,
        correctedCode: 'P',
        correctedAt: new Date('2026-09-01T10:00:00Z'),
        correctedBy: 'anna',
      },
    })

    const celle = await versions.cellsForDiff(v1.id)

    expect(celle).toEqual([
      {
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M',
        code: 'M',
        correctedCode: 'P',
        correctedAt: new Date('2026-09-01T10:00:00Z'),
        correctedBy: 'anna',
      },
    ])
  })
})

describe('carryOverAssignments — le conferme seguono la versione nuova', () => {
  let cristina: { id: string }
  let sara: { id: string }

  beforeEach(async () => {
    await prisma.assignment.deleteMany()
    await prisma.columnAlias.deleteMany()
    await prisma.user.deleteMany()
    cristina = await prisma.user.create({ data: { email: 'cri@example.com', displayName: 'Cristina' } })
    sara = await prisma.user.create({ data: { email: 'sara@example.com', displayName: 'Sara' } })
    await prisma.columnAlias.createMany({
      data: [
        { label: 'CRISTINA', userId: cristina.id, ignored: false },
        { label: 'SARADP', userId: sara.id, ignored: false },
      ],
    })
  })

  async function cella(rosterId: string, columnLabel: string, day: number, rawCode: string, over: Record<string, unknown> = {}) {
    return prisma.rosterCell.create({
      data: { rosterId, day, columnLabel, rawCode, code: rawCode, confidence: 0.9, ...over },
    })
  }

  async function assegnazione(rosterId: string, userId: string, day: number, over: Record<string, unknown> = {}) {
    return prisma.assignment.create({
      data: {
        rosterId,
        userId,
        day,
        code: 'M',
        columnLabel: 'CRISTINA',
        confirmedAt: new Date('2026-09-01T08:00:00Z'),
        eventId: `ev-${day}`,
        syncState: 'synced',
        syncedAt: new Date('2026-09-01T08:05:00Z'),
        ...over,
      },
    })
  }

  it('sposta le assegnazioni sulla versione nuova con tutti i campi intatti', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v2.id, 'CRISTINA', 1, 'M')
    await assegnazione(v1.id, cristina.id, 1)

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(1)
    const righe = await prisma.assignment.findMany({ where: { userId: cristina.id } })
    expect(righe).toHaveLength(1)
    expect(righe[0]).toMatchObject({
      rosterId: v2.id,
      day: 1,
      code: 'M',
      eventId: 'ev-1',
      syncState: 'synced',
      confirmedAt: new Date('2026-09-01T08:00:00Z'),
      syncedAt: new Date('2026-09-01T08:05:00Z'),
    })
  })

  it('non sposta quelle di chi non ha la colonna nella foto nuova: resta sulla vecchia', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v1.id, 'SARA DP.', 1, 'P')
    await cella(v2.id, 'CRISTINA', 1, 'M') // la foto nuova non ha SARA DP.
    await assegnazione(v1.id, cristina.id, 1)
    await assegnazione(v1.id, sara.id, 1, { code: 'P', columnLabel: 'SARA DP.' })

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(1)
    expect(esito.skippedUsers).toEqual([sara.id])
    const diSara = await prisma.assignment.findFirstOrThrow({ where: { userId: sara.id } })
    expect(diSara.rosterId).toBe(v1.id)
  })

  it('l identità di colonna è normalizeColumn: "SARA DP." nella foto vale per l alias "SARADP"', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'SARA DP.', 1, 'P')
    await cella(v2.id, 'SARA DP', 1, 'P')
    await assegnazione(v1.id, sara.id, 1, { code: 'P', columnLabel: 'SARA DP.' })

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(1)
    expect(esito.skippedUsers).toEqual([])
  })

  it('se la versione nuova ha già un assegnazione per quel giorno, vince quella e la vecchia resta', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v2.id, 'CRISTINA', 1, 'M')
    await assegnazione(v1.id, cristina.id, 1)
    await assegnazione(v2.id, cristina.id, 1, { eventId: 'ev-nuovo', syncState: 'confirmed' })

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(0)
    const suV2 = await prisma.assignment.findFirstOrThrow({ where: { userId: cristina.id, rosterId: v2.id } })
    expect(suV2.eventId).toBe('ev-nuovo')
    expect(await prisma.assignment.count({ where: { rosterId: v1.id } })).toBe(1)
  })

  it('riporta una correzione a mano solo se il modello ha letto la stessa cosa di prima', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    const quando = new Date('2026-09-02T09:00:00Z')
    // giorno 1: stessa lettura M, corretta in P → si riporta
    await cella(v1.id, 'CRISTINA', 1, 'M', { correctedCode: 'P', correctedAt: quando, correctedBy: 'anna' })
    await cella(v2.id, 'CRISTINA', 1, 'M')
    // giorno 2: la lettura è cambiata (M → RP): il foglio è cambiato, la correzione non vale più
    await cella(v1.id, 'CRISTINA', 2, 'M', { correctedCode: 'P', correctedAt: quando, correctedBy: 'anna' })
    await cella(v2.id, 'CRISTINA', 2, 'RP')
    await assegnazione(v1.id, cristina.id, 1)

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.carriedCorrections).toBe(1)
    const g1 = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: v2.id, day: 1 } })
    expect(g1).toMatchObject({ correctedCode: 'P', correctedAt: quando, correctedBy: 'anna' })
    const g2 = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: v2.id, day: 2 } })
    expect(g2.correctedAt).toBeNull()
  })

  it('una versione caricata e mai letta non è la base: si riporta dalla precedente letta', async () => {
    const v1 = await tabella(1)
    await tabella(2, { status: 'uploaded' })
    const v3 = await tabella(3)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v3.id, 'CRISTINA', 1, 'M')
    await assegnazione(v1.id, cristina.id, 1)

    const esito = await versions.carryOverAssignments(v3.id)

    expect(esito.movedAssignments).toBe(1)
    const riga = await prisma.assignment.findFirstOrThrow({ where: { userId: cristina.id } })
    expect(riga.rosterId).toBe(v3.id)
  })

  it('è idempotente anche con qualcosa da riportare: la seconda chiamata non duplica nulla', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    const quando = new Date('2026-09-02T09:00:00Z')
    await cella(v1.id, 'CRISTINA', 1, 'M', { correctedCode: 'P', correctedAt: quando, correctedBy: 'anna' })
    await cella(v2.id, 'CRISTINA', 1, 'M')
    await assegnazione(v1.id, cristina.id, 1)

    const prima = await versions.carryOverAssignments(v2.id)
    expect(prima).toEqual({ movedAssignments: 1, carriedCorrections: 1, skippedUsers: [] })

    const seconda = await versions.carryOverAssignments(v2.id)
    expect(seconda).toEqual({ movedAssignments: 0, carriedCorrections: 0, skippedUsers: [] })

    expect(await prisma.assignment.count({ where: { userId: cristina.id } })).toBe(1)
    const assegnazioneFinale = await prisma.assignment.findFirstOrThrow({ where: { userId: cristina.id } })
    expect(assegnazioneFinale.rosterId).toBe(v2.id)
    const cellaFinale = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: v2.id, day: 1 } })
    expect(cellaFinale.correctedAt).toEqual(quando)
    expect(cellaFinale.correctedCode).toBe('P')
  })

  it('è idempotente: senza niente da riportare non tocca nulla', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v2.id, 'CRISTINA', 1, 'M')

    expect(await versions.carryOverAssignments(v2.id)).toEqual({
      movedAssignments: 0,
      carriedCorrections: 0,
      skippedUsers: [],
    })
    // e sulla prima versione non c è niente prima: nessun errore
    expect(await versions.carryOverAssignments(v1.id)).toEqual({
      movedAssignments: 0,
      carriedCorrections: 0,
      skippedUsers: [],
    })
  })
})
