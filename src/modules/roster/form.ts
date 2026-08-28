import { DEFAULT_COLUMNS_PER_BAND, DEFAULT_DAY_COLUMN_FRACTION } from '@/modules/ingest'

/**
 * Validazione del modulo di caricamento. Logica pura, testabile senza HTTP: la
 * route la usa e si limita a rimandare i messaggi alla referente.
 */

export interface UploadValues {
  year: number
  month: number
  ward: string
  columnCount: number
  columnsPerBand: number
  dayColumnFraction: number
  area: { left: number; top: number; right: number; bottom: number }
}

export type UploadParseResult =
  | { ok: true; value: UploadValues }
  | { ok: false; errors: string[] }

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

function intero(form: FormData, field: string): number | null {
  const raw = text(form, field)
  if (raw === '') return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) ? parsed : null
}

function frazione(form: FormData, field: string): number | null {
  const raw = text(form, field)
  if (raw === '') return null
  const parsed = Number(raw.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseUploadForm(form: FormData): UploadParseResult {
  const errors: string[] = []

  const year = intero(form, 'year')
  if (year === null || year < 2020 || year > 2100) {
    errors.push('Anno non valido')
  }

  const month = intero(form, 'month')
  if (month === null || month < 1 || month > 12) {
    errors.push('Mese non valido: deve stare fra 1 e 12')
  }

  const ward = text(form, 'ward')
  if (ward === '' || ward.length > 60) {
    errors.push('Indica il reparto (per esempio 3°PIANO)')
  }

  const columnCount = intero(form, 'columnCount')
  if (columnCount === null || columnCount < 1 || columnCount > 40) {
    errors.push('Il numero di colonne della tabella deve stare fra 1 e 40')
  }

  const columnsPerBand = intero(form, 'columnsPerBand') ?? DEFAULT_COLUMNS_PER_BAND
  if (columnsPerBand < 1 || columnsPerBand > 6) {
    errors.push('Le colonne per banda devono stare fra 1 e 6')
  }

  const dayColumnFraction = frazione(form, 'dayColumnFraction') ?? DEFAULT_DAY_COLUMN_FRACTION
  if (dayColumnFraction <= 0 || dayColumnFraction >= 1) {
    errors.push('La larghezza della colonna dei giorni deve stare fra 0 e 1 esclusi')
  }

  const left = frazione(form, 'areaLeft') ?? 0
  const top = frazione(form, 'areaTop') ?? 0
  const right = frazione(form, 'areaRight') ?? 1
  const bottom = frazione(form, 'areaBottom') ?? 1
  const dentro = (value: number) => value >= 0 && value <= 1
  if (![left, top, right, bottom].every(dentro) || right <= left || bottom <= top) {
    errors.push("L'area della tabella deve stare fra 0 e 1, con destra e basso maggiori")
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      year: year as number,
      month: month as number,
      ward,
      columnCount: columnCount as number,
      columnsPerBand,
      dayColumnFraction,
      area: { left, top, right, bottom },
    },
  }
}
