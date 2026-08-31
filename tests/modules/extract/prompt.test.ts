import { describe, expect, it } from 'vitest'
import { buildRepairPrompt } from '@/modules/extract/prompt'

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
