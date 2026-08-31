import { afterEach, describe, expect, it } from 'vitest'
import { fallbackProviderFromEnv, providerFromEnv } from '@/modules/extract/providers'

afterEach(() => {
  delete process.env.AI_PROVIDER
  delete process.env.AI_FALLBACK_PROVIDER
})

describe('providerFromEnv', () => {
  it('usa Gemini per default', () => {
    expect(providerFromEnv().name).toBe('gemini')
  })

  it('usa Anthropic quando AI_PROVIDER lo chiede', () => {
    process.env.AI_PROVIDER = 'anthropic'
    expect(providerFromEnv().name).toBe('anthropic')
  })

  it('rifiuta un provider sconosciuto invece di ripiegare in silenzio', () => {
    process.env.AI_PROVIDER = 'inventato'
    expect(() => providerFromEnv()).toThrow(/inventato/)
  })
})

describe('fallbackProviderFromEnv', () => {
  it('non c è nessun fallback se non lo si configura', () => {
    expect(fallbackProviderFromEnv()).toBeNull()
  })

  it('restituisce il provider alternativo configurato', () => {
    process.env.AI_FALLBACK_PROVIDER = 'anthropic'
    expect(fallbackProviderFromEnv()?.name).toBe('anthropic')
  })

  it('ignora un fallback identico al provider principale', () => {
    process.env.AI_PROVIDER = 'gemini'
    process.env.AI_FALLBACK_PROVIDER = 'gemini'
    expect(fallbackProviderFromEnv()).toBeNull()
  })
})
