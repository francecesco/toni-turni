import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let aliases: typeof import('@/modules/review/aliases')
let confirm: typeof import('@/modules/review/confirm')
let rosterRepo: typeof import('@/modules/roster/repository')

let cristina: { id: string }
let sara: { id: string }
let anna: { id: string }
let rosterId: string

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  aliases = await import('@/modules/review/aliases')
  confirm = await import('@/modules/review/confirm')
  rosterRepo = await import('@/modules/roster/repository')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.assignment.deleteMany()
  await prisma.columnAlias.deleteMany()
  await prisma.rosterCell.deleteMany()
  await prisma.rosterBand.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()
  await prisma.shiftCode.deleteMany()
  await prisma.shiftCode.createMany({
    data: [
      { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
      { code: 'P', label: 'Pomeriggio', kind: 'work', startTime: '14:00', endTime: '21:00' },
    ],
  })

  cristina = await prisma.user.create({
    data: { email: 'cri@example.com', displayName: 'Cristina', role: 'NURSE' },
  })
  sara = await prisma.user.create({
    data: { email: 'sara@example.com', displayName: 'Sara', role: 'NURSE' },
  })
  anna = await prisma.user.create({
    data: { email: 'anna@example.com', displayName: 'Anna', role: 'REFERENTE' },
  })

  const roster = await prisma.roster.create({
    data: {
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      imagePath: 'a.jpg',
      status: 'extracted',
      columnCount: 3,
    },
  })
  rosterId = roster.id

  await prisma.rosterCell.createMany({
    data: [
      { rosterId, day: 1, columnLabel: 'CRISTINA', rawCode: 'M', code: 'M', confidence: 0.9 },
      { rosterId, day: 2, columnLabel: 'CRISTINA', rawCode: 'P', code: 'P', confidence: 0.9 },
      { rosterId, day: 3, columnLabel: 'CRISTINA', rawCode: 'RSF?', code: null, confidence: 0.9 },
      { rosterId, day: 1, columnLabel: 'SARA DP.', rawCode: 'P', code: 'P', confidence: 0.9 },
      { rosterId, day: 1, columnLabel: 'TOT M', rawCode: '4', code: null, confidence: 0.9 },
    ],
  })
})

const viewer = {
  cristina: () => ({ id: cristina.id, role: 'NURSE' as const }),
  sara: () => ({ id: sara.id, role: 'NURSE' as const }),
  anna: () => ({ id: anna.id, role: 'REFERENTE' as const }),
}

describe('rosterColumnLabels — le colonne lette dalla foto', () => {
  it('elenca le colonne distinte, in ordine', async () => {
    expect(await aliases.rosterColumnLabels(rosterId)).toEqual(['CRISTINA', 'SARA DP.', 'TOT M'])
  })
})

describe('assignColumnToUser — l associazione si fa una volta e si ricorda', () => {
  it('associa il nome di colonna a un utente in forma normalizzata', async () => {
    await aliases.assignColumnToUser(' cristina ', cristina.id)

    const alias = await aliases.aliasFor('CRISTINA')
    expect(alias).toEqual({ label: 'CRISTINA', userId: cristina.id, ignored: false })
  })

  it('riassociare la stessa colonna a un altra persona la sposta, non ne crea due', async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
    await aliases.assignColumnToUser('CRISTINA', sara.id)

    expect(await prisma.columnAlias.count()).toBe(1)
    expect((await aliases.aliasFor('CRISTINA'))?.userId).toBe(sara.id)
  })

  it('una colonna non associata resta da assegnare e non blocca nulla', async () => {
    expect(await aliases.aliasFor('SARA DP.')).toBeNull()
    expect(await aliases.rosterColumnLabels(rosterId)).toContain('SARA DP.')
  })

  it('ignorare una colonna la lascia senza utente', async () => {
    await aliases.ignoreColumnLabel('TOT M')

    expect(await aliases.aliasFor('TOT M')).toEqual({
      label: 'TOT M',
      userId: null,
      ignored: true,
    })
  })

  it('ignorare una colonna già associata scollega l utente', async () => {
    await aliases.assignColumnToUser('TOT M', cristina.id)
    await aliases.ignoreColumnLabel('TOT M')

    expect(await aliases.aliasFor('TOT M')).toEqual({
      label: 'TOT M',
      userId: null,
      ignored: true,
    })
  })

  it('liberare una colonna la riporta da assegnare', async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
    await aliases.clearColumnLabel('CRISTINA')

    expect(await aliases.aliasFor('CRISTINA')).toBeNull()
  })
})

