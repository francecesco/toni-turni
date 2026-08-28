import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import type { BandFailure } from '@/modules/extract/extract-bands'
import type { Extraction } from '@/modules/extract/schema'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let repo: typeof import('@/modules/roster/repository')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  repo = await import('@/modules/roster/repository')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.shiftCode.deleteMany()
  await prisma.shiftCode.createMany({
    data: [{ code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' }],
  })
})

function estrazione(): Extraction {
  return {
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    columns: ['RENATA'],
    cells: [{ day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false }],
  }
}

function bandaNonLetta(dayFrom: number, dayTo: number, error: string): BandFailure {
  return {
    spec: {
      columns: [3, 4],
      dayFrom,
      dayTo,
      days: { left: 0, width: 0.1 },
      crop: { left: 0.3, top: 0, width: 0.2, height: 0.55 },
      header: null,
    },
    error,
  }
}

async function roster() {
  return repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
}

describe('saveExtraction con bande non lette', () => {
  it('senza bande mancanti lo stato è extracted e missingBands resta null', async () => {
    const r = await roster()

    await repo.saveExtraction(r.id, estrazione(), { provider: 'groq', rawOutput: '{}' })

    const salvato = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvato.status).toBe('extracted')
    expect(salvato.missingBands).toBeNull()
  })

  it('con bande mancanti lo stato è partial e le bande sono dichiarate', async () => {
    const r = await roster()
    const buchi = [bandaNonLetta(17, 31, 'quota esaurita'), bandaNonLetta(1, 16, 'risposta troncata')]

    await repo.saveExtraction(r.id, estrazione(), {
      provider: 'groq',
      rawOutput: '{}',
      missingBands: buchi,
    })

    const salvato = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvato.status).toBe('partial')
    expect(salvato.missingBands).not.toBeNull()

    const letto = JSON.parse(salvato.missingBands ?? '[]') as BandFailure[]
    expect(letto).toHaveLength(2)
    expect(letto[0].spec.dayFrom).toBe(17)
    expect(letto[0].spec.dayTo).toBe(31)
    expect(letto[0].error).toContain('quota esaurita')
    expect(letto[1].error).toContain('troncata')
  })

  it('un elenco vuoto di bande mancanti non è un estrazione parziale', async () => {
    const r = await roster()

    await repo.saveExtraction(r.id, estrazione(), {
      provider: 'groq',
      rawOutput: '{}',
      missingBands: [],
    })

    const salvato = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvato.status).toBe('extracted')
    expect(salvato.missingBands).toBeNull()
  })

  it('un nuovo salvataggio completo ripulisce i buchi del salvataggio parziale', async () => {
    const r = await roster()

    await repo.saveExtraction(r.id, estrazione(), {
      provider: 'groq',
      rawOutput: '{}',
      missingBands: [bandaNonLetta(1, 16, 'quota esaurita')],
    })
    await repo.saveExtraction(r.id, estrazione(), { provider: 'groq', rawOutput: '{}' })

    const salvato = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvato.status).toBe('extracted')
    // altrimenti resterebbe la dichiarazione di un buco che non c è più
    expect(salvato.missingBands).toBeNull()
  })

  it('salva le celle lette anche quando l estrazione è parziale', async () => {
    const r = await roster()

    const esito = await repo.saveExtraction(r.id, estrazione(), {
      provider: 'groq',
      rawOutput: '{}',
      missingBands: [bandaNonLetta(17, 31, 'quota esaurita')],
    })

    expect(esito.cells).toBe(1)
    const celle = await prisma.rosterCell.findMany({ where: { rosterId: r.id } })
    expect(celle).toHaveLength(1)
    expect(celle[0].code).toBe('M')
  })

  it('lo stato partial è distinguibile da un estrazione senza celle', async () => {
    // tre celle non lette per un problema tecnico non sono tre celle vuote sul
    // foglio: è la distinzione per cui esiste questo stato
    const r = await roster()

    await repo.saveExtraction(
      r.id,
      { year: 2026, month: 8, ward: '3°PIANO', columns: [], cells: [] },
      { provider: 'groq', rawOutput: 'niente', missingBands: [bandaNonLetta(1, 16, 'quota')] },
    )

    const salvato = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvato.status).toBe('partial')
    expect(JSON.parse(salvato.missingBands ?? '[]')).toHaveLength(1)
  })
})
