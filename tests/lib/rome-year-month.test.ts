import { describe, expect, it } from 'vitest'
import { romeYearMonth } from '@/lib/time'

describe('romeYearMonth', () => {
  it('legge il mese sul calendario di Roma, non su quello UTC', () => {
    // 23:30 UTC del 31 agosto: a Roma è già il primo settembre (ora legale, +02:00).
    // Con `new Date().getMonth()` l app atterrerebbe su agosto per un ora al mese,
    // che è il tipo di guasto che nessuno riproduce.
    expect(romeYearMonth(new Date('2026-08-31T23:30:00Z'))).toEqual({ year: 2026, month: 9 })
  })

  it('vale anche in ora solare, dove l offset è di un ora sola', () => {
    expect(romeYearMonth(new Date('2026-01-31T23:30:00Z'))).toEqual({ year: 2026, month: 2 })
  })

  it('non anticipa il mese quando a Roma non è ancora cambiato', () => {
    expect(romeYearMonth(new Date('2026-08-31T20:00:00Z'))).toEqual({ year: 2026, month: 8 })
  })

  it('cambia anche l anno a cavallo di capodanno', () => {
    expect(romeYearMonth(new Date('2025-12-31T23:30:00Z'))).toEqual({ year: 2026, month: 1 })
  })
})