describe('requireColumnAccess — autorizzazione lato server', () => {
  beforeEach(async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
  })

  it('lascia passare l infermiera sulla propria colonna', async () => {
    await expect(confirm.requireColumnAccess(viewer.cristina(), 'CRISTINA')).resolves.toBeUndefined()
  })

  it("rifiuta l'infermiera sulla colonna di un'altra", async () => {
    await expect(confirm.requireColumnAccess(viewer.sara(), 'CRISTINA')).rejects.toThrow(
      confirm.ReviewForbiddenError,
    )
  })

  it('rifiuta l infermiera su una colonna non associata a nessuno', async () => {
    await expect(confirm.requireColumnAccess(viewer.sara(), 'SARA DP.')).rejects.toThrow(
      confirm.ReviewForbiddenError,
    )
  })

  it('lascia passare la referente su qualunque colonna', async () => {
    await expect(confirm.requireColumnAccess(viewer.anna(), 'CRISTINA')).resolves.toBeUndefined()
    await expect(confirm.requireColumnAccess(viewer.anna(), 'SARA DP.')).resolves.toBeUndefined()
  })
})

describe('confirmDays — la conferma è esplicita, per cella o per colonna', () => {
  beforeEach(async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
  })

  it('crea l assegnazione confermata con il codice risolto', async () => {
    const esito = await confirm.confirmDays(viewer.cristina(), {
      rosterId,
      columnLabel: 'CRISTINA',
      days: [1, 2],
    })

    expect(esito.confirmed).toBe(2)
    expect(esito.refused).toEqual([])
    const righe = await prisma.assignment.findMany({ orderBy: { day: 'asc' } })
    expect(righe.map((a) => [a.day, a.code, a.syncState])).toEqual([
      [1, 'M', 'confirmed'],
      [2, 'P', 'confirmed'],
    ])
    expect(righe.every((a) => a.userId === cristina.id)).toBe(true)
    expect(righe.every((a) => a.confirmedAt !== null)).toBe(true)
  })

  it('rifiuta un codice sconosciuto invece di inventargli un orario', async () => {
    const esito = await confirm.confirmDays(viewer.cristina(), {
      rosterId,
      columnLabel: 'CRISTINA',
      days: [3],
    })

    expect(esito.confirmed).toBe(0)
    expect(esito.refused).toEqual([
      { day: 3, reason: 'Il codice "RSF?" non è nella legenda: va risolto prima di confermarlo' },
    ])
    expect(await prisma.assignment.count()).toBe(0)
  })

  it('rifiuta un giorno senza turno letto', async () => {
    const esito = await confirm.confirmDays(viewer.cristina(), {
      rosterId,
      columnLabel: 'CRISTINA',
      days: [20],
    })

    expect(esito.confirmed).toBe(0)
    expect(esito.refused[0].reason).toMatch(/nessun turno/i)
  })

  it("un'infermiera che confermasse la colonna di un'altra viene respinta e non scrive nulla", async () => {
    await expect(
      confirm.confirmDays(viewer.sara(), { rosterId, columnLabel: 'CRISTINA', days: [1] }),
    ).rejects.toThrow(confirm.ReviewForbiddenError)

    expect(await prisma.assignment.count()).toBe(0)
  })

  it('nemmeno la referente conferma la colonna di un altra: sarebbe un turno sul calendario di qualcuno senza il suo consenso', async () => {
    await expect(
      confirm.confirmDays(viewer.anna(), { rosterId, columnLabel: 'CRISTINA', days: [1] }),
    ).rejects.toThrow(confirm.ReviewForbiddenError)

    expect(await prisma.assignment.count()).toBe(0)
  })

  it('una colonna non associata a nessuno non si conferma', async () => {
    await expect(
      confirm.confirmDays(viewer.sara(), { rosterId, columnLabel: 'SARA DP.', days: [1] }),
    ).rejects.toThrow(confirm.ReviewForbiddenError)
  })

  it('riconfermare lo stesso giorno con un codice cambiato aggiorna la riga, non ne crea due', async () => {
    await confirm.confirmDays(viewer.cristina(), { rosterId, columnLabel: 'CRISTINA', days: [1] })
    await prisma.rosterCell.updateMany({
      where: { rosterId, day: 1, columnLabel: 'CRISTINA' },
      data: { rawCode: 'P', code: 'P' },
    })

    await confirm.confirmDays(viewer.cristina(), { rosterId, columnLabel: 'CRISTINA', days: [1] })

    const righe = await prisma.assignment.findMany({ where: { rosterId, day: 1 } })
    expect(righe).toHaveLength(1)
    expect(righe[0].code).toBe('P')
  })

  it('confirmColumn conferma tutti i giorni confermabili e dichiara quelli rifiutati', async () => {
    const esito = await confirm.confirmColumn(viewer.cristina(), { rosterId, columnLabel: 'CRISTINA' })

    expect(esito.confirmed).toBe(2)
    expect(esito.refused.map((r) => r.day)).toEqual([3])
  })
})

