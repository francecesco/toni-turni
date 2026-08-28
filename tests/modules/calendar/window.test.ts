import { describe, expect, it } from 'vitest'
import { isoDateFor, monthWindow } from '@/modules/calendar/window'

describe('isoDateFor', () => {
  it('compone la data locale del giorno di tabella', () => {
    expect(isoDateFor(2026, 8, 1)).toBe('2026-08-01')
    expect(isoDateFor(2026, 12, 31)).toBe('2026-12-31')
  })

  it('restituisce la data così com è anche quando il giorno non esiste', () => {
    // La tabella può avere una riga 31 in un mese di 30 giorni: la scartano i
    // livelli successivi, qui non si inventa un 1° ottobre.
    expect(isoDateFor(2026, 9, 31)).toBe('2026-09-31')
  })
})

describe('monthWindow', () => {
  it('delimita il mese con le date locali del primo e dell ultimo giorno', () => {
    const finestra = monthWindow(2026, 8)
    expect(finestra.from).toBe('2026-08-01')
    expect(finestra.to).toBe('2026-08-31')
  })

  it('conosce la lunghezza dei mesi e gli anni bisestili', () => {
    expect(monthWindow(2026, 2).to).toBe('2026-02-28')
    expect(monthWindow(2028, 2).to).toBe('2028-02-29')
    expect(monthWindow(2026, 4).to).toBe('2026-04-30')
  })

  it('gli estremi per Google sono istanti UTC calcolati sull ora legale del momento', () => {
    // Agosto: Roma è a +02:00, quindi la mezzanotte locale del 1° è il 31 luglio alle 22:00Z.
    const agosto = monthWindow(2026, 8)
    expect(agosto.timeMin).toBe('2026-07-31T22:00:00.000Z')
    expect(agosto.timeMax).toBe('2026-08-31T22:00:00.000Z')

    // Gennaio: Roma è a +01:00.
    const gennaio = monthWindow(2026, 1)
    expect(gennaio.timeMin).toBe('2025-12-31T23:00:00.000Z')
    expect(gennaio.timeMax).toBe('2026-01-31T23:00:00.000Z')
  })

  it('il mese del cambio d ora ha i due estremi con offset diversi', () => {
    // Marzo 2026: inizia a +01:00 e finisce a +02:00.
    const marzo = monthWindow(2026, 3)
    expect(marzo.timeMin).toBe('2026-02-28T23:00:00.000Z')
    expect(marzo.timeMax).toBe('2026-03-31T22:00:00.000Z')

    // Ottobre 2026: inizia a +02:00 e finisce a +01:00.
    const ottobre = monthWindow(2026, 10)
    expect(ottobre.timeMin).toBe('2026-09-30T22:00:00.000Z')
    expect(ottobre.timeMax).toBe('2026-10-31T23:00:00.000Z')
  })

  it('rifiuta un mese fuori scala invece di produrre una finestra sbagliata', () => {
    expect(() => monthWindow(2026, 0)).toThrow()
    expect(() => monthWindow(2026, 13)).toThrow()
  })
})
