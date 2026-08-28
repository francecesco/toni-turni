import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

/**
 * La correzione a mano di una cella.
 *
 * Perché serve: sulla misura reale il modello sbaglia una cella su 488, e quella cella
 * è quasi certamente una riscritta a penna sopra il correttore — cioè proprio quelle
 * che contano. Senza una correzione, l unica cosa che l utente poteva fare era **non**
 * confermare quel giorno, e quel turno non finiva sul calendario.
 *
 * I permessi: l infermiera corregge **la propria** colonna, perché sulla propria
 * colonna è lei l autorità (sa che turno ha fatto); la referente **qualsiasi** colonna,
 * perché sul foglio l autorità è lei.
 */

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let correct: typeof import('@/modules/review/correct')
let confirm: typeof import('@/modules/review/confirm')
let aliases: typeof import('@/modules/review/aliases')
let roster: typeof import('@/modules/roster/repository')

const CRISTINA = { id: 'u-cristina', role: 'NURSE' as const }
const SARA = { id: 'u-sara', role: 'NURSE' as const }
const ANNA = { id: 'u-anna', role: 'REFERENTE' as const }

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  correct = await import('@/modules/review/correct')
  confirm = await import('@/modules/review/confirm')
  aliases = await import('@/modules/review/aliases')
  roster = await import('@/modules/roster/repository')
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
      { code: 'RIP', label: 'Riposo', kind: 'info', startTime: null, endTime: null },
    ],
  })
  await prisma.user.createMany({
    data: [
      { id: CRISTINA.id, email: 'cri@example.com', displayName: 'Cristina', role: 'NURSE' },
      { id: SARA.id, email: 'sara@example.com', displayName: 'Sara', role: 'NURSE' },
      { id: ANNA.id, email: 'anna@example.com', displayName: 'Anna', role: 'REFERENTE' },
    ],
  })
  await prisma.roster.create({
    data: {
      id: 'roster1',
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      imagePath: 'a.jpg',
      status: 'extracted',
    },
  })
  await prisma.rosterCell.createMany({
    data: [
      {
        rosterId: 'roster1',
        day: 8,
        columnLabel: 'CRISTINA',
        rawCode: 'H',
        code: null,
        confidence: 0.95,
        handCorrected: true,
        bandIndex: 0,
      },
      {
        rosterId: 'roster1',
        day: 9,
        columnLabel: 'CRISTINA',
        rawCode: 'M',
        code: 'M',
        confidence: 0.99,
        bandIndex: 0,
      },
      {
        rosterId: 'roster1',
        day: 9,
        columnLabel: 'SARA',
        rawCode: 'P',
        code: 'P',
        confidence: 0.99,
        bandIndex: 0,
      },
    ],
  })
  await aliases.assignColumnToUser('CRISTINA', CRISTINA.id)
  await aliases.assignColumnToUser('SARA', SARA.id)
})

function cella(day: number, columnLabel = 'CRISTINA') {
  return prisma.rosterCell.findFirstOrThrow({ where: { rosterId: 'roster1', day, columnLabel } })
}

describe('correctCell — chi può correggere', () => {
  it("un'infermiera corregge la propria colonna", async () => {
    const esito = await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 9,
      code: 'P',
    })

    expect(esito.code).toBe('P')
    const riga = await cella(9)
    expect(riga.correctedCode).toBe('P')
    expect(riga.correctedAt).not.toBeNull()
    expect(riga.correctedBy).toBe(CRISTINA.id)
  })

  it("un'infermiera NON corregge la colonna di un'altra, e non scrive nulla", async () => {
    await expect(
      correct.correctCell(SARA, {
        rosterId: 'roster1',
        columnLabel: 'CRISTINA',
        day: 9,
        code: 'P',
      }),
    ).rejects.toThrow(correct.ReviewForbiddenError)

    const riga = await cella(9)
    expect(riga.correctedAt).toBeNull()
    expect(riga.correctedCode).toBeNull()
  })

  it('la referente corregge qualsiasi colonna: sul foglio l autorità è lei', async () => {
    await correct.correctCell(ANNA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 9,
      code: 'P',
    })

    const riga = await cella(9)
    expect(riga.correctedCode).toBe('P')
    expect(riga.correctedBy).toBe(ANNA.id)
  })
})

