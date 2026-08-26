import { optionalEnv, requireEnv } from '@/lib/env'
import { VisionProviderError, VisionTruncatedError, type VisionProvider, type VisionRequest } from './types'

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.8-27b'
// Groq conta il valore *prenotato* di max_completion_tokens nel budget di token al
// minuto del piano, non solo quello effettivamente usato: chiederne 8000 (il tetto
// del piano gratuito) fa pesare la richiesta 10369 token e la fa rifiutare con un
// errore che parla di dimensione della richiesta e non c entra nulla con l immagine.
// 4000 è un punto di partenza scelto per stare sotto quel tetto, non una capienza
// misurata: una risposta completa per le ~250 celle di una tabella intera è
// plausibilmente dello stesso ordine di grandezza. Con la strategia a ritagli
// (Fase 2A-bis) ogni chiamata produce poche decine di celle e resta ben lontana
// dal limite, quindi il problema non si ripresenta in quella forma.
const DEFAULT_MAX_OUTPUT_TOKENS = 4000

interface GroqResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  usage?: { completion_tokens?: number }
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
      // Number('') è 0, non NaN: senza questo controllo una variabile impostata a
      // stringa vuota (o a un valore non numerico) troncherebbe silenziosamente
      // ogni risposta invece di ripiegare sul default.
      const parsedMaxOutputTokens = Number(optionalEnv('GROQ_MAX_OUTPUT_TOKENS', ''))
      const maxOutputTokens =
        Number.isFinite(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
          ? parsedMaxOutputTokens
          : DEFAULT_MAX_OUTPUT_TOKENS

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

      let response: Response
      try {
        response = await fetchImpl(ENDPOINT, {
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
            max_completion_tokens: maxOutputTokens,
          }),
        })
      } catch (cause) {
        // DNS che non risolve, connessione resettata, ecc: fuori dal contratto del
        // provider se non tradotto qui. Da questo dipende la decisione di fallback.
        throw new VisionProviderError('Chiamata di rete a Groq non riuscita', { cause })
      }

      if (!response.ok) {
        const retryAfterHeader = response.headers.get('retry-after')
        const retryAfterSeconds =
          retryAfterHeader !== null && !Number.isNaN(Number(retryAfterHeader))
            ? Number(retryAfterHeader)
            : undefined
        // Il corpo dell errore non viene incluso: può contenere l eco della richiesta.
        throw new VisionProviderError(`Groq ha risposto con stato ${response.status}`, {
          status: response.status,
          retryAfterSeconds,
        })
      }

      let payload: GroqResponse
      try {
        payload = (await response.json()) as GroqResponse
      } catch (cause) {
        // Un 200 con corpo non-JSON (tipico di un proxy che intercetta la richiesta)
        // non deve rompere il contratto del provider con un SyntaxError grezzo.
        throw new VisionProviderError('Risposta di Groq non decodificabile come JSON', {
          cause,
          status: response.status,
        })
      }

      const choice = payload.choices?.[0]
      const raw = choice?.message?.content

      if (choice?.finish_reason === 'length') {
        const usati = payload.usage?.completion_tokens ?? 'sconosciuti'
        throw new VisionTruncatedError(
          `Groq ha troncato la risposta per il limite di token di output (token di output usati: ${usati})`,
        )
      }

      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new VisionProviderError('Groq ha restituito una risposta senza contenuto')
      }

      return { raw, model, provider: 'groq' }
    },
  }
}
