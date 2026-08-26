import { compactCode } from '../src/modules/codes/normalize'
import type { Extraction } from '../src/modules/extract/schema'

export interface ExpectedRoster {
  year: number
  month: number
  ward: string
  cells: Array<{ day: number; column: string; code: string }>
}

export interface AccuracyReport {
  total: number
  correct: number
  missing: number
  spurious: number
  wrong: Array<{ day: number; column: string; expected: string; actual: string }>
  byColumn: Record<string, { total: number; correct: number }>
}

function key(day: number, column: string): string {
  return `${day}:${column.trim().toUpperCase()}`
}

/** Il confronto è sulla forma compatta: "M 1°P" e "M1°P" sono lo stesso turno. */
export function compareExtraction(expected: ExpectedRoster, actual: Extraction): AccuracyReport {
  const trovate = new Map(actual.cells.map((cell) => [key(cell.day, cell.column), cell.code]))

  const report: AccuracyReport = {
    total: expected.cells.length,
    correct: 0,
    missing: 0,
    spurious: 0,
    wrong: [],
    byColumn: {},
  }

  for (const attesa of expected.cells) {
    const colonna = attesa.column.trim().toUpperCase()
    report.byColumn[colonna] ??= { total: 0, correct: 0 }
    report.byColumn[colonna].total += 1

    const trovata = trovate.get(key(attesa.day, attesa.column))
    if (trovata === undefined) {
      report.missing += 1
      continue
    }

    if (compactCode(trovata) === compactCode(attesa.code)) {
      report.correct += 1
      report.byColumn[colonna].correct += 1
    } else {
      report.wrong.push({
        day: attesa.day,
        column: attesa.column,
        expected: attesa.code,
        actual: trovata,
      })
    }
  }

  const attese = new Set(expected.cells.map((cell) => key(cell.day, cell.column)))
  report.spurious = actual.cells.filter((cell) => !attese.has(key(cell.day, cell.column))).length

  return report
}
