import { optionalEnv, requireEnv } from '@/lib/env'
import { VisionProviderError, VisionTruncatedError, type VisionProvider, type VisionRequest } from './types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Il modello di default, **scelto su una prova vera** contro l API il 2026-08-31,
 * non su una preferenza:
 *
 * | modello | esito |
 * |---|---|
 * | `gemini-2.5-pro`, `gemini-2.5-flash` | **404** «no longer available to new users» |
 * | `gemini-3.1-pro-preview` (e i Pro in genere) | **429 RESOURCE_EXHAUSTED**, «check your plan and billing details»: quota zero senza fatturazione attiva |
 * | `gemini-3.7-flash`, `gemini-flash-latest` | **503 UNAVAILABLE**, «experiencing high demand», su una tabella intera |
 * | `gemini-3-flash-preview` | 200, ma brucia **31455 token di ragionamento** e non produce JSON |
 * | `gemini-3.6-flash`, `gemini-3.5-flash` | **200**, tabella intera letta: 360 celle su 360 |
 *
 * Quindi il default e un Flash, e non per risparmiare: e l unica famiglia che
 * risponde con una chiave di AI Studio senza fatturazione. Ed e il **3.6** e non
 * il 3.7, che e piu nuovo: sulla tabella intera il 3.7 risponde 503 in modo
 * ripetibile, mentre il 3.6 legge tutto in ~110 s. Un modello che non risponde
 * non e un modello piu avanzato.
 *
 * E **pinnato**, non l alias `gemini-flash-latest`: un alias cambia sotto i piedi
 * (e oggi punta proprio al 3.7 che risponde 503), e le percentuali di accuratezza
 * di questo progetto valgono per un modello preciso. Quando si vuole cambiare,
 * `GEMINI_MODEL` lo fa senza toccare il codice — e con la fatturazione attiva vale
 * la pena misurare un Pro, che su una tabella corretta a penna e il candidato
 * naturale.
 *
 * L elenco dei modelli disponibili per una chiave si verifica con
 * `GET https://generativelanguage.googleapis.com/v1beta/models`.
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.6-flash'

/**
 * Tetto di token in uscita. Va largo, ed e **misurato**: la lettura della tabella
 * intera di settembre (360 celle) produce **14163 token** di uscita piu 1727 di
 * ragionamento, che contano nello stesso budget. Con un tetto a 12000 la risposta
 * si tronca e il JSON diventa invalido — provato. Gemini fattura i token **usati** e non
 * quelli prenotati, quindi chiederne molti non costa nulla se non si usano —
 * mentre un tetto stretto tronca la tabella a metà, che è il guasto peggiore per
 * una strategia a chiamata singola.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 32768

/**
 * Lunghezza massima del messaggio d errore che si riporta.
 *
 * Il messaggio di Google e testo per esseri umani e dice cose che servono
 * («quota esaurita, controlla il piano», «questo modello non esiste piu»), ma un
 * 400 puo citare il valore del campo rifiutato — e il campo piu grosso della
 * richiesta e l immagine in base64. Si taglia: la diagnosi sta nelle prime righe,
 * la foto dei turni non deve finire nei log.
 */
const MAX_ERROR_MESSAGE = 300

/**
 * Limite di tempo di una richiesta.
 *
 * **Misurato**, e il numero e cresciuto strada facendo: le prime letture riuscite
 * della tabella intera prendevano 87-97 s, quelle della misura finale — prompt
 * piu lungo, ~17-20 mila token di uscita — **150-165 s**. Una lettura invece e
 * rimasta appesa **301 secondi** ed e caduta sul `headersTimeout` di Node (300 s)
 * con un «fetch failed» che non dice niente a nessuno.
 *
 * 270 s stanno a 1,64x dalla lettura piu lenta riuscita e sotto il limite di Node:
 * cosi una richiesta appesa muore per un limite **nostro**, con un messaggio che
 * la nomina, e viene ritentata come il guasto transitorio che e. Se un giorno le
 * letture si allungassero ancora, questo e il numero da guardare — e non si alza
 * sopra i 300 s di Node, perche oltre quelli il limite torna a essere il suo.
 */
const REQUEST_TIMEOUT_MS = 270_000

interface GeminiErrorBody {
  error?: { code?: number; status?: string; message?: string }
}

/**
 * Lo stato strutturato dell errore, se il corpo e quello di Google.
 *
 * Senza questo il messaggio diceva soltanto «ha risposto con stato 429», che non
 * distingue una quota finita da un picco momentaneo: sono due azioni diverse
 * (attivare la fatturazione, oppure riprovare) e chi legge il messaggio deve
 * poterle distinguere.
 */
function dettaglioErrore(corpo: string): string {
  let payload: GeminiErrorBody
  try {
    payload = JSON.parse(corpo) as GeminiErrorBody
  } catch {
    // Corpo che non e JSON di Google (tipico di un proxy che intercetta): non si
    // riporta niente, lo stato HTTP resta l unica cosa affidabile.
    return ''
  }

  const errore = payload.error
  if (errore === undefined) return ''

  const pezzi = [errore.status, errore.message?.trim()].filter(
    (pezzo): pezzo is string => typeof pezzo === 'string' && pezzo !== '',
  )
  if (pezzi.length === 0) return ''

  const testo = pezzi.join(' — ')
  return testo.length > MAX_ERROR_MESSAGE ? `${testo.slice(0, MAX_ERROR_MESSAGE)}…` : testo
}

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
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
        // Un limite scaduto va detto per nome: «chiamata di rete non riuscita» su
        // una richiesta durata quattro minuti manda a cercare la rete quando il
        // problema e il tempo. Nessuno dei due porta uno stato HTTP, quindi
        // entrambi restano guasti **transitori** e vengono ritentati.
        const abortita = cause instanceof Error && cause.name === 'AbortError'
        throw new VisionProviderError(
          abortita
            ? `Gemini non ha risposto entro il tempo massimo di attesa (${REQUEST_TIMEOUT_MS / 1000}s)`
            : 'Chiamata di rete a Gemini non riuscita',
          { cause },
        )
      }

      if (!response.ok) {
        const retryAfterHeader = response.headers.get('retry-after')
        const retryAfterSeconds =
          retryAfterHeader !== null && !Number.isNaN(Number(retryAfterHeader))
            ? Number(retryAfterHeader)
            : undefined

        // Del corpo si prendono **solo** i campi strutturati dell errore, tagliati:
        // mai il corpo intero, che in un 400 puo contenere l eco della richiesta.
        const dettaglio = dettaglioErrore(await response.text().catch(() => ''))
        throw new VisionProviderError(
          dettaglio === ''
            ? `Gemini ha risposto con stato ${response.status}`
            : `Gemini ha risposto con stato ${response.status}: ${dettaglio}`,
          { status: response.status, retryAfterSeconds },
        )
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
