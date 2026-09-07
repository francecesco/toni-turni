import { describe, expect, it } from 'vitest'
import {
  diffVersions,
  effectiveCode,
  filterChangesByCoverage,
  type DiffCell,
  type VersionChange,
} from '@/modules/review/diff'

function cella(day: number, columnLabel: string, code: string | null, over: Partial<DiffCell> = {}): DiffCell {
  return { day, columnLabel, rawCode: code ?? '', code, ...over }
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

  it('un codice sconosciuto vale il grezzo, non il vuoto: il modello ha letto qualcosa', () => {
    // `code` null con un grezzo scritto è «letto ma non in legenda» (`M h13`), che è
    // diversissimo da «qui non c è niente».
    expect(effectiveCode(cella(1, 'MERY', null, { rawCode: 'M h13' }))).toBe('M h13')
  })

  it('un grezzo di soli spazi è vuoto davvero', () => {
    expect(effectiveCode(cella(1, 'MERY', null, { rawCode: '   ' }))).toBeNull()
  })

  it('la correzione a mano vince anche sul grezzo di un codice sconosciuto', () => {
    expect(
      effectiveCode(cella(1, 'MERY', null, { rawCode: 'M h13', correctedCode: 'M', correctedAt: new Date() })),
    ).toBe('M')
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

  it('un codice sconosciuto non è una cella vuota: si confronta col grezzo', () => {
    // Il foglio nuovo dice `M h13` (orario a penna): il modello non lo trova in
    // legenda e lascia `code` null. Dichiararlo «tolto» direbbe all infermiera che
    // quel giorno non ha turno, quando invece ne ha uno da rileggere.
    const prima = [cella(4, 'MERY', 'M')]
    const dopo = [cella(4, 'MERY', null, { rawCode: 'M h13' })]
    expect(diffVersions(prima, dopo)).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 4, kind: 'changed', before: 'M', after: 'M h13' },
    ])
  })

  it('due grezzi sconosciuti uguali non sono un cambiamento', () => {
    const prima = [cella(4, 'MERY', null, { rawCode: 'M h13' })]
    const dopo = [cella(4, 'MERY', null, { rawCode: 'M h13' })]
    expect(diffVersions(prima, dopo)).toEqual([])
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

describe('filterChangesByCoverage — una lettura parziale non dichiara più di quello che sa', () => {
  const cambiato: VersionChange = { columnLabel: 'MERY', columnKey: 'MERY', day: 5, kind: 'changed', before: 'M', after: 'P' }
  const nuovo: VersionChange = { columnLabel: 'MERY', columnKey: 'MERY', day: 6, kind: 'added', before: null, after: 'M' }
  const tolto: VersionChange = { columnLabel: 'MERY', columnKey: 'MERY', day: 7, kind: 'removed', before: 'M', after: null }
  const tutti = [cambiato, nuovo, tolto]

  it('con entrambe le letture complete non toglie niente', () => {
    expect(filterChangesByCoverage(tutti, { previousFullyRead: true, currentFullyRead: true })).toEqual(tutti)
  })

  it('se la corrente è parziale toglie i «tolti»: quel giorno può essere solo non letto', () => {
    expect(filterChangesByCoverage(tutti, { previousFullyRead: true, currentFullyRead: false })).toEqual([
      cambiato,
      nuovo,
    ])
  })

  it('se la precedente è parziale toglie i «nuovi»: quel turno poteva esserci già', () => {
    expect(filterChangesByCoverage(tutti, { previousFullyRead: false, currentFullyRead: true })).toEqual([
      cambiato,
      tolto,
    ])
  })

  it('con entrambe parziali resta solo quello che si è visto due volte', () => {
    expect(filterChangesByCoverage(tutti, { previousFullyRead: false, currentFullyRead: false })).toEqual([cambiato])
  })
})
