import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv } from '@/lib/env'
import { VisionProviderError, type VisionProvider, type VisionRequest } from './types'

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5'
const MAX_TOKENS = 16000

/** Firma minima che ci serve dell SDK: permette di iniettarne un finto nei test. */
export type MessageCreator = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>
}>

function defaultCreator(): MessageCreator {
  const client = new Anthropic()
  return (params) =>
    client.messages.create(params as never) as unknown as ReturnType<MessageCreator>
}

export function createAnthropicProvider(create?: MessageCreator): VisionProvider {
  return {
    name: 'anthropic',

    async extract(request: VisionRequest) {
      const model = optionalEnv('ANTHROPIC_MODEL', ANTHROPIC_DEFAULT_MODEL)
      const createMessage = create ?? defaultCreator()

      let response: Awaited<ReturnType<MessageCreator>>
      try {
        response = await createMessage({
          model,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: request.image.toString('base64'),
                  },
                },
                { type: 'text', text: request.prompt },
              ],
            },
            ...(request.previousTurns ?? []).map((turn) => ({
              role: turn.role,
              content: turn.text,
            })),
          ],
        })
      } catch (cause) {
        throw new VisionProviderError('Chiamata ad Anthropic non riuscita', { cause })
      }

      const raw = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')

      if (raw.trim() === '') {
        throw new VisionProviderError('Anthropic ha restituito una risposta senza testo')
      }

      return { raw, model, provider: 'anthropic' }
    },
  }
}
