import { describe, expect, it } from 'vitest'
import { diffVersions, effectiveCode, type DiffCell } from '@/modules/review/diff'

function cella(day: number, columnLabel: string, code: string | null, over: Partial<DiffCell> = {}): DiffCell {
  return { day, columnLabel, code, ...over }
}

describe('effectiveCode — il codice che conta su una cella', () => {
  it('senza correzione è la lettura del modello', () => {
    expect(effectiveCode(cella(1, 'MERY', 'M'))).toBe('M')
  })

  it('con una correzione a mano vince la correzione', () => {
    expect(effectiveCode(cella(1, 'MERY', 'M', { correctedCode: 'P', correctedAt: new Date() }))).toBe('P')
  })

  it('correzione a mano con codice null vuol dire «il foglio qui è vuoto»', () => {
    expect(effectiveCode(cella(1, 'MERY', 'M', { correctedCode: null, correctedAt: new Date() }))).toBeNull()
  })
})

describe('diffVersions — cosa è cambiato fra due foto dello stesso mese', () => {
  it('celle uguali non compaiono', () => {
    const prima = [cella(1, 'MERY', 'M'), cella(2, 'MERY', 'P')]
    const dopo = [cella(1, 'MERY', 'M'), cella(2, 'MERY', 'P')]
    expect(diffVersions(prima, dopo)).toEqual([])
  })

  it('un codice diverso è «changed», con prima e dopo', () => {
    expect(diffVersions([cella(5, 'MERY', 'M')], [cella(5, 'MERY', 'P')])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 5, kind: 'changed', before: 'M', after: 'P' },
    ])
  })

  it('una cella che prima non c era, o era vuota, è «added»', () => {
    expect(diffVersions([], [cella(12, 'MERY', 'M')])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 12, kind: 'added', before: null, after: 'M' },
    ])
    expect(diffVersions([cella(12, 'MERY', null)], [cella(12, 'MERY', 'M')])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 12, kind: 'added', before: null, after: 'M' },
    ])
  })

  it('una cella che c era e ora manca, o è vuota, è «removed»', () => {
    expect(diffVersions([cella(20, 'MERY', 'M')], [])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 20, kind: 'removed', before: 'M', after: null },
    ])
  })

  it('confronta il codice effettivo: una correzione a mano sulla vecchia versione conta come il suo valore', () => {
    // La referente aveva corretto M → P sulla foto vecchia; la nuova legge P: nessun cambiamento.
    const prima = [cella(3, 'MERY', 'M', { correctedCode: 'P', correctedAt: new Date() })]
    const dopo = [cella(3, 'MERY', 'P')]
    expect(diffVersions(prima, dopo)).toEqual([])
  })

  it('una cella svuotata a mano sulla vecchia versione è vuota: se la nuova legge M è «added»', () => {
    const prima = [cella(3, 'MERY', 'M', { correctedCode: null, correctedAt: new Date() })]
    const dopo = [cella(3, 'MERY', 'M')]
    expect(diffVersions(prima, dopo).map((c) => c.kind)).toEqual(['added'])
  })

  it('le forme compatte dello stesso codice sono uguali: "M 2°P" e "M2°P"', () => {
    expect(diffVersions([cella(1, 'MERY', 'M 2°P')], [cella(1, 'MERY', 'M2°P')])).toEqual([])
  })

  it('l identità di colonna è normalizeColumn: "SARA DP." e "SARA DP" sono la stessa colonna', () => {
    expect(diffVersions([cella(1, 'SARA DP.', 'M')], [cella(1, 'SARA DP', 'M')])).toEqual([])
    expect(diffVersions([cella(1, 'SARA DP.', 'M')], [cella(1, 'SARA DP', 'P')])[0]).toMatchObject({
      columnLabel: 'SARA DP',
      columnKey: 'SARADP',
    })
  })

  it('le colonne di servizio e i totali non compaiono mai', () => {
    const prima = [cella(1, 'AIUTO MATT.', 'ANNA'), cella(1, 'TOT M', '3')]
    const dopo = [cella(1, 'AIUTO MATT.', 'LUCA'), cella(1, 'TOT M', '4')]
    expect(diffVersions(prima, dopo)).toEqual([])
  })

  it('ordina per colonna e poi per giorno', () => {
    const prima = [cella(9, 'MERY', 'M'), cella(2, 'ALEX', 'M'), cella(4, 'MERY', 'M')]
    const dopo = [cella(9, 'MERY', 'P'), cella(2, 'ALEX', 'P'), cella(4, 'MERY', 'P')]
    expect(diffVersions(prima, dopo).map((c) => `${c.columnKey}:${c.day}`)).toEqual([
      'ALEX:2',
      'MERY:4',
      'MERY:9',
    ])
  })
})
