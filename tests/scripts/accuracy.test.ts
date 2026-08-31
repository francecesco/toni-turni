import { describe, expect, it } from 'vitest'
import { compareExtraction, validateExpectedRoster } from '../../scripts/accuracy'
import { parseExtraction } from '../../src/modules/extract/schema'

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

function actual(
  cells: Array<{ day: number; column: string; code: string; confidence?: number; handCorrected?: boolean }>,
) {
  return {
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    columns: ['RENATA', 'MERY'],
    // i valori di default vengono prima, così una cella può sovrascriverli esplicitamente
    cells: cells.map((c) => ({ confidence: 1, handCorrected: false, ...c })),
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

  it('non considera equivalenti M e M/P: sette ore non sono quattordici', () => {
    const report = compareExtraction(
      { ...expected, cells: [{ day: 1, column: 'RENATA', code: 'M' }] },
      actual([{ day: 1, column: 'RENATA', code: 'M/P' }]),
    )
    expect(report.correct).toBe(0)
    expect(report.wrong).toEqual([
      { day: 1, column: 'RENATA', expected: 'M', actual: 'M/P' },
    ])
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

  describe('precisione e recall su handCorrected', () => {
    // La fixture di agosto tiene handCorrected e penAnnotations deliberatamente
    // separate: marcare un annotazione a penna come correzione è un falso positivo,
    // non un errore di lettura del codice.
    const expectedConCorrezioni = {
      ...expected,
      handCorrected: [
        { day: 1, column: 'RENATA' },
        { day: 2, column: 'RENATA' },
      ],
      penAnnotations: [{ day: 1, column: 'MERY' }],
    }

    it('conta vero positivo, falso negativo e falso positivo (da una penAnnotation)', () => {
      const report = compareExtraction(
        expectedConCorrezioni,
        actual([
          { day: 1, column: 'RENATA', code: 'M', handCorrected: true }, // vero positivo
          { day: 2, column: 'RENATA', code: 'RP', handCorrected: false }, // falso negativo
          { day: 1, column: 'MERY', code: 'M/P', handCorrected: true }, // falso positivo: è una penAnnotation
        ]),
      )

      expect(report.handCorrectedAccuracy).toEqual({
        truePositives: 1,
        falseNegatives: 1,
        falsePositives: 1,
        precision: 0.5,
        recall: 0.5,
      })
    })

    it('non calcola la statistica se la fixture non porta handCorrected', () => {
      const report = compareExtraction(expected, actual(expected.cells))
      expect(report.handCorrectedAccuracy).toBeUndefined()
    })
  })

  describe('raggruppamento per fascia di confidenza', () => {
    it('conta celle totali e corrette per fascia', () => {
      const report = compareExtraction(
        expected,
        actual([
          { day: 1, column: 'RENATA', code: 'M', confidence: 0.3 }, // <0.5, corretta
          { day: 2, column: 'RENATA', code: 'SBAGLIATO', confidence: 0.6 }, // 0.5-0.8, sbagliata
          { day: 1, column: 'MERY', code: 'M/P', confidence: 0.95 }, // >=0.8, corretta
        ]),
      )

      expect(report.byConfidenceBucket).toEqual({
        '<0.5': { total: 1, correct: 1 },
        '0.5-0.8': { total: 1, correct: 0 },
        '>=0.8': { total: 1, correct: 1 },
      })
    })
  })

  describe('interazione con lo schema di validazione', () => {
    // Lo schema (punto 3) accetta una colonna con spazio doppio come la stessa
    // dichiarata in intestazione: se il confronto qui usasse una normalizzazione
    // diversa, quella stessa cella tornerebbe a essere contata come mancante (dal
    // lato atteso) e spuria (dal lato prodotto), anche se il modello l aveva letta
    // giusta. Le due normalizzazioni devono essere la stessa funzione.
    it('una colonna con spazio doppio, valida dallo schema, risulta corretta e non mancante/spuria', () => {
      const raw = JSON.stringify({
        year: 2026,
        month: 8,
        ward: '3°PIANO',
        columns: ['ANNA LIA'],
        cells: [{ day: 1, column: 'ANNA  LIA', code: 'M', confidence: 0.9, handCorrected: false }],
      })

      const parsed = parseExtraction(raw)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const report = compareExtraction(
        { ...expected, cells: [{ day: 1, column: 'ANNA LIA', code: 'M' }] },
        parsed.value,
      )

      expect(report.correct).toBe(1)
      expect(report.missing).toBe(0)
      expect(report.spurious).toBe(0)
    })
  })
})

describe('validateExpectedRoster', () => {
  it('accetta una fixture con celle ben formate', () => {
    const result = validateExpectedRoster({
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      cells: [{ day: 1, column: 'RENATA', code: 'M' }],
    })
    expect(result.ok).toBe(true)
  })

  it('rifiuta con un messaggio chiaro una fixture senza cells, invece di produrre NaN%', () => {
    const result = validateExpectedRoster({ year: 2026, month: 8, ward: '3°PIANO', cells: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/cells/i)
  })

  it('rifiuta una fixture che non è un oggetto', () => {
    const result = validateExpectedRoster('non è un oggetto')
    expect(result.ok).toBe(false)
  })

  it('rifiuta una cella senza day/column/code nella forma giusta', () => {
    const result = validateExpectedRoster({
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      cells: [{ day: '1', column: 'RENATA' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/cells\[0\]/)
  })
})

/**
 * Due domande diverse sullo stesso segnale, e tenerle separate e il punto.
 *
 * `handCorrectedAccuracy` misura se il modello trova le celle **riscritte a
 * mano**: e il segnale su cui si regge la griglia di conferma, e la sua recall e
 * quello che non deve scendere.
 *
 * `toReviewAccuracy` misura se trova le celle che **una persona deve rileggere**,
 * che sono le riscritture *piu* le annotazioni d orario a penna (`M 7`, `P 13`):
 * quelle non cambiano il codice ma cambiano l ora di inizio, quindi finiscono in
 * calendario sbagliate se nessuno le guarda. Il prompt chiede al modello di
 * marcarle, quindi contarle come falsi positivi misurerebbe il contrario di
 * quello che si e chiesto.
 *
 * Restano due numeri e non uno perche rispondono a due domande: sostituire il
 * primo col secondo nasconderebbe un peggioramento del primo dietro un
 * miglioramento del secondo.
 */
describe('compareExtraction, celle da rileggere', () => {
  const base = {
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    cells: [
      { day: 1, column: 'RENATA', code: 'M' },
      { day: 2, column: 'RENATA', code: 'P' },
      { day: 3, column: 'RENATA', code: 'M' },
    ],
    handCorrected: [{ day: 1, column: 'RENATA' }],
    penAnnotations: [{ day: 2, column: 'RENATA' }],
  }

  function letta(marcate: number[]) {
    return {
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      columns: ['RENATA'],
      cells: base.cells.map((c) => ({
        ...c,
        confidence: 0.9,
        handCorrected: marcate.includes(c.day),
      })),
    }
  }

  it('una annotazione a penna marcata non e un falso positivo fra le celle da rileggere', () => {
    const report = compareExtraction(base, letta([1, 2]))

    // la misura stretta la conta come falso positivo, e resta cosi
    expect(report.handCorrectedAccuracy).toEqual(
      expect.objectContaining({ truePositives: 1, falsePositives: 1, falseNegatives: 0 }),
    )
    // la misura larga la conta per quello che e: una cella da rileggere, trovata
    expect(report.toReviewAccuracy).toEqual(
      expect.objectContaining({ truePositives: 2, falsePositives: 0, falseNegatives: 0 }),
    )
  })

  it('una cella marcata che non e ne riscritta ne annotata resta un falso positivo', () => {
    const report = compareExtraction(base, letta([1, 2, 3]))

    expect(report.toReviewAccuracy?.falsePositives).toBe(1)
  })

  it('elenca le celle marcate che non risultano ne riscritte ne annotate', () => {
    // Senza l elenco, "10 falsi positivi" non si sa dove guardare.
    const report = compareExtraction(base, letta([3]))

    expect(report.unexplainedHandCorrected).toEqual([{ day: 3, column: 'RENATA' }])
  })

  it('non riporta la misura larga se la fixture non dichiara nessuna delle due liste', () => {
    const senzaListe = { ...base, handCorrected: undefined, penAnnotations: undefined }

    expect(compareExtraction(senzaListe, letta([1])).toReviewAccuracy).toBeUndefined()
  })
})
