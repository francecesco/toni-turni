import type { RosterBand } from '@/modules/ingest/crop'
import type { BandSpec } from '@/modules/ingest/layout'
import { buildBandPrompt } from './band-prompt'
import {
  countBandCells,
  mergeBandExtractions,
  parseBandExtraction,
  type BandExtraction,
} from './band-schema'
import { buildRepairPrompt } from './prompt'
import type { Extraction } from './schema'
import { VisionProviderError, VisionTruncatedError, type VisionProvider } from './providers'

/**
 * Una banda che non è stata letta, o letta **solo in parte**: un buco
 * **dichiarato**, non una cella assente.
 *
 * Le due specie di buco passano dallo stesso meccanismo (`missingBands`, stato
 * `partial`) perché per l infermiera sono la stessa cosa — celle che nessuno ha
 * letto — e si distinguono da `cells`: presente solo quando la banda ha
 * risposto, e dice quante celle sono arrivate su quante erano attese.
 */
export interface BandFailure {
  spec: BandSpec
  error: string
  /**
   * Celle davvero lette e celle attese. Presente **solo** sulle bande lette a
   * metà: le loro celle stanno nell estrazione, il buco è in quelle che
   * mancano. Assente sulle bande che non hanno prodotto nessuna risposta
   * valida.
   */
  cells?: { read: number; expected: number }
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
 * Quanto pesa una banda nel budget al minuto. **Tarato sul dato misurato**, non
 * su una stima.
 *
 * Groq conta i token di output **prenotati** con `max_completion_tokens`, non
 * solo quelli usati: 4000 (il default di `GROQ_MAX_OUTPUT_TOKENS`) sono
 * prenotati a ogni chiamata anche se una banda ne produce ~1600. Ai 4000 si
 * aggiunge l input, immagine compresa, e la misura su 24 bande (due foto) dice
 * quanto vale:
 *
 * - banda normale: input **1577-1581** → peso **5581**;
 * - banda larga, quella che include le colonne di aiuto e che è anche la più
 *   grande in pixel: input **2601-2605** → peso **6605**;
 * - banda a colonna singola: input 1832-1836 → peso 5836.
 *
 * Il valore precedente era 5500, dedotto da una stima di ~1500 token di input:
 * sotto il peso reale anche della banda più leggera, e infatti si sono viste
 * **3 risposte 429**, assorbite dal ritentativo con `retry-after` senza perdere
 * bande, ma spendendo quota due volte su quelle tre.
 *
 * 6700 copre la banda peggiore misurata con un margine, e fa un intervallo di
 * ~50 s fra due bande: 24 bande sono ~20 minuti di sole immagini. È lento, ed è
 * il vincolo del piano, non una scelta.
 *
 * **Non si abbassa `GROQ_MAX_OUTPUT_TOKENS` per accorciare l attesa.** Portarlo
 * a ~2500 farebbe scendere il peso a ~4100 e l intervallo a ~31 s, ma l output
 * vero è ~1600 con punte a 1713 su una banda di sole due colonne: un
 * troncamento è una **banda persa**, e quel rischio non vale nove secondi.
 */
export const DEFAULT_TOKENS_PER_BAND = 6700

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
 *
 * Nello stesso `failures` finisce anche la banda **letta a metà**: una risposta
 * valida che porta meno celle di quelle chieste è il modo esatto in cui questo
 * modello sbagliava nella Fase 2A (199 celle mancanti su 248), e senza questo
 * controllo somiglierebbe a un foglio con le celle vuote. Le sue celle si
 * tengono; il buco è nelle celle che mancano.
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

  /**
   * Prende la lettura di una banda e, se è **corta**, ne dichiara il buco.
   *
   * Le celle lette si tengono in ogni caso: buttarle non riempirebbe il buco e
   * perderebbe le celle che il modello ha letto bene. Il buco entra in
   * `failures`, cioè nello stesso meccanismo delle bande non lette, e porta
   * l estrazione allo stato `partial`: la Fase 3 mostra all infermiera che di
   * quelle colonne, in quei giorni, manca qualcosa.
   */
  function accetta(spec: BandSpec, extraction: BandExtraction, providerName: string): void {
    letture.push({ spec, extraction })
    providerUsati.add(providerName)

    const conto = countBandCells(spec, extraction)
    if (conto.read >= conto.expected) return

    const colonne = spec.columns.length === 1 ? '1 colonna' : `${spec.columns.length} colonne`
    failures.push({
      spec,
      error:
        `Banda letta solo in parte: ${conto.read} celle su ${conto.expected} attese ` +
        `(giorni ${spec.dayFrom}-${spec.dayTo}, ${colonne})`,
      cells: conto,
    })
  }

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
      accetta(band.spec, primario.extraction, input.provider.name)
      continue
    }

    if (input.fallback) {
      const riserva = await tryBand(input.fallback, band, prompt, index, pace)
      attempts += riserva.attempts
      rawOutputs.push(...riserva.raws)

      if (riserva.ok && riserva.extraction) {
        accetta(band.spec, riserva.extraction, input.fallback.name)
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
