import type { RosterBand } from '@/modules/ingest/crop'
import type { BandSpec } from '@/modules/ingest/layout'
import { buildBandPrompt } from './band-prompt'
import { mergeBandExtractions, parseBandExtraction, type BandExtraction } from './band-schema'
import { buildRepairPrompt } from './prompt'
import type { Extraction } from './schema'
import { VisionProviderError, VisionTruncatedError, type VisionProvider } from './providers'

/** Una banda che non è stata letta: un buco **dichiarato**, non una cella assente. */
export interface BandFailure {
  spec: BandSpec
  error: string
}

export interface BandsOutcome {
  extraction: Extraction
  /** Testo grezzo di ogni risposta ricevuta, comprese quelle non valide. */
  rawOutputs: string[]
  failures: BandFailure[]
  conflicts: number
  /** Nomi dei provider che hanno prodotto almeno una banda accettata. */
  provider: string
  /** Chiamate al modello, in totale su tutte le bande. */
  attempts: number
}

/**
 * Attesa fra una banda e l altra. Il secondo argomento è il `retry-after` che
 * il provider ha indicato sull errore, quando c era.
 */
export type BandPacer = (index: number, retryAfterSeconds?: number) => Promise<void>

/** Tetto di token al minuto del piano gratuito di Groq. */
export const GROQ_FREE_TOKENS_PER_MINUTE = 8000

/**
 * Quanto pesa una banda nel budget al minuto.
 *
 * Groq conta i token di output **prenotati** con `max_completion_tokens`, non
 * solo quelli usati: 4000 (il default di `GROQ_MAX_OUTPUT_TOKENS`) sono
 * prenotati a ogni chiamata anche se una banda ne produce poche decine. Ai 4000
 * si aggiunge l input, immagine compresa: la misura nota è che una richiesta
 * con 8000 token prenotati e la foto **intera** pesava 10369, cioè ~2369 di
 * input; una banda è un ritaglio più piccolo, quindi 1500 è una stima prudente
 * per difetto del suo peso in input.
 *
 * 5500 su 8000 al minuto fa un intervallo di 41,25 s fra due bande: 24 bande
 * (le 10 di agosto più le 14 di settembre) sono ~16,5 minuti di sole immagini.
 * È lento, ed è il vincolo del piano, non una scelta.
 */
export const DEFAULT_TOKENS_PER_BAND = 5500

function attendi(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Pacer di produzione: tiene le chiamate distanziate quanto basta a stare sotto
 * il tetto di token al minuto, sottraendo il tempo che la chiamata precedente ha
 * già consumato da sola.
 *
 * La prima attesa è piena: quando il pacer viene chiamato una richiesta è
 * appena partita (si chiama **fra** le bande), e non si sa da quanto.
 *
 * `now` e `sleep` sono iniettabili perché i test non devono dormire.
 */
export function createTokenPacer(options?: {
  tokensPerMinute?: number
  tokensPerBand?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}): BandPacer {
  const tokensPerMinute = options?.tokensPerMinute ?? GROQ_FREE_TOKENS_PER_MINUTE
  const tokensPerBand = options?.tokensPerBand ?? DEFAULT_TOKENS_PER_BAND
  const now = options?.now ?? Date.now
  const sleep = options?.sleep ?? attendi

  const intervallo = Math.round((60_000 * tokensPerBand) / tokensPerMinute)
  let ultima: number | null = null

  return async (_index: number, retryAfterSeconds?: number) => {
    const trascorso = ultima === null ? 0 : now() - ultima
    const attesa = Math.max(intervallo - trascorso, (retryAfterSeconds ?? 0) * 1000, 0)

    if (attesa > 0) await sleep(attesa)
    ultima = now()
  }
}

interface BandAttempt {
  ok: boolean
  extraction?: BandExtraction
  raws: string[]
  attempts: number
  error?: string
}

/**
 * Una banda, un provider. Due possibilità in tutto:
 *
 * - un **rate limit** (errore con `retryAfterSeconds`) vale un solo
 *   ritentativo, dopo aver passato l attesa richiesta al pacer;
 * - un output che non passa la validazione vale una sola richiesta di
 *   riparazione, con l errore in mano.
 *
 * Una risposta **troncata** non si ritenta: rimandare la stessa immagine la
 * troncherebbe di nuovo, consumando quota per niente.
 */
async function tryBand(
  provider: VisionProvider,
  band: RosterBand,
  prompt: string,
  index: number,
  pace: BandPacer,
): Promise<BandAttempt> {
  const raws: string[] = []
  let attempts = 0
  let lastRaw = ''
  let lastError = 'Estrazione della banda non riuscita'
  let rateLimitRitentato = false
  let riparazioneChiesta = false

  for (;;) {
    attempts += 1

    let result
    try {
      const previousTurns = riparazioneChiesta
        ? [
            { role: 'assistant' as const, text: lastRaw },
            { role: 'user' as const, text: buildRepairPrompt(lastRaw, lastError) },
          ]
        : undefined
      result = await provider.extract({ image: band.image, prompt, previousTurns })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof VisionTruncatedError) return { ok: false, raws, attempts, error: message }

      const retryAfterSeconds =
        error instanceof VisionProviderError ? error.retryAfterSeconds : undefined
      if (retryAfterSeconds !== undefined && !rateLimitRitentato) {
        rateLimitRitentato = true
        await pace(index, retryAfterSeconds)
        continue
      }

      return { ok: false, raws, attempts, error: message }
    }

    raws.push(result.raw)
    lastRaw = result.raw

    const parsed = parseBandExtraction(result.raw)
    if (parsed.ok) return { ok: true, extraction: parsed.value, raws, attempts }

    lastError = parsed.error
    if (riparazioneChiesta) return { ok: false, raws, attempts, error: lastError }
    riparazioneChiesta = true
  }
}

