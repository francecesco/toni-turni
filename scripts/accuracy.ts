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
  const found = new Map(actual.cells.map((cell) => [key(cell.day, cell.column), cell.code]))

  const report: AccuracyReport = {
    total: expected.cells.length,
    correct: 0,
    missing: 0,
    spurious: 0,
    wrong: [],
    byColumn: {},
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

  return report
}
