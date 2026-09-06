import { describe, expect, it } from 'vitest'
import { calendarBadge, calendarCounts } from '@/modules/review/calendar-status'

/**
 * Gli indicatori «gia sul calendario» dell elenco dei mesi. Logica pura: i conteggi
 * vengono dalle assegnazioni confermate della persona, il badge dai conteggi.
 */
describe('calendarCounts', () => {
  it('raggruppa per tabella i turni confermati, quelli sul calendario e gli invii falliti', () => {
    const conteggi = calendarCounts([
      { rosterId: 'a', syncState: 'synced' },
      { rosterId: 'a', syncState: 'synced' },
      { rosterId: 'a', syncState: 'confirmed' },
      { rosterId: 'b', syncState: 'failed' },
    ])

    expect(conteggi.get('a')).toEqual({ confirmed: 3, synced: 2, failed: 0 })
    expect(conteggi.get('b')).toEqual({ confirmed: 1, synced: 0, failed: 1 })
    expect(conteggi.get('c')).toBeUndefined()
  })
})

describe('calendarBadge', () => {
  it('senza turni confermati non dice niente: non c e ancora nulla da mandare', () => {
    expect(calendarBadge(undefined)).toBeNull()
    expect(calendarBadge({ confirmed: 0, synced: 0, failed: 0 })).toBeNull()
  })

  it('quando tutti i confermati sono sul calendario lo dice', () => {
    expect(calendarBadge({ confirmed: 5, synced: 5, failed: 0 })).toEqual({
      text: 'sul calendario',
      variant: 'default',
    })
  })

  it('quando ne mancano dice quanti sono da mandare', () => {
    expect(calendarBadge({ confirmed: 5, synced: 3, failed: 0 })).toEqual({
      text: '2 da mandare',
      variant: 'secondary',
    })
    expect(calendarBadge({ confirmed: 1, synced: 0, failed: 0 })).toEqual({
      text: '1 da mandare',
      variant: 'secondary',
    })
  })

  it('un invio fallito vince su tutto il resto: e quello da guardare', () => {
    expect(calendarBadge({ confirmed: 5, synced: 4, failed: 1 })).toEqual({
      text: '1 invio non riuscito',
      variant: 'destructive',
    })
    expect(calendarBadge({ confirmed: 5, synced: 3, failed: 2 })?.text).toBe('2 invii non riusciti')
  })
})
