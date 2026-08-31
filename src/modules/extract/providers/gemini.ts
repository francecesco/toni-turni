import { optionalEnv, requireEnv } from '@/lib/env'
import { VisionProviderError, VisionTruncatedError, type VisionProvider, type VisionRequest } from './types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Il modello di default è quello che privilegia la lettura corretta, non il
 * prezzo: la tabella si legge **una volta al mese** in una sola chiamata, quindi
 * la differenza di costo fra il modello più capace e il più economico è di
 * frazioni di centesimo al mese, mentre la differenza fra una cella giusta e una
 * sbagliata è un turno sbagliato addosso a una persona.
 *
 * L'elenco dei modelli disponibili per una chiave si verifica con
 * `GET https://generativelanguage.googleapis.com/v1beta/models`; `GEMINI_MODEL`
 * lo sovrascrive senza toccare il codice.
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-pro'

/**
 * Tetto di token in uscita. Va largo di proposito: la tabella intera sono ~250
 * celle di JSON (~6000 token) **più** i token di ragionamento, che su questi
 * modelli contano nello stesso budget. Gemini fattura i token **usati** e non
 * quelli prenotati, quindi chiederne molti non costa nulla se non si usano —
 * mentre un tetto stretto tronca la tabella a metà, che è il guasto peggiore per
 * una strategia a chiamata singola.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 32768

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { candidatesTokenCount?: number }
}

function maxOutputTokens(): number {
  // Number('') è 0 e Number('abc') è NaN: senza questo controllo una variabile
  // impostata male troncherebbe ogni risposta in silenzio.
  const richiesto = Number(optionalEnv('GEMINI_MAX_OUTPUT_TOKENS', ''))
  return Number.isFinite(richiesto) && richiesto > 0 ? richiesto : DEFAULT_MAX_OUTPUT_TOKENS
}

export function createGeminiProvider(fetchImpl: typeof fetch = fetch): VisionProvider {
  return {
    name: 'gemini',

    async extract(request: VisionRequest) {
      let apiKey: string
      try {
        apiKey = requireEnv('GEMINI_API_KEY')
      } catch (cause) {
        throw new VisionProviderError('GEMINI_API_KEY non configurata', { cause })
      }

      const model = optionalEnv('GEMINI_MODEL', GEMINI_DEFAULT_MODEL)

      const contents = [
        {
          role: 'user',
          parts: [
            { text: request.prompt },
            { inline_data: { mime_type: 'image/jpeg', data: request.image.toString('base64') } },
          ],
        },
        // Gemini non conosce il ruolo `assistant`: il turno del modello si chiama
        // `model`, e mandare l altro nome fa rifiutare la conversazione — cioè
        // impedirebbe del tutto il giro di riparazione.
        ...(request.previousTurns ?? []).map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.text }],
        })),
      ]

      let response: Response
      try {
        response = await fetchImpl(`${BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            // La chiave sta in un header e non nella query string: nell URL
            // finirebbe nei log di ogni proxy attraversato.
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              maxOutputTokens: maxOutputTokens(),
            },
          }),
        })
      } catch (cause) {
        throw new VisionProviderError('Chiamata di rete a Gemini non riuscita', { cause })
      }

      if (!response.ok) {
        const retryAfterHeader = response.headers.get('retry-after')
        const retryAfterSeconds =
          retryAfterHeader !== null && !Number.isNaN(Number(retryAfterHeader))
            ? Number(retryAfterHeader)
            : undefined
        // Il corpo dell errore non viene incluso: può contenere l eco della richiesta.
        throw new VisionProviderError(`Gemini ha risposto con stato ${response.status}`, {
          status: response.status,
          retryAfterSeconds,
        })
      }

      let payload: GeminiResponse
      try {
        payload = (await response.json()) as GeminiResponse
      } catch (cause) {
        // Un 200 con corpo non-JSON è tipico di un proxy che intercetta: non deve
        // uscire come SyntaxError grezzo, da questo dipende la decisione di fallback.
        throw new VisionProviderError('Risposta di Gemini non decodificabile come JSON', {
          cause,
          status: response.status,
        })
      }

      const bloccato = payload.promptFeedback?.blockReason
      if (bloccato !== undefined) {
        throw new VisionProviderError(`Gemini ha bloccato la richiesta: ${bloccato}`)
      }

      const candidate = payload.candidates?.[0]

      if (candidate?.finishReason === 'MAX_TOKENS') {
        const usati = payload.usageMetadata?.candidatesTokenCount ?? 'sconosciuti'
        throw new VisionTruncatedError(
          `Gemini ha troncato la risposta per il limite di token di output (token di output usati: ${usati})`,
        )
      }

      // Le risposte lunghe arrivano divise in più `parts`: prenderne solo la prima
      // taglierebbe la tabella senza che nessuno se ne accorga.
      const raw = (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')

      if (raw.trim() === '') {
        const motivo = candidate?.finishReason
        throw new VisionProviderError(
          motivo !== undefined && motivo !== 'STOP'
            ? `Gemini ha restituito una risposta senza contenuto (motivo: ${motivo})`
            : 'Gemini ha restituito una risposta senza contenuto',
        )
      }

      return { raw, model, provider: 'gemini' }
    },
  }
}
