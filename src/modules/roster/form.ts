/**
 * Validazione del modulo di caricamento. Logica pura, testabile senza HTTP: la
 * route la usa e si limita a rimandare i messaggi alla referente.
 *
 * Si chiedono soltanto le tre cose che una foto **non** dice: anno, mese e
 * reparto. La geometria della tabella — dove sta il riquadro, quante colonne ha,
 * quanto è larga la colonna dei giorni — non si chiede a nessuno: la rileva
 * `cropRosterBands` sulla foto. Chiederla era il modo di sbagliarla, perché
 * frazioni fisse non trasferiscono da una foto all altra.
 */

export interface UploadValues {
  year: number
  month: number
  ward: string
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

  if (errors.length > 0) return { ok: false, errors }

  return { ok: true, value: { year: year as number, month: month as number, ward } }
}
