import { ROME_TZ, wallClockToUtc } from '@/lib/time'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Data locale del giorno di tabella. Non valida il giorno: una riga "31" in un mese
 * di 30 giorni deve restare visibile come errore, non diventare il 1° del mese dopo.
 */
export function isoDateFor(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export interface MonthWindow {
  /** Prima data locale del mese, YYYY-MM-DD. */
  from: string
  /** Ultima data locale del mese, YYYY-MM-DD. */
  to: string
  /** Istante UTC della mezzanotte locale del primo giorno, per `timeMin` di Google. */
  timeMin: string
  /** Istante UTC della mezzanotte locale del primo giorno del mese dopo, per `timeMax`. */
  timeMax: string
}

/**
 * Finestra del mese in ora locale di Roma. Gli estremi UTC si calcolano con la
 * conversione a due passaggi di `lib/time`, non con un offset fisso: a marzo e a
 * ottobre i due estremi del mese cadono su offset diversi.
 */
export function monthWindow(year: number, month: number): MonthWindow {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Mese non valido: ${month}`)
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Anno non valido: ${year}`)
  }

  const from = isoDateFor(year, month, 1)
  const to = isoDateFor(year, month, daysInMonth(year, month))

  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextFrom = isoDateFor(nextYear, nextMonth, 1)

  return {
    from,
    to,
    timeMin: wallClockToUtc(`${from}T00:00:00`, ROME_TZ).toISOString(),
    timeMax: wallClockToUtc(`${nextFrom}T00:00:00`, ROME_TZ).toISOString(),
  }
}