describe('unconfirmDays — togliere una conferma senza perdere la traccia dell evento', () => {
  beforeEach(async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
    await confirm.confirmDays(viewer.cristina(), { rosterId, columnLabel: 'CRISTINA', days: [1] })
  })

  it('riporta l assegnazione a bozza conservando l id dell evento già creato', async () => {
    await prisma.assignment.updateMany({
      where: { rosterId, day: 1 },
      data: { eventId: 'evento-google-1', syncState: 'synced' },
    })

    const esito = await confirm.unconfirmDays(viewer.cristina(), {
      rosterId,
      columnLabel: 'CRISTINA',
      days: [1],
    })

    expect(esito.unconfirmed).toBe(1)
    const riga = await prisma.assignment.findFirstOrThrow({ where: { rosterId, day: 1 } })
    expect(riga.confirmedAt).toBeNull()
    expect(riga.syncState).toBe('draft')
    // L id dell evento resta: senza quello il sync non saprebbe quale evento ha creato lui.
    expect(riga.eventId).toBe('evento-google-1')
  })

  it("rifiuta chi non ha accesso alla colonna", async () => {
    await expect(
      confirm.unconfirmDays(viewer.sara(), { rosterId, columnLabel: 'CRISTINA', days: [1] }),
    ).rejects.toThrow(confirm.ReviewForbiddenError)

    const riga = await prisma.assignment.findFirstOrThrow({ where: { rosterId, day: 1 } })
    expect(riga.confirmedAt).not.toBeNull()
  })
})

describe('columnAssignments — cosa la griglia sa delle conferme', () => {
  it('restituisce solo le assegnazioni della persona associata alla colonna', async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
    await confirm.confirmDays(viewer.cristina(), { rosterId, columnLabel: 'CRISTINA', days: [1] })

    const trovate = await confirm.columnAssignments(rosterId, 'CRISTINA')

    expect(trovate.map((a) => a.day)).toEqual([1])
    expect(trovate[0].code).toBe('M')
  })

  it('su una colonna non associata non ci sono conferme', async () => {
    expect(await confirm.columnAssignments(rosterId, 'SARA DP.')).toEqual([])
  })
})

describe('reviewableRosters — cosa un utente ha da confermare', () => {
  it("elenca le tabelle in cui l'utente ha una colonna", async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)

    const perCristina = await confirm.reviewableRosters(viewer.cristina())
    expect(perCristina.map((r) => r.id)).toEqual([rosterId])

    const perSara = await confirm.reviewableRosters(viewer.sara())
    expect(perSara).toEqual([])
  })

  it('la referente vede tutte le tabelle, anche senza una colonna sua', async () => {
    const perAnna = await confirm.reviewableRosters(viewer.anna())
    expect(perAnna.map((r) => r.id)).toEqual([rosterId])
  })

  it('non elenca una tabella ancora in estrazione a chi non è referente', async () => {
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
    await rosterRepo.prepareExtraction(rosterId, 2, new Date())

    expect(await confirm.reviewableRosters(viewer.cristina())).toEqual([])
    expect((await confirm.reviewableRosters(viewer.anna())).map((r) => r.id)).toEqual([rosterId])
  })
})
