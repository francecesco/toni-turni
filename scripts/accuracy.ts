import { compactCode } from '../src/modules/codes/normalize'
import { normalizeColumn, type Extraction } from '../src/modules/extract/schema'

export interface ExpectedRoster {
  year: number
  month: number
  ward: string
  cells: Array<{ day: number; column: string; code: string }>
  /**
   * Correzioni a penna/correttore vere, tenute separate da `penAnnotations` nella
   * fixture: è il segnale su cui si regge la Fase 3 (rilettura umana delle celle
   * incerte), quindi va misurato a sé.
   */
  handCorrected?: Array<{ day: number; column: string }>
  /** Annotazioni a penna che NON cambiano il codice: marcarle come corrette è un falso positivo. */
  penAnnotations?: Array<{ day: number; column: string }>
  /** false finché nessuno che conosce il reparto ha controllato la trascrizione. */
  verified?: boolean
  /** Avviso libero da riportare accanto a ogni percentuale calcolata su questa fixture. */
  _avvertenza?: string
  /** Punto meno certo della trascrizione, se ce n è uno. */
  _daVerificare?: string
}

/**
 * Controllo minimo di forma prima di usare la fixture: una fixture vuota o
 * malformata non deve produrre un NaN% silenzioso, ma un rifiuto con un messaggio
 * chiaro su cosa manca.
 */
export function validateExpectedRoster(
  data: unknown,
): { ok: true; value: ExpectedRoster } | { ok: false; error: string } {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'la fixture non è un oggetto JSON' }
  }

  const obj = data as Record<string, unknown>

  if (!Array.isArray(obj.cells) || obj.cells.length === 0) {
    return { ok: false, error: 'manca "cells", o è vuoto: senza celle attese non c è nulla da misurare' }
  }

  for (let i = 0; i < obj.cells.length; i += 1) {
    const cell = obj.cells[i] as unknown
    const c = typeof cell === 'object' && cell !== null ? (cell as Record<string, unknown>) : null
    if (
      c === null ||
      typeof c.day !== 'number' ||
      typeof c.column !== 'string' ||
      typeof c.code !== 'string'
    ) {
      return {
        ok: false,
        error: `cells[${i}] deve avere "day" (numero), "column" e "code" (stringhe)`,
      }
    }
  }

  return { ok: true, value: obj as unknown as ExpectedRoster }
}

export interface HandCorrectedAccuracy {
  truePositives: number
  falseNegatives: number
  falsePositives: number
  /** null quando il denominatore è zero: nessuna cella marcata dal modello. */
  precision: number | null
  /** null quando il denominatore è zero: la fixture non porta correzioni attese. */
  recall: number | null
}

type ConfidenceBucket = '<0.5' | '0.5-0.8' | '>=0.8'

function confidenceBucket(confidence: number): ConfidenceBucket {
  if (confidence < 0.5) return '<0.5'
  if (confidence < 0.8) return '0.5-0.8'
  return '>=0.8'
}

export interface AccuracyReport {
  total: number
  correct: number
  missing: number
  spurious: number
  wrong: Array<{ day: number; column: string; expected: string; actual: string }>
  byColumn: Record<string, { total: number; correct: number }>
  /** presente solo se la fixture porta `handCorrected`. */
  handCorrectedAccuracy?: HandCorrectedAccuracy
  /**
   * Come sopra, ma sul segnale **largo**: le celle che una persona deve
   * rileggere, cioè le riscritture a mano **più** le annotazioni d orario a penna
   * (`M 7`, `P 13`). Quelle non cambiano il codice ma cambiano l ora d inizio,
   * quindi finiscono in calendario sbagliate se nessuno le guarda — e il prompt
   * chiede al modello di marcarle. Contarle come falsi positivi misurerebbe il
   * contrario di quello che si è chiesto.
   *
   * Sono **due** numeri e non uno perché rispondono a due domande: sostituire il
   * primo col secondo nasconderebbe un peggioramento del primo dietro un
   * miglioramento del secondo.
   */
  toReviewAccuracy?: HandCorrectedAccuracy
  /**
   * Celle che il modello ha marcato e che la fixture non elenca né fra le
   * riscritture né fra le annotazioni: è dove guardare quando i falsi positivi
   * salgono. Senza l elenco, «10 falsi positivi» non dice dove.
   */
  unexplainedHandCorrected?: Array<{ day: number; column: string }>
  byConfidenceBucket: Record<ConfidenceBucket, { total: number; correct: number }>
}

