import { describe, expect, it } from 'vitest'
import {
  landingRoster,
  monthPickerEntries,
  type LandingCandidate,
} from '@/modules/review/landing'

const OGGI = { year: 2026, month: 8 }

function tabella(
  id: string,
  year: number,
  month: number,
  version = 1,
): LandingCandidate {
  return { id, year, month, version }
}

describe('landingRoster', () => {
  it('sceglie la tabella del mese corrente', () => {
    const scelta = landingRoster(
      [tabella('lug', 2026, 7), tabella('ago', 2026, 8), tabella('giu', 2026, 6)],
      OGGI,
    )
    expect(scelta?.id).toBe('ago')
  })

  it('a parità di mese sceglie la versione più alta', () => {
    // `nextVersion` esiste già nel modulo roster, quindi due righe per lo stesso
    // mese sono un caso reale: atterrare sulla versione 1 quando esiste la 2
    // mostrerebbe turni superati senza dirlo.
    const scelta = landingRoster(
      [tabella('v1', 2026, 8, 1), tabella('v3', 2026, 8, 3), tabella('v2', 2026, 8, 2)],
      OGGI,
    )
    expect(scelta?.id).toBe('v3')
  })

  it('non si fida dell ordine in cui arrivano i candidati', () => {
    const scelta = landingRoster(
      [tabella('v2', 2026, 8, 2), tabella('v3', 2026, 8, 3), tabella('v1', 2026, 8, 1)],
      OGGI,
    )
    expect(scelta?.id).toBe('v3')
  })

  it('se il mese corrente non c è, prende la più recente', () => {
    // A inizio mese, prima che la referente carichi la foto: i turni di ieri sono
    // ancora informazione, quindi si mostra il mese scorso invece di niente.
    const scelta = landingRoster([tabella('giu', 2026, 6), tabella('lug', 2026, 7)], OGGI)
    expect(scelta?.id).toBe('lug')
  })

  it('confronta l anno prima del mese', () => {
    const scelta = landingRoster([tabella('dic', 2025, 12), tabella('gen', 2026, 1)], OGGI)
    expect(scelta?.id).toBe('gen')
  })

  it('della più recente prende comunque la versione più alta', () => {
    const scelta = landingRoster(
      [tabella('lug-v1', 2026, 7, 1), tabella('lug-v2', 2026, 7, 2)],
      OGGI,
    )
    expect(scelta?.id).toBe('lug-v2')
  })

  it('senza tabelle restituisce null, non solleva', () => {
    expect(landingRoster([], OGGI)).toBeNull()
  })
})

describe('monthPickerEntries', () => {
  it('dà una voce per mese, anche con tre versioni', () => {
    // Una tendina con «agosto 2026» tre volte non aiuta nessuno.
    const voci = monthPickerEntries(
      [tabella('v1', 2026, 8, 1), tabella('v2', 2026, 8, 2), tabella('v3', 2026, 8, 3)],
      OGGI,
    )
    expect(voci).toHaveLength(1)
    expect(voci[0].id).toBe('v3')
  })

  it('ordina dal più recente', () => {
    const voci = monthPickerEntries(
      [tabella('giu', 2026, 6), tabella('ago', 2026, 8), tabella('lug', 2026, 7)],
      OGGI,
    )
    expect(voci.map((v) => v.month)).toEqual([8, 7, 6])
  })

  it('marca il mese di oggi', () => {
    const voci = monthPickerEntries([tabella('ago', 2026, 8), tabella('lug', 2026, 7)], OGGI)
    expect(voci.map((v) => v.current)).toEqual([true, false])
  })

  it('non marca niente se il mese di oggi non c è', () => {
    // `current` dice qual è il mese corrente, non su quale tabella si è atterrati.
    const voci = monthPickerEntries([tabella('lug', 2026, 7), tabella('giu', 2026, 6)], OGGI)
    expect(voci.every((v) => !v.current)).toBe(true)
  })

  it('senza tabelle dà un elenco vuoto', () => {
    expect(monthPickerEntries([], OGGI)).toEqual([])
  })
})
