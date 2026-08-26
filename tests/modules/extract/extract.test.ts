import { describe, expect, it, vi } from 'vitest'
import { extractRoster } from '@/modules/extract/extract'
import { VisionProviderError, VisionTruncatedError, type VisionProvider } from '@/modules/extract/providers/types'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff])

const VALIDA = JSON.stringify({
  year: 2026,
  month: 8,
  ward: '3°PIANO',
  columns: ['RENATA'],
  cells: [{ day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false }],
})

function provider(name: string, ...risposte: Array<string | Error>): VisionProvider {
  const extract = vi.fn()
  for (const risposta of risposte) {
    if (risposta instanceof Error) extract.mockRejectedValueOnce(risposta)
    else extract.mockResolvedValueOnce({ raw: risposta, model: `${name}-model`, provider: name })
  }
  return { name, extract }
}

describe('extractRoster', () => {
  it('restituisce l estrazione validata al primo tentativo', async () => {
    const result = await extractRoster({
      image: IMAGE,
      knownCodes: ['M'],
      provider: provider('groq', VALIDA),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.extraction.month).toBe(8)
      expect(result.attempts).toBe(1)
      expect(result.provider).toBe('groq')
      expect(result.rawOutput).toBe(VALIDA)
    }
  })

  it('chiede una riparazione quando il primo output non è valido, e riesce', async () => {
    const p = provider('groq', '{"year": 2026}', VALIDA)

    const result = await extractRoster({ image: IMAGE, knownCodes: [], provider: p })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.attempts).toBe(2)
    expect(p.extract).toHaveBeenCalledTimes(2)
  })

  it('nella riparazione manda il prompt di estrazione al primo turno e l istruzione di riparazione una sola volta', async () => {
    const p = provider('groq', 'non è JSON', VALIDA)

    await extractRoster({ image: IMAGE, knownCodes: ['NOTTE'], provider: p })

    const primaChiamata = vi.mocked(p.extract).mock.calls[0][0]
    const secondaChiamata = vi.mocked(p.extract).mock.calls[1][0]

    // Il prompt di estrazione (schema, codici noti, regole) resta lo stesso: non
    // viene sostituito dall istruzione di riparazione.
    expect(primaChiamata.prompt).toContain('NOTTE')
    expect(secondaChiamata.prompt).toBe(primaChiamata.prompt)

    expect(secondaChiamata.previousTurns).toHaveLength(2)
    expect(secondaChiamata.previousTurns?.[0]).toEqual({
      role: 'assistant',
      text: 'non è JSON',
    })
    expect(secondaChiamata.previousTurns?.[1].text).toMatch(/JSON/i)

    // L istruzione di riparazione compare una sola volta, non anche dentro "prompt".
    const occorrenze = secondaChiamata.previousTurns?.filter((turno) =>
      turno.text.includes('non rispetta il formato richiesto'),
    )
    expect(occorrenze).toHaveLength(1)
  })

  it('passa al provider di riserva se il principale non si corregge', async () => {
    const primario = provider('groq', 'spazzatura', 'ancora spazzatura')
    const riserva = provider('anthropic', VALIDA)

    const result = await extractRoster({
      image: IMAGE,
      knownCodes: [],
      provider: primario,
      fallback: riserva,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.provider).toBe('anthropic')
    expect(primario.extract).toHaveBeenCalledTimes(2)
    expect(riserva.extract).toHaveBeenCalledTimes(1)
  })

  it('fallisce riportando l ultimo output grezzo quando nessuno produce JSON valido', async () => {
    const result = await extractRoster({
      image: IMAGE,
      knownCodes: [],
      provider: provider('groq', 'a', 'b'),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rawOutput).toBe('b')
      expect(result.error).toMatch(/JSON/i)
      expect(result.attempts).toBe(2)
    }
  })

  it('non riprova se il provider stesso è in errore: non è un problema di formato', async () => {
    const p = provider('groq', new VisionProviderError('quota esaurita'))

    const result = await extractRoster({ image: IMAGE, knownCodes: [], provider: p })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/quota esaurita/)
      expect(result.rawOutput).toBeNull()
    }
    expect(p.extract).toHaveBeenCalledTimes(1)
  })

  it('non riprova sullo stesso provider quando la risposta è troncata, e lo dice nel messaggio', async () => {
    const p = provider(
      'groq',
      new VisionTruncatedError('Groq ha troncato la risposta per il limite di token di output (token di output usati: 4000)'),
    )

    const result = await extractRoster({ image: IMAGE, knownCodes: [], provider: p })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/tronc/i)
    expect(p.extract).toHaveBeenCalledTimes(1)
  })

  it('prova la riserva anche quando il principale va in errore di provider', async () => {
    const result = await extractRoster({
      image: IMAGE,
      knownCodes: [],
      provider: provider('groq', new VisionProviderError('quota esaurita')),
      fallback: provider('anthropic', VALIDA),
    })

    expect(result.ok).toBe(true)
  })

  it('include i codici noti nel prompt che manda al provider', async () => {
    const p = provider('groq', VALIDA)

    await extractRoster({ image: IMAGE, knownCodes: ['M', 'NOTTE'], provider: p })

    const prompt = vi.mocked(p.extract).mock.calls[0][0].prompt
    expect(prompt).toContain('NOTTE')
  })
})