function key(day: number, column: string): string {
  // Stessa normalizzazione dello schema di validazione (trim, maiuscole, spazi
  // interni collassati): un'unica nozione di identità di colonna, non due che
  // possono disallinearsi silenziosamente.
  return `${day}:${normalizeColumn(column)}`
}

/** Il confronto è sulla forma compatta: "M 1°P" e "M1°P" sono lo stesso turno. */
export function compareExtraction(expected: ExpectedRoster, actual: Extraction): AccuracyReport {
  const found = new Map(actual.cells.map((cell) => [key(cell.day, cell.column), cell.code]))

  const report: AccuracyReport = {
    total: expected.cells.length,
    correct: 0,
    missing: 0,
    spurious: 0,
    wrong: [],
    byColumn: {},
    byConfidenceBucket: {
      '<0.5': { total: 0, correct: 0 },
      '0.5-0.8': { total: 0, correct: 0 },
      '>=0.8': { total: 0, correct: 0 },
    },
  }

  for (const expectedCell of expected.cells) {
    const column = expectedCell.column.trim().toUpperCase()
    report.byColumn[column] ??= { total: 0, correct: 0 }
    report.byColumn[column].total += 1

    const foundCode = found.get(key(expectedCell.day, expectedCell.column))
    if (foundCode === undefined) {
      report.missing += 1
      continue
    }

    if (compactCode(foundCode) === compactCode(expectedCell.code)) {
      report.correct += 1
      report.byColumn[column].correct += 1
    } else {
      report.wrong.push({
        day: expectedCell.day,
        column: expectedCell.column,
        expected: expectedCell.code,
        actual: foundCode,
      })
    }
  }

  const expectedKeys = new Set(expected.cells.map((cell) => key(cell.day, cell.column)))
  report.spurious = actual.cells.filter((cell) => !expectedKeys.has(key(cell.day, cell.column))).length

  // Bucket per fascia di confidenza: su tutte le celle prodotte, non solo su quelle
  // attese, per vedere se la confidenza bassa del modello correla con lo sbagliare.
  const expectedByKey = new Map(expected.cells.map((cell) => [key(cell.day, cell.column), cell.code]))
  for (const cell of actual.cells) {
    const bucket = report.byConfidenceBucket[confidenceBucket(cell.confidence)]
    bucket.total += 1
    const expectedCode = expectedByKey.get(key(cell.day, cell.column))
    if (expectedCode !== undefined && compactCode(expectedCode) === compactCode(cell.code)) {
      bucket.correct += 1
    }
  }

  const marcate = new Set(
    actual.cells.filter((c) => c.handCorrected).map((c) => key(c.day, c.column)),
  )

  /** Precisione e richiamo di `marcate` contro un insieme atteso. */
  function confronta(attese: Set<string>): HandCorrectedAccuracy {
    let truePositives = 0
    let falsePositives = 0
    for (const k of marcate) {
      if (attese.has(k)) truePositives += 1
      else falsePositives += 1
    }

    let falseNegatives = 0
    for (const k of attese) {
      if (!marcate.has(k)) falseNegatives += 1
    }

    return {
      truePositives,
      falsePositives,
      falseNegatives,
      precision:
        truePositives + falsePositives === 0 ? null : truePositives / (truePositives + falsePositives),
      recall:
        truePositives + falseNegatives === 0 ? null : truePositives / (truePositives + falseNegatives),
    }
  }

  if (expected.handCorrected) {
    // Misura **stretta**: solo le celle riscritte a mano. Una annotazione a penna
    // marcata resta un falso positivo qui, di proposito: e la recall di questo
    // numero che non deve scendere, perche e il segnale su cui si regge la griglia
    // di conferma.
    report.handCorrectedAccuracy = confronta(
      new Set(expected.handCorrected.map((h) => key(h.day, h.column))),
    )
  }

  if (expected.handCorrected || expected.penAnnotations) {
    const daRileggere = new Set([
      ...(expected.handCorrected ?? []).map((h) => key(h.day, h.column)),
      ...(expected.penAnnotations ?? []).map((h) => key(h.day, h.column)),
    ])
    report.toReviewAccuracy = confronta(daRileggere)
    report.unexplainedHandCorrected = [...marcate]
      .filter((k) => !daRileggere.has(k))
      .map((k) => {
        const [day, column] = k.split(':')
        return { day: Number(day), column }
      })
  }

  return report
}
