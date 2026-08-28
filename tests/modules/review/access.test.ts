import { describe, expect, it } from 'vitest'
import { canSeeColumn, visibleColumns } from '@/modules/review/access'

const referente = { id: 'u-ref', role: 'REFERENTE' as const }
const cristina = { id: 'u-cri', role: 'NURSE' as const }
const sara = { id: 'u-sara', role: 'NURSE' as const }

/**
 * L identità di una colonna e il riconoscimento delle colonne di servizio non
 * vivono più qui: sono `normalizeColumn` e `isColonnaDiServizio` di
 * `@/modules/extract`, gli stessi che usa la fusione delle bande, e hanno i loro
 * test in `tests/modules/extract/`. Qui si verifica che questo modulo **usi
 * quelli**: una seconda nozione teneva la punteggiatura, e con quella `SARA DP.`
 * e `SARA DP` erano due colonne diverse.
 */
describe('le colonne di servizio si riconoscono con l unico elenco del progetto', () => {
  it('una colonna di aiuto o di totale non è di nessuno e non compare', () => {
    for (const servizio of ['AIUTO MATT.', 'aiuto pom.', 'TOT M', 'TOT P']) {
      expect(visibleColumns(referente, [servizio], [])).toEqual([])
    }
  })

  it('il nome di una persona resta, anche quando somiglia a una colonna di totale', () => {
    // "TOTINI" è un cognome plausibile: non si scarta per prefisso.
    for (const nome of ['CRISTINA', 'SARA DP.', 'TOTINI']) {
      expect(visibleColumns(referente, [nome], [])).toEqual([nome])
    }
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

  it('il confronto passa dalla forma normalizzata: le maiuscole non nascondono una colonna', () => {
    expect(visibleColumns(cristina, ['cristina'], aliases)).toEqual(['cristina'])
  })

  it('la punteggiatura non spacca la stessa infermiera in due colonne', () => {
    // `SARA DP.` in una banda e `SARA DP` nell altra sono la stessa persona: con
    // la nozione precedente erano due colonne da mezzo mese ciascuna.
    expect(visibleColumns(sara, ['SARA DP'], aliases)).toEqual(['SARA DP'])
    expect(visibleColumns(sara, ['SARA  DP.'], aliases)).toEqual(['SARA  DP.'])
  })
})
