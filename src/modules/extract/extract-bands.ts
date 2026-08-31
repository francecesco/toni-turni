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
 * Attesa fra una banda e l altra.
 *
 * Il secondo argomento e il `retry-after` che il provider ha indicato
 * sull errore, quando c era; il terzo dice che si sta per **ritentare** dopo un
 * guasto transitorio anche se il provider non ha indicato nulla — cosa che fa
 * quasi sempre su un 503 — perche riprovare nello stesso istante prende lo
 * stesso rifiuto.
 */
export type BandPacer = (
  index: number,
  retryAfterSeconds?: number,
  options?: { retry?: boolean },
) => Promise<void>

/**
 * Quanto attendere davanti a un guasto che non dice quanto attendere. Serve solo
 * a non riprovare nello stesso istante: se il provider indica un tempo, vince il
 * suo.
 */
const DEFAULT_BACKOFF_SECONDS = 10

/**
 * Cosa vale la pena ritentare. Tutto **misurato**, non dedotto:
 *
 * - **429** e **5xx**: quota momentanea e guasti del servizio. La prima lettura
 *   di una tabella intera ha preso un `503 UNAVAILABLE — high demand` su
 *   entrambe le foto.
 * - **nessuno stato**: un guasto di rete. La lettura di agosto e rimasta appesa
 *   **301 secondi** e poi e caduta senza stato — il `headersTimeout` di Node e
 *   300 s. Un gate sul solo stato HTTP non la ritentava.
 *
 * Con dieci bande un guasto costava una banda; con la tabella intera in una
 * chiamata costa **tutta la tabella**, quindi il ritentativo non e un lusso ma la
 * differenza fra una lettura e un buco.
 *
 * Gli **altri stati no**, e il verso conta: 401 (chiave sbagliata), 404 (modello
 * che non esiste), 400 (richiesta malformata) non migliorano riprovando, spendono
 * quota e nascondono un errore di configurazione dietro un ritardo.
 *
 * Il prezzo di trattare "nessuno stato" come transitorio e una chiamata sprecata
 * nei casi in cui il provider fallisce prima della rete (chiave assente: zero
 * chiamate, quindi zero costo) o dopo (risposta bloccata dai filtri: una
 * chiamata). E un prezzo che si paga volentieri per non perdere una tabella
 * intera per una connessione andata male.
 */
function ritentabile(error: unknown): boolean {
  if (!(error instanceof VisionProviderError)) return false
  if (error.retryAfterSeconds !== undefined) return true
  if (error.status === undefined) return true
  return error.status === 429 || (error.status >= 500 && error.status < 600)
}

function attendi(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Pacer di produzione: **non distanzia** le chiamate, attende soltanto prima di
 * ritentare dopo un guasto transitorio.
 *
 * Prima qui c era un pacer a token: il piano gratuito di Groq aveva un tetto di
 * 8000 token al minuto e contava anche i token di output *prenotati*, quindi fra
 * due bande servivano ~50 s. Nella misura reale erano 417 s di attesa su 461 di
 * estrazione (agosto) e 603 su 657 (settembre): il **92% del tempo era quello**,
 * non il modello, che lavorava ~4 s per banda. Togliere il tetto togliendo Groq
 * toglie anche la ragione di distanziare, e distanziare per prudenza costerebbe
 * minuti a vuoto a ogni tabella.
 *
 * `sleep` e iniettabile perche i test non devono dormire.
 */
export function createRetryAfterPacer(options?: {
  defaultBackoffSeconds?: number
  sleep?: (ms: number) => Promise<void>
}): BandPacer {
  const backoff = options?.defaultBackoffSeconds ?? DEFAULT_BACKOFF_SECONDS
  const sleep = options?.sleep ?? attendi

  return async (_index: number, retryAfterSeconds?: number, opzioni?: { retry?: boolean }) => {
    if (retryAfterSeconds !== undefined) {
      await sleep(retryAfterSeconds * 1000)
      return
    }
    if (opzioni?.retry === true) await sleep(backoff * 1000)
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
 * - un guasto **transitorio** (vedi `ritentabile`: 429, 5xx, guasto di rete, o un
 *   errore che indica `retry-after`) vale un solo ritentativo, dopo aver passato
 *   l attesa al pacer;
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
  let ritentato = false
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
      if (ritentabile(error) && !ritentato) {
        ritentato = true
        await pace(index, retryAfterSeconds, { retry: true })
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
 * Le bande si elaborano in sequenza. Non e piu per un tetto di token al minuto
 * (quello era di Groq, e Groq non c e piu): e perche chi chiama persiste una
 * banda alla volta, ed e quello che rende ripartibile il lavoro. Fra una banda
 * e l altra si chiama `pace`, mai dopo l ultima; il pacer di produzione ora
 * attende solo davanti a un rate limit.
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
 * tengono; il buco è nelle celle che mancano. «Chieste» si misura sulle colonne
 * che restano dopo lo scarto per nome, non sulle colonne geometriche della
 * banda: le colonne di servizio non sono celle mancanti.
 */
export async function extractRosterByBands(input: {
  bands: RosterBand[]
  knownCodes: string[]
  header: { year: number; month: number; ward: string }
  provider: VisionProvider
  fallback?: VisionProvider | null
  pace?: BandPacer
}): Promise<BandsOutcome> {
  const pace = input.pace ?? createRetryAfterPacer()

  const letture: Array<{ spec: BandSpec; extraction: BandExtraction }> = []
  const rawOutputs: string[] = []
  const failures: BandFailure[] = []
  const providerUsati = new Set<string>()
  let attempts = 0

  /**
   * Prende la lettura di una banda e, se è **corta**, ne dichiara il buco.
   *
   * Il conto sta sulle colonne che restano dopo lo scarto per nome, non su
   * quelle geometriche della banda (vedi `countBandCells`): una banda che
   * mostra soltanto colonne di servizio non ha niente da leggere, e dichiararne
   * il buco sarebbe gridare al lupo — un allarme inaffidabile è peggio di
   * nessun allarme. Quello che **non** cambia è il caso opposto: una colonna di
   * persona che la banda non ha letto resta un buco dichiarato.
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

    const conto = countBandCells(spec, extraction, input.header.ward)
    if (conto.read >= conto.expected) return

    const colonne = conto.columns === 1 ? '1 colonna' : `${conto.columns} colonne`
    // le colonne che la banda mostra ma che nessuno legge: dirlo evita che il
    // messaggio sembri in contraddizione con la geometria della banda
    const escluse = spec.columns.length - conto.columns
    const nota =
      escluse === 0
        ? ''
        : escluse === 1
          ? ', 1 di servizio esclusa'
          : `, ${escluse} di servizio escluse`
    failures.push({
      spec,
      error:
        `Banda letta solo in parte: ${conto.read} celle su ${conto.expected} attese ` +
        `(giorni ${spec.dayFrom}-${spec.dayTo}, ${colonne}${nota})`,
      cells: { read: conto.read, expected: conto.expected },
    })
  }

  for (let index = 0; index < input.bands.length; index += 1) {
    if (index > 0) await pace(index)

    const band = input.bands[index]
    const prompt = buildBandPrompt(input.knownCodes, {
      dayFrom: band.spec.dayFrom,
      dayTo: band.spec.dayTo,
      columnCount: band.spec.columns.length,
      wholeTable: band.spec.whole,
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