describe('correctCell — cosa si può scrivere in una cella', () => {
  it('un codice fuori dalla legenda è rifiutato: senza orario non può diventare un evento', async () => {
    await expect(
      correct.correctCell(CRISTINA, {
        rosterId: 'roster1',
        columnLabel: 'CRISTINA',
        day: 9,
        code: 'INVENTATO',
      }),
    ).rejects.toThrow(correct.ReviewRejectedError)

    const riga = await cella(9)
    expect(riga.correctedAt).toBeNull()
  })

  it('si può svuotare una cella: il foglio lì è vuoto', async () => {
    const esito = await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 9,
      code: null,
    })

    expect(esito.code).toBeNull()
    const riga = await cella(9)
    expect(riga.correctedAt).not.toBeNull()
    expect(riga.correctedCode).toBeNull()
    // La lettura del modello resta dov era: la provenienza non si cancella.
    expect(riga.rawCode).toBe('M')
    expect(riga.code).toBe('M')
  })

  it('si può assegnare un codice a un giorno che il modello non ha letto', async () => {
    await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 15,
      code: 'M',
    })

    const riga = await cella(15)
    expect(riga.correctedCode).toBe('M')
    expect(riga.correctedAt).not.toBeNull()
    // Il modello non ha letto niente: non gli si attribuisce una lettura.
    expect(riga.rawCode).toBe('')
    expect(riga.code).toBeNull()
    expect(riga.confidence).toBe(0)
    expect(riga.bandIndex).toBeNull()
  })

  it('un giorno fuori dal mese è rifiutato', async () => {
    await expect(
      correct.correctCell(CRISTINA, {
        rosterId: 'roster1',
        columnLabel: 'CRISTINA',
        day: 32,
        code: 'M',
      }),
    ).rejects.toThrow(correct.ReviewRejectedError)
  })

  it('una tabella inesistente è rifiutata, non crea celle appese al nulla', async () => {
    await expect(
      correct.correctCell(ANNA, {
        rosterId: 'non-esiste',
        columnLabel: 'CRISTINA',
        day: 1,
        code: 'M',
      }),
    ).rejects.toThrow(correct.ReviewRejectedError)
  })

  it('la punteggiatura non crea una seconda cella per la stessa colonna', async () => {
    // `SARA DP.` e `SARA DP` sono la stessa colonna: l identità è `normalizeColumn`.
    await correct.correctCell(SARA, {
      rosterId: 'roster1',
      columnLabel: 'sara',
      day: 9,
      code: 'M',
    })

    const righe = await prisma.rosterCell.findMany({ where: { rosterId: 'roster1', day: 9 } })
    expect(righe).toHaveLength(2)
    const suaCella = righe.find((r) => r.columnLabel === 'SARA')
    expect(suaCella?.correctedCode).toBe('M')
  })
})

describe('correctCell — dalla correzione al calendario si passa dalla conferma', () => {
  it('correggere una cella già confermata annulla quella conferma', async () => {
    await confirm.confirmDays(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      days: [9],
    })
    await prisma.assignment.updateMany({
      where: { userId: CRISTINA.id },
      data: { syncState: 'synced', eventId: 'evento-1' },
    })

    const esito = await correct.correctCell(ANNA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 9,
      code: 'P',
    })

    expect(esito.unconfirmed).toBe(true)
    const assegnazione = await prisma.assignment.findFirstOrThrow({
      where: { userId: CRISTINA.id, day: 9 },
    })
    expect(assegnazione.confirmedAt).toBeNull()
    expect(assegnazione.syncState).toBe('draft')
    // L eventId resta: il prossimo sync deve poter aggiornare l evento che ha creato.
    expect(assegnazione.eventId).toBe('evento-1')
  })

  it('la conferma successiva scrive il codice corretto, non quello letto dall AI', async () => {
    await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 9,
      code: 'P',
    })

    const esito = await confirm.confirmDays(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      days: [9],
    })

    expect(esito.confirmed).toBe(1)
    const assegnazione = await prisma.assignment.findFirstOrThrow({ where: { day: 9 } })
    expect(assegnazione.code).toBe('P')
  })

  it('una cella che il modello non aveva letto, corretta a mano, diventa confermabile', async () => {
    await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 8,
      code: 'M',
    })

    const esito = await confirm.confirmDays(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      days: [8],
    })

    expect(esito.refused).toEqual([])
    const assegnazione = await prisma.assignment.findFirstOrThrow({ where: { day: 8 } })
    expect(assegnazione.code).toBe('M')
  })

  it('una cella svuotata a mano non si conferma, e l assegnazione che c era viene rimossa', async () => {
    await confirm.confirmDays(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      days: [9],
    })

    const esito = await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 9,
      code: null,
    })

    // `Assignment.code` non è facoltativo: una bozza con il codice vecchio sarebbe un
    // dato falso. Il turno non esiste più, quindi la riga sparisce e il prossimo sync
    // dell intestataria toglie l evento dal calendario.
    expect(esito.assignmentRemoved).toBe(true)
    expect(await prisma.assignment.count()).toBe(0)

    const riconferma = await confirm.confirmDays(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      days: [9],
    })
    expect(riconferma.confirmed).toBe(0)
    expect(riconferma.refused[0]?.reason).toMatch(/vuot/i)
  })
})

describe('correctCell — una correzione manuale non si perde', () => {
  it('rileggere la banda non sovrascrive una cella corretta a mano', async () => {
    await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 8,
      code: 'M',
    })

    // Il modello rilegge la stessa banda e sulla cella corretta si ostina a dire `H`.
    await roster.saveBandCells(
      'roster1',
      0,
      [
        { day: 8, column: 'CRISTINA', code: 'H', confidence: 0.95, handCorrected: true },
        { day: 9, column: 'CRISTINA', code: 'RIP', confidence: 0.99, handCorrected: false },
      ],
      { rawOutput: '{}', now: new Date() },
    )

    const corretta = await cella(8)
    expect(corretta.correctedCode).toBe('M')
    expect(corretta.correctedAt).not.toBeNull()

    // Le celle non corrette invece si aggiornano: la rilettura vale per loro.
    const nonCorretta = await cella(9)
    expect(nonCorretta.rawCode).toBe('RIP')
  })

  it('una cella creata a mano su un giorno mai letto non viene duplicata dalla rilettura', async () => {
    await correct.correctCell(CRISTINA, {
      rosterId: 'roster1',
      columnLabel: 'CRISTINA',
      day: 15,
      code: 'M',
    })

    await roster.saveBandCells(
      'roster1',
      0,
      [{ day: 15, column: 'CRISTINA', code: 'P', confidence: 0.9, handCorrected: false }],
      { rawOutput: '{}', now: new Date() },
    )

    const righe = await prisma.rosterCell.findMany({ where: { rosterId: 'roster1', day: 15 } })
    expect(righe).toHaveLength(1)
    expect(righe[0].correctedCode).toBe('M')
  })
})
