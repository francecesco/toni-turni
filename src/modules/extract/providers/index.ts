import { optionalEnv } from '@/lib/env'
import { createAnthropicProvider } from './anthropic'
import { createGroqProvider } from './groq'
import { VisionProviderError, type VisionProvider } from './types'

export type { VisionProvider, VisionRequest, VisionResult, VisionProviderErrorOptions } from './types'
export { VisionProviderError, VisionTruncatedError } from './types'
export { createGroqProvider, GROQ_DEFAULT_MODEL } from './groq'
export { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from './anthropic'

function byName(name: string): VisionProvider {
  switch (name) {
    case 'groq':
      return createGroqProvider()
    case 'anthropic':
      return createAnthropicProvider()
    default:
      // Stesso tipo di errore degli altri guasti del modulo, non un Error generico.
      throw new VisionProviderError(`Provider AI non riconosciuto: ${name}`)
  }
}

export function providerFromEnv(): VisionProvider {
  return byName(optionalEnv('AI_PROVIDER', 'groq'))
}

/** Provider di riserva, usato solo se il principale non produce un output valido. */
export function fallbackProviderFromEnv(): VisionProvider | null {
  const fallback = optionalEnv('AI_FALLBACK_PROVIDER', '')
  const primary = optionalEnv('AI_PROVIDER', 'groq')
  if (fallback === '' || fallback === primary) return null
  return byName(fallback)
}
