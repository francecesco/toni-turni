import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from '@/modules/extract/providers/anthropic'
import { VisionProviderError } from '@/modules/extract/providers/types'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0x42])

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-di-test'
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_MODEL
})

describe('createAnthropicProvider', () => {
  it('restituisce il testo dei blocchi di tipo text', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"year":2026}' },
      ],
    })

    const result = await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'leggi' })

    expect(result.raw).toBe('{"year":2026}')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe(ANTHROPIC_DEFAULT_MODEL)
  })

  it('manda l immagine come blocco base64 prima del testo', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'leggi la tabella' })

    const params = create.mock.calls[0][0]
    const content = params.messages[0].content
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: IMAGE.toString('base64') },
    })
    expect(content[1]).toEqual({ type: 'text', text: 'leggi la tabella' })
  })

  it('non usa parametri rifiutati da questo modello', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' })

    const params = create.mock.calls[0][0]
    expect(params.temperature).toBeUndefined()
    expect(params.thinking?.budget_tokens).toBeUndefined()
    expect(params.max_tokens).toBeGreaterThanOrEqual(16000)
  })

  it('riporta i turni precedenti per la riparazione', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    await createAnthropicProvider(create).extract({
      image: IMAGE,
      prompt: 'ripara',
      previousTurns: [
        { role: 'assistant', text: 'sbagliato' },
        { role: 'user', text: 'ecco l errore' },
      ],
    })

    const params = create.mock.calls[0][0]
    expect(params.messages).toHaveLength(3)
    expect(params.messages[1]).toEqual({ role: 'assistant', content: 'sbagliato' })
  })

  it('rispetta ANTHROPIC_MODEL', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5'
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    const result = await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' })

    expect(result.model).toBe('claude-sonnet-5')
  })

  it('solleva un VisionProviderError se la risposta non ha blocchi di testo', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'thinking', thinking: '' }] })

    await expect(
      createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })

  it('traduce un errore dell SDK in VisionProviderError', async () => {
    const create = vi.fn().mockRejectedValue(new Error('rate limited'))

    await expect(
      createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })
})
