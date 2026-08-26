import { describe, expect, it } from 'vitest'
import { parseExtraction } from '@/modules/extract/schema'

const valida = {
  year: 2026,
  month: 8,
  ward: '3°PIANO',
  columns: ['RENATA', 'KHADIJA'],
  cells: [
    { day: 1, column: 'RENATA', code: 'M', confidence: 0.98, handCorrected: false },
    { day: 1, column: 'KHADIJA', code: 'F', confidence: 0.4, handCorrected: true },
  ],
}

describe('parseExtraction', () => {
  it('accetta un output valido', () => {
    const result = parseExtraction(JSON.stringify(valida))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.month).toBe(8)
      expect(result.value.cells).toHaveLength(2)
    }
  })

  it('estrae il JSON anche se il modello lo circonda di testo e di recinti markdown', () => {
    const raw = 'Ecco la tabella:\n```json\n' + JSON.stringify(valida) + '\n```\nSpero sia utile!'
    const result = parseExtraction(raw)
    expect(result.ok).toBe(true)
  })

  it('rifiuta un testo senza JSON', () => {
    const result = parseExtraction('non ho capito la richiesta')
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/JSON/i) })
  })

  it('rifiuta un JSON sintatticamente rotto', () => {
    const result = parseExtraction('{"year": 2026, "month":}')
    expect(result.ok).toBe(false)
  })

  it('rifiuta un mese fuori intervallo', () => {
    const result = parseExtraction(JSON.stringify({ ...valida, month: 13 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/month/)
  })

  it('rifiuta un giorno fuori intervallo', () => {
    const cells = [{ day: 32, column: 'RENATA', code: 'M', confidence: 1, handCorrected: false }]
    expect(parseExtraction(JSON.stringify({ ...valida, cells })).ok).toBe(false)
  })

  it('rifiuta una confidenza fuori da 0..1', () => {
    const cells = [{ day: 1, column: 'RENATA', code: 'M', confidence: 42, handCorrected: false }]
    expect(parseExtraction(JSON.stringify({ ...valida, cells })).ok).toBe(false)
  })

  it('rifiuta una cella la cui colonna non è fra quelle dichiarate', () => {
    const cells = [{ day: 1, column: 'SCONOSCIUTA', code: 'M', confidence: 1, handCorrected: false }]
    const result = parseExtraction(JSON.stringify({ ...valida, cells }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/SCONOSCIUTA/)
  })

  it('accetta una cella vuota come stringa vuota', () => {
    const cells = [{ day: 1, column: 'RENATA', code: '', confidence: 0.9, handCorrected: false }]
    expect(parseExtraction(JSON.stringify({ ...valida, cells })).ok).toBe(true)
  })

  it('rifiuta due celle per lo stesso giorno e la stessa colonna', () => {
    const cells = [
      { day: 1, column: 'RENATA', code: 'M', confidence: 1, handCorrected: false },
      { day: 1, column: 'RENATA', code: 'P', confidence: 1, handCorrected: false },
    ]
    const result = parseExtraction(JSON.stringify({ ...valida, cells }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/duplicat/i)
  })

  it('rifiuta un elenco di colonne vuoto', () => {
    expect(parseExtraction(JSON.stringify({ ...valida, columns: [], cells: [] })).ok).toBe(false)
  })
})
