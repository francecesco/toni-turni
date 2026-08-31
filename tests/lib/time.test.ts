import { describe, expect, it } from 'vitest'
import {
  addDays,
  elencoGiorni,
  hoursBetween,
  monthLabel,
  ROME_TZ,
  wallClockToUtc,
  zoneOffsetMinutes,
} from '@/lib/time'

describe('monthLabel', () => {
  it('scrive il mese in italiano, 1-based come sulla carta', () => {
    expect(monthLabel(2026, 8)).toBe('agosto 2026')
    expect(monthLabel(2026, 1)).toBe('gennaio 2026')
    expect(monthLabel(2026, 12)).toBe('dicembre 2026')
  })

  it('non inventa un nome per un mese impossibile', () => {
    expect(monthLabel(2026, 13)).toBe('mese 13 2026')
  })
})

describe('addDays', () => {
  it('avanza di un giorno dentro il mese', () => {
    expect(addDays('2026-08-01', 1)).toBe('2026-08-02')
  })

  it('attraversa il confine del mese', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('attraversa il confine dell anno', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('non è disturbato dal cambio di ora legale', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
  })

  it('torna indietro con giorni negativi', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
  })
})

describe('zoneOffsetMinutes', () => {
  it('riconosce l ora solare a Roma (+1)', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), ROME_TZ)).toBe(60)
  })

  it('riconosce l ora legale a Roma (+2)', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), ROME_TZ)).toBe(120)
  })
})

describe('wallClockToUtc', () => {
  it('converte un mattino d inverno', () => {
    expect(wallClockToUtc('2026-01-15T07:00', ROME_TZ).toISOString()).toBe('2026-01-15T06:00:00.000Z')
  })

  it('converte un mattino d estate', () => {
    expect(wallClockToUtc('2026-08-01T07:00', ROME_TZ).toISOString()).toBe('2026-08-01T05:00:00.000Z')
  })

  it('la notte in cui finisce l ora legale dura 11 ore', () => {
    // 25 ottobre 2026: alle 03:00 le lancette tornano a 02:00
    const start = wallClockToUtc('2026-10-24T21:00', ROME_TZ)
    const end = wallClockToUtc('2026-10-25T07:00', ROME_TZ)
    expect(hoursBetween(start, end)).toBe(11)
  })

  it('la notte in cui inizia l ora legale dura 9 ore', () => {
    // 29 marzo 2026: alle 02:00 le lancette vanno a 03:00
    const start = wallClockToUtc('2026-03-28T21:00', ROME_TZ)
    const end = wallClockToUtc('2026-03-29T07:00', ROME_TZ)
    expect(hoursBetween(start, end)).toBe(9)
  })

  it('una notte normale dura 10 ore', () => {
    const start = wallClockToUtc('2026-08-10T21:00', ROME_TZ)
    const end = wallClockToUtc('2026-08-11T07:00', ROME_TZ)
    expect(hoursBetween(start, end)).toBe(10)
  })

  it('accetta anche i secondi nel wall clock', () => {
    expect(wallClockToUtc('2026-08-01T07:00:00', ROME_TZ).toISOString()).toBe(
      '2026-08-01T05:00:00.000Z',
    )
  })

  it('corregge l offset quando la prima stima cade dal lato sbagliato del cambio d ora', () => {
    // 01:30 del 25 ottobre 2026 a Roma esiste due volte: la prima occorrenza è ancora
    // ora legale (+2). Con un solo passaggio l offset stimato sarebbe +1 e il risultato
    // cadrebbe sulla seconda occorrenza, un ora più tardi.
    expect(wallClockToUtc('2026-10-25T01:30', ROME_TZ).toISOString()).toBe(
      '2026-10-24T23:30:00.000Z',
    )
  })

  it('gestisce un orario che il cambio d ora fa saltare del tutto', () => {
    // 02:30 del 29 marzo 2026 non esiste a Roma: le lancette vanno da 02:00 a 03:00.
    // Il secondo passaggio lo porta a 03:30 locali; con un solo passaggio finirebbe a 01:30.
    expect(wallClockToUtc('2026-03-29T02:30', ROME_TZ).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    )
  })
})

describe('elencoGiorni', () => {
  it('elenca tutti i giorni fino a otto', () => {
    expect(elencoGiorni([1, 2, 3])).toBe('1, 2, 3')
    expect(elencoGiorni([1, 2, 3, 4, 5, 6, 7, 8])).toBe('1, 2, 3, 4, 5, 6, 7, 8')
  })

  it('oltre otto giorni tronca e riassume il resto', () => {
    // È il difetto vero: 14 giorni per esteso rendono una pastiglia più larga
    // della scheda che la contiene, e la pagina scorre in orizzontale.
    const quattordici = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    expect(elencoGiorni(quattordici)).toBe('1, 2, 3, 4, 5, 6, 7, 8 e altri 6')
  })

  it('un elenco vuoto dà una stringa vuota', () => {
    expect(elencoGiorni([])).toBe('')
  })
})
