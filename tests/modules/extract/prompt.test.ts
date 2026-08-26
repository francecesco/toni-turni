import { describe, expect, it } from 'vitest'
import { buildExtractionPrompt, buildRepairPrompt } from '@/modules/extract/prompt'

describe('buildExtractionPrompt', () => {
  const prompt = buildExtractionPrompt(['M', 'P', 'NOTTE', 'M1°P'])

  it('elenca i codici noti, così il modello non li inventa', () => {
    for (const code of ['M', 'P', 'NOTTE', 'M1°P']) {
      expect(prompt).toContain(code)
    }
  })

  it('descrive tutti i campi che lo schema pretende', () => {
    for (const field of ['year', 'month', 'ward', 'columns', 'cells', 'day', 'column', 'code', 'confidence', 'handCorrected']) {
      expect(prompt).toContain(field)
    }
  })

  it('chiede esplicitamente di segnalare le correzioni a penna', () => {
    expect(prompt).toMatch(/penna|corretto|correttore/i)
  })

  it('chiede di non inventare celle illeggibili', () => {
    expect(prompt).toMatch(/confidenza bassa|non inventare|illeggibil/i)
  })

  it('dice di ignorare le colonne di aiuto e i totali', () => {
    expect(prompt).toMatch(/AIUTO/)
    expect(prompt).toMatch(/TOT/)
  })

  it('non contiene istruzioni contraddittorie sul formato', () => {
    expect(prompt).toMatch(/solo JSON|soltanto JSON|esclusivamente JSON/i)
  })

  it('funziona anche senza codici noti', () => {
    expect(() => buildExtractionPrompt([])).not.toThrow()
    expect(buildExtractionPrompt([])).toContain('cells')
  })
})

describe('buildRepairPrompt', () => {
  it('include l output precedente e l errore da correggere', () => {
    const prompt = buildRepairPrompt('{"year": 2026}', 'cells: campo obbligatorio')
    expect(prompt).toContain('{"year": 2026}')
    expect(prompt).toContain('cells: campo obbligatorio')
  })

  it('tronca un output precedente enorme invece di rimandarlo tutto', () => {
    const enorme = 'x'.repeat(20_000)
    const prompt = buildRepairPrompt(enorme, 'errore')
    expect(prompt.length).toBeLessThan(10_000)
  })
})
