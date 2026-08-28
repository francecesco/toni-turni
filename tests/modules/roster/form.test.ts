import { describe, expect, it } from 'vitest'
import { parseUploadForm } from '@/modules/roster/form'

function modulo(overrides: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('year', '2026')
  form.set('month', '8')
  form.set('ward', '3°PIANO')
  for (const [key, value] of Object.entries(overrides)) form.set(key, value)
  return form
}

describe('parseUploadForm', () => {
  it('chiede soltanto le tre cose che la foto non dice', () => {
    const parsed = parseUploadForm(modulo())

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual({ year: 2026, month: 8, ward: '3°PIANO' })
  })

  it('non si fa dettare la geometria dal modulo: la rileva la pipeline sulla foto', () => {
    // Campi rimasti in un segnalibro o in un modulo vecchio non devono tornare a
    // decidere dove tagliare: quelle frazioni non trasferiscono da una foto all altra.
    const parsed = parseUploadForm(
      modulo({ columnCount: '14', dayColumnFraction: '0,15', areaLeft: '0.8', areaRight: '0.2' }),
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual({ year: 2026, month: 8, ward: '3°PIANO' })
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

  it('rifiuta un anno non plausibile', () => {
    const parsed = parseUploadForm(modulo({ year: '1999' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/anno/i)
  })

  it('elenca tutti gli errori insieme, non solo il primo', () => {
    const parsed = parseUploadForm(modulo({ month: '0', ward: '', year: 'x' }))

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors).toHaveLength(3)
  })
})
