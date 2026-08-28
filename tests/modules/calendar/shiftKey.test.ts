import { describe, expect, it } from 'vitest'
import { belongsTo, parseShiftKey, shiftKeyFor } from '@/modules/calendar/shiftKey'

describe('shiftKeyFor', () => {
  it('compone la chiave come "<userId>:<YYYY-MM-DD>"', () => {
    expect(shiftKeyFor('utente1', '2026-08-01')).toBe('utente1:2026-08-01')
  })

  it('rifiuta una data che non è nel formato YYYY-MM-DD', () => {
    expect(() => shiftKeyFor('utente1', '1/8/2026')).toThrow()
  })

  it('rifiuta un userId vuoto o con i due punti, che romperebbe il parsing', () => {
    expect(() => shiftKeyFor('', '2026-08-01')).toThrow()
    expect(() => shiftKeyFor('uten:te', '2026-08-01')).toThrow()
  })
})

describe('parseShiftKey', () => {
  it('rilegge utente e data', () => {
    expect(parseShiftKey('utente1:2026-08-01')).toEqual({ userId: 'utente1', date: '2026-08-01' })
  })

  it('restituisce null su una chiave non riconoscibile', () => {
    // Se la chiave non è nostra e riconoscibile, l evento non va toccato in nessun caso.
    expect(parseShiftKey('')).toBeNull()
    expect(parseShiftKey('utente1')).toBeNull()
    expect(parseShiftKey('utente1:2026-8-1')).toBeNull()
    expect(parseShiftKey(':2026-08-01')).toBeNull()
    expect(parseShiftKey('utente1:2026-08-01:extra')).toBeNull()
  })

  it('non accetta una data sintatticamente giusta ma inesistente', () => {
    expect(parseShiftKey('utente1:2026-02-30')).toBeNull()
  })
})

describe('belongsTo', () => {
  it('riconosce la chiave dell utente indicato', () => {
    expect(belongsTo('utente1:2026-08-01', 'utente1')).toBe(true)
  })

  it('nega la chiave di un altro utente', () => {
    expect(belongsTo('utente2:2026-08-01', 'utente1')).toBe(false)
  })

  it('nega una chiave assente: un evento senza shiftKey non è nostro', () => {
    expect(belongsTo(undefined, 'utente1')).toBe(false)
    expect(belongsTo(null, 'utente1')).toBe(false)
    expect(belongsTo('', 'utente1')).toBe(false)
  })

  it('nega un prefisso che somiglia ma non coincide', () => {
    expect(belongsTo('utente10:2026-08-01', 'utente1')).toBe(false)
  })
})
