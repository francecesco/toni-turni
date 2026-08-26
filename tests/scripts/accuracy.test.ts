import { describe, expect, it } from 'vitest'
import { compareExtraction } from '../../scripts/accuracy'

const expected = {
  year: 2026,
  month: 8,
  ward: '3°PIANO',
  cells: [
    { day: 1, column: 'RENATA', code: 'M' },
    { day: 2, column: 'RENATA', code: 'RP' },
    { day: 1, column: 'MERY', code: 'M/P' },
  ],
}

function actual(cells: Array<{ day: number; column: string; code: string }>) {
  return {
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    columns: ['RENATA', 'MERY'],
    cells: cells.map((c) => ({ ...c, confidence: 1, handCorrected: false })),
  }
}

describe('compareExtraction', () => {
  it('conta tutte corrette quando coincidono', () => {
    const report = compareExtraction(expected, actual(expected.cells))
    expect(report).toMatchObject({ total: 3, correct: 3, missing: 0, spurious: 0 })
    expect(report.wrong).toEqual([])
  })

  it('considera equivalenti le forme compatte dello stesso codice', () => {
    const report = compareExtraction(
      { ...expected, cells: [{ day: 1, column: 'RENATA', code: 'M1°P' }] },
      actual([{ day: 1, column: 'RENATA', code: 'm 1°p' }]),
    )
    expect(report.correct).toBe(1)
  })

  it('segnala una cella letta male, con atteso e trovato', () => {
    const report = compareExtraction(expected, actual([
      { day: 1, column: 'RENATA', code: 'P' },
      { day: 2, column: 'RENATA', code: 'RP' },
      { day: 1, column: 'MERY', code: 'M/P' },
    ]))
    expect(report.correct).toBe(2)
    expect(report.wrong).toEqual([
      { day: 1, column: 'RENATA', expected: 'M', actual: 'P' },
    ])
  })

  it('conta le celle attese che il modello non ha prodotto', () => {
    const report = compareExtraction(expected, actual([{ day: 1, column: 'RENATA', code: 'M' }]))
    expect(report.missing).toBe(2)
  })

  it('conta le celle prodotte che nessuno si aspettava', () => {
    const report = compareExtraction(
      { ...expected, cells: [{ day: 1, column: 'RENATA', code: 'M' }] },
      actual([
        { day: 1, column: 'RENATA', code: 'M' },
        { day: 9, column: 'RENATA', code: 'M' },
      ]),
    )
    expect(report.spurious).toBe(1)
  })

  it('riporta l accuratezza per colonna, così si vede se una è illeggibile', () => {
    const report = compareExtraction(expected, actual([
      { day: 1, column: 'RENATA', code: 'M' },
      { day: 2, column: 'RENATA', code: 'RP' },
      { day: 1, column: 'MERY', code: 'SBAGLIATO' },
    ]))
    expect(report.byColumn).toEqual({
      RENATA: { total: 2, correct: 2 },
      MERY: { total: 1, correct: 0 },
    })
  })
})