/**
 * Estrae una tabella turni **banda per banda** e fonde i risultati.
 *
 * Le bande si elaborano in sequenza, non in parallelo: il tetto è sui token al
 * minuto e il parallelismo lo farebbe scattare alla seconda banda. Fra una
 * banda e l altra si chiama `pace`, mai dopo l ultima.
 *
 * Una banda che non si legge **non interrompe le altre**: finisce in `failures`
 * col suo motivo, e chi chiama la registra come buco dichiarato (stato
 * `partial`). L outcome è sempre restituito, anche con zero celle: se sia
 * utilizzabile lo decide il chiamante, non questa funzione — un turno che
 * sparisce in silenzio è il guasto peggiore di questo progetto.
 */
export async function extractRosterByBands(input: {
  bands: RosterBand[]
  knownCodes: string[]
  header: { year: number; month: number; ward: string }
  provider: VisionProvider
  fallback?: VisionProvider | null
  pace?: BandPacer
}): Promise<BandsOutcome> {
  const pace = input.pace ?? createTokenPacer()

  const letture: Array<{ spec: BandSpec; extraction: BandExtraction }> = []
  const rawOutputs: string[] = []
  const failures: BandFailure[] = []
  const providerUsati = new Set<string>()
  let attempts = 0

  for (let index = 0; index < input.bands.length; index += 1) {
    if (index > 0) await pace(index)

    const band = input.bands[index]
    const prompt = buildBandPrompt(input.knownCodes, {
      dayFrom: band.spec.dayFrom,
      dayTo: band.spec.dayTo,
      columnCount: band.spec.columns.length,
    })

    const primario = await tryBand(input.provider, band, prompt, index, pace)
    attempts += primario.attempts
    rawOutputs.push(...primario.raws)

    if (primario.ok && primario.extraction) {
      letture.push({ spec: band.spec, extraction: primario.extraction })
      providerUsati.add(input.provider.name)
      continue
    }

    if (input.fallback) {
      const riserva = await tryBand(input.fallback, band, prompt, index, pace)
      attempts += riserva.attempts
      rawOutputs.push(...riserva.raws)

      if (riserva.ok && riserva.extraction) {
        letture.push({ spec: band.spec, extraction: riserva.extraction })
        providerUsati.add(input.fallback.name)
        continue
      }

      failures.push({
        spec: band.spec,
        error: `${primario.error ?? 'non riuscita'} (riserva: ${riserva.error ?? 'non riuscita'})`,
      })
      continue
    }

    failures.push({ spec: band.spec, error: primario.error ?? 'Banda non letta' })
  }

  const { extraction, conflicts } = mergeBandExtractions(letture, input.header)

  return {
    extraction,
    rawOutputs,
    failures,
    conflicts,
    provider: providerUsati.size > 0 ? [...providerUsati].join('+') : input.provider.name,
    attempts,
  }
}
