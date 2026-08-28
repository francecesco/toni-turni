import { describe, expect, it } from 'vitest'
import {
  canSeeColumn,
  isNonNurseLabel,
  normalizeLabel,
  visibleColumns,
} from '@/modules/review/access'

const referente = { id: 'u-ref', role: 'REFERENTE' as const }
const cristina = { id: 'u-cri', role: 'NURSE' as const }
const sara = { id: 'u-sara', role: 'NURSE' as const }

describe('normalizeLabel — una sola nozione di identità della colonna', () => {
  it('porta in maiuscolo e compatta gli spazi', () => {
    expect(normalizeLabel(' sara  dp. ')).toBe('SARA DP.')
  })
})

describe('isNonNurseLabel — le colonne che non sono turni di nessuno', () => {
  it('riconosce le colonne di aiuto e dei totali', () => {
    expect(isNonNurseLabel('AIUTO MATT.')).toBe(true)
    expect(isNonNurseLabel('aiuto pom.')).toBe(true)
    expect(isNonNurseLabel('TOT M')).toBe(true)
    expect(isNonNurseLabel('TOT P')).toBe(true)
  })

  it('non scarta il nome di una persona', () => {
    expect(isNonNurseLabel('CRISTINA')).toBe(false)
    expect(isNonNurseLabel('SARA DP.')).toBe(false)
    // "TOTINI" è un cognome plausibile: il riconoscimento è per parola intera.
    expect(isNonNurseLabel('TOTINI')).toBe(false)
  })
})

describe('canSeeColumn — ogni infermiera vede solo la propria colonna', () => {
  it('la referente vede qualunque colonna, anche non associata', () => {
    expect(canSeeColumn(referente, { label: 'CRISTINA', userId: 'u-cri', ignored: false })).toBe(true)
    expect(canSeeColumn(referente, null)).toBe(true)
  })

  it("un'infermiera vede la colonna associata a lei", () => {
    expect(canSeeColumn(cristina, { label: 'CRISTINA', userId: 'u-cri', ignored: false })).toBe(true)
  })

  it("un'infermiera NON vede la colonna di un'altra", () => {
    expect(canSeeColumn(sara, { label: 'CRISTINA', userId: 'u-cri', ignored: false })).toBe(false)
  })

  it("un'infermiera non vede una colonna non ancora associata a nessuno", () => {
    expect(canSeeColumn(cristina, null)).toBe(false)
    expect(canSeeColumn(cristina, { label: 'NUOVA', userId: null, ignored: false })).toBe(false)
  })

  it("un'infermiera non vede una colonna ignorata, anche se il suo id vi finisse per errore", () => {
    expect(canSeeColumn(cristina, { label: 'TOT M', userId: 'u-cri', ignored: true })).toBe(false)
  })
})

describe('visibleColumns — cosa mostrare in elenco', () => {
  const aliases = [
    { label: 'CRISTINA', userId: 'u-cri', ignored: false },
    { label: 'SARA DP.', userId: 'u-sara', ignored: false },
    { label: 'TOT M', userId: null, ignored: true },
  ]
  const colonne = ['CRISTINA', 'SARA DP.', 'NUOVA', 'TOT M']

  it('la referente vede tutte le colonne che non sono ignorate', () => {
    expect(visibleColumns(referente, colonne, aliases)).toEqual(['CRISTINA', 'SARA DP.', 'NUOVA'])
  })

  it("un'infermiera vede soltanto la propria", () => {
    expect(visibleColumns(cristina, colonne, aliases)).toEqual(['CRISTINA'])
  })

  it("un'infermiera senza colonna associata non vede nulla", () => {
    expect(visibleColumns({ id: 'u-ignota', role: 'NURSE' }, colonne, aliases)).toEqual([])
  })

  it('il confronto passa dalla forma normalizzata: uno spazio doppio non nasconde una colonna', () => {
    expect(visibleColumns(cristina, ['cristina'], aliases)).toEqual(['cristina'])
  })
})
