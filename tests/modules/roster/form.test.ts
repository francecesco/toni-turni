import { describe, expect, it } from 'vitest'
import { parseUploadForm } from '@/modules/roster/form'

function modulo(overrides: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('year', '2026')
  form.set('month', '8')
  form.set('ward', '3°PIANO')
  form.set('columnCount', '14')
  for (const [key, value] of Object.entries(overrides)) form.set(key, value)
  return form
}

describe('parseUploadForm', () => {
  it('accetta il minimo indispensabile e riempie la geometria con i valori di default', () => {
    const parsed = parseUploadForm(modulo())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual({
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      columnCount: 14,
      columnsPerBand: 1,
      dayColumnFraction: 0.1,
      area: { left: 0, top: 0, right: 1, bottom: 1 },
    })
  })

  it('accetta la virgola come separatore decimale: sulla tastiera italiana è quella', () => {
    const parsed = parseUploadForm(modulo({ dayColumnFraction: '0,15' }))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.dayColumnFraction).toBeCloseTo(0.15)
  })

  it('rifiuta un mese fuori intervallo', () => {
    const parsed = parseUploadForm(modulo({ month: '13' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/mese/i)
  })

  it('rifiuta un reparto vuoto', () => {
    const parsed = parseUploadForm(modulo({ ward: '  ' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/reparto/i)
  })

  it('rifiuta zero colonne: la geometria delle bande non si indovina', () => {
    const parsed = parseUploadForm(modulo({ columnCount: '0' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/colonne/i)
  })

  it('rifiuta una colonna dei giorni larga quanto tutta la tabella', () => {
    const parsed = parseUploadForm(modulo({ dayColumnFraction: '1' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/colonna dei giorni/i)
  })

  it("rifiuta un'area rovesciata", () => {
    const parsed = parseUploadForm(modulo({ areaLeft: '0.8', areaRight: '0.2' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/area/i)
  })

  it('elenca tutti gli errori insieme, non solo il primo', () => {
    const parsed = parseUploadForm(modulo({ month: '0', ward: '', columnCount: '99' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors).toHaveLength(3)
  })
})
