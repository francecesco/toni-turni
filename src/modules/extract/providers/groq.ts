import { optionalEnv, requireEnv } from '@/lib/env'
import { VisionProviderError, type VisionProvider, type VisionRequest } from './types'

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.8-27b'

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export function createGroqProvider(fetchImpl: typeof fetch = fetch): VisionProvider {
  return {
    name: 'groq',

    async extract(request: VisionRequest) {
      let apiKey: string
      try {
        apiKey = requireEnv('GROQ_API_KEY')
      } catch (cause) {
        throw new VisionProviderError('GROQ_API_KEY non configurata', { cause })
      }

      const model = optionalEnv('GROQ_MODEL', GROQ_DEFAULT_MODEL)

      const messages: unknown[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${request.image.toString('base64')}` },
            },
          ],
        },
        ...(request.previousTurns ?? []).map((turn) => ({ role: turn.role, content: turn.text })),
      ]

      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          // La modalità JSON riduce i casi in cui il modello aggiunge testo attorno.
          response_format: { type: 'json_object' },
          temperature: 0,
        }),
      })

      if (!response.ok) {
        // Il corpo dell errore non viene incluso: può contenere l eco della richiesta.
        throw new VisionProviderError(`Groq ha risposto con stato ${response.status}`)
      }

      const payload = (await response.json()) as GroqResponse
      const raw = payload.choices?.[0]?.message?.content
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new VisionProviderError('Groq ha restituito una risposta senza contenuto')
      }

      return { raw, model, provider: 'groq' }
    },
  }
}
