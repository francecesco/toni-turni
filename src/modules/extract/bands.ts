import { z } from 'zod'
import type { BandImage } from '@/modules/ingest'
import { buildBandPrompt, buildRepairPrompt } from './prompt'
import { extractedCellSchema, normalizeColumn } from './schema'
import {
  VisionProviderError,
  VisionTruncatedError,
  type VisionProvider,
} from './providers'

/**
 * Estrazione a bande: una chiamata al provider per ogni ritaglio.
 *
 * Due differenze sostanziali rispetto a `extractRoster` (tabella intera):
 * - una banda illeggibile **non** fa fallire l estrazione: finisce fra le
 *   `failures` e viene dichiarata all utente. Un buco silenzioso è il guasto
 *   peggiore che questo progetto possa avere;
 * - fra una banda e l altra si aspetta, perché il piano gratuito di Groq ha un
 *   tetto di token al minuto. L attesa è iniettabile: nei test non si aspetta.
 */

export const bandExtractionSchema = z.object({
  columns: z.array(z.string().trim().min(1).max(60)).max(10),
  cells: z.array(extractedCellSchema),
})

export type BandExtraction = z.infer<typeof bandExtractionSchema>
export type BandCell = BandExtraction['cells'][number]

export interface BandResult {
  index: number
  columnFrom: number
  columnTo: number
  ok: boolean
  extraction?: BandExtraction
  rawOutput: string | null
  error?: string
  attempts: number
}

export interface BandsOutcome {
  bands: BandResult[]
  /** Le bande che non siamo riusciti a leggere: da mostrare, non da nascondere. */
  failures: BandResult[]
  /** Unione delle colonne lette, nell ordine in cui sono comparse. */
  columns: string[]
  provider: string
  model: string
  rawOutputs: Array<{ index: number; raw: string | null }>
}

export const DEFAULT_BAND_PAUSE_MS = 50_000
/** Tetto all attesa chiesta da un retry-after: oltre, meglio dichiarare la banda persa. */
const MAX_RETRY_AFTER_MS = 180_000

function sliceJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

export function parseBandExtraction(
  raw: string,
  options: { daysInMonth: number },
): { ok: true; value: BandExtraction } | { ok: false; error: string } {
  const candidate = sliceJsonObject(raw)
  if (candidate === null) {
    return { ok: false, error: 'Nessun oggetto JSON trovato nella risposta del modello' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (error) {
    return { ok: false, error: `JSON non valido: ${(error as Error).message}` }
  }

  const result = bandExtractionSchema.safeParse(parsed)
  if (!result.success) {
    const messaggi = result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'radice'}: ${issue.message}`,
    )
    return { ok: false, error: messaggi.join('; ') }
  }

  const value = result.data
  const dichiarate = new Set(value.columns.map(normalizeColumn))
  const viste = new Set<string>()
  const errori: string[] = []

  for (const cell of value.cells) {
    if (!dichiarate.has(normalizeColumn(cell.column))) {
      errori.push(`La cella cita una colonna non dichiarata nella banda: ${cell.column}`)
    }
    if (cell.day > options.daysInMonth) {
      errori.push(
        `Il giorno ${cell.day} non esiste in un mese di ${options.daysInMonth} giorni`,
      )
    }
    const chiave = `${cell.day}:${normalizeColumn(cell.column)}`
    if (viste.has(chiave)) {
      errori.push(`Cella duplicata per giorno e colonna: ${chiave}`)
    }
    viste.add(chiave)
  }

  if (errori.length > 0) return { ok: false, error: errori.join('; ') }
  return { ok: true, value }
}

interface Attempt {
  ok: boolean
  extraction?: BandExtraction
  rawOutput: string | null
  model?: string
  error?: string
  attempts: number
}

/**
 * Una banda, un provider. Tre esiti possibili:
 * - output valido: fatto;
 * - output non conforme: un giro di riparazione con l errore in mano;
 * - rate limit con retry-after: si aspetta e si riprova **la stessa** banda una
 *   volta, perché non è un problema di formato ma di quota.
 * Una risposta troncata non si riprova: si troncherebbe di nuovo consumando quota.
 */
async function tryBand(
  provider: VisionProvider,
  band: BandImage,
  prompt: string,
  daysInMonth: number,
  sleep: (ms: number) => Promise<void>,
): Promise<Attempt> {
  const MAX_FORMAT_ATTEMPTS = 2 // la prima chiamata più un giro di riparazione
  let attempts = 0
  let formatAttempts = 0
  let lastRaw: string | null = null
  let lastError = 'Estrazione della banda non riuscita'
  let rateLimitRetried = false

  while (formatAttempts < MAX_FORMAT_ATTEMPTS) {
    attempts += 1

    let result
    try {
      const previousTurns =
        lastRaw === null
          ? undefined
          : [
              { role: 'assistant' as const, text: lastRaw },
              { role: 'user' as const, text: buildRepairPrompt(lastRaw, lastError) },
            ]
      result = await provider.extract({ image: band.data, prompt, previousTurns })
    } catch (error) {
      if (error instanceof VisionTruncatedError) {
        return { ok: false, rawOutput: lastRaw, error: error.message, attempts }
      }
      if (
        error instanceof VisionProviderError &&
        error.retryAfterSeconds !== undefined &&
        !rateLimitRetried
      ) {
        // Quota, non formato: si aspetta quanto chiesto e si riprova la stessa
        // banda senza consumare il giro di riparazione.
        rateLimitRetried = true
        await sleep(Math.min(error.retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS))
        continue
      }
      const message = error instanceof VisionProviderError ? error.message : String(error)
      return { ok: false, rawOutput: lastRaw, error: message, attempts }
    }

    formatAttempts += 1
    lastRaw = result.raw
    const parsed = parseBandExtraction(result.raw, { daysInMonth })
    if (parsed.ok) {
      return {
        ok: true,
        extraction: parsed.value,
        rawOutput: result.raw,
        model: result.model,
        attempts,
      }
    }
    lastError = parsed.error
  }

  return { ok: false, rawOutput: lastRaw, error: lastError, attempts }
}

export async function extractRosterByBands(input: {
  bands: BandImage[]
  knownCodes: string[]
  daysInMonth: number
  provider: VisionProvider
  fallback?: VisionProvider | null
  pauseMs?: number
  sleep?: (ms: number) => Promise<void>
  onBand?: (result: BandResult) => Promise<void> | void
}): Promise<BandsOutcome> {
  const pauseMs = input.pauseMs ?? DEFAULT_BAND_PAUSE_MS
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const prompt = buildBandPrompt(input.knownCodes, { daysInMonth: input.daysInMonth })

  const bands: BandResult[] = []
  const columns: string[] = []
  const viste = new Set<string>()
  let model = 'sconosciuto'
  let provider = input.provider.name

  for (const [posizione, band] of input.bands.entries()) {
    if (posizione > 0 && pauseMs > 0) await sleep(pauseMs)

    let attempt = await tryBand(input.provider, band, prompt, input.daysInMonth, sleep)
    let usedProvider = input.provider.name

    if (!attempt.ok && input.fallback) {
      const riserva = await tryBand(input.fallback, band, prompt, input.daysInMonth, sleep)
      if (riserva.ok) usedProvider = input.fallback.name
      attempt = {
        ...riserva,
        // Se la riserva non ha prodotto nulla di leggibile, il raw output del
        // principale è comunque quello che serve a capire cosa è andato storto.
        rawOutput: riserva.rawOutput ?? attempt.rawOutput,
        attempts: attempt.attempts + riserva.attempts,
      }
    }

    if (attempt.ok) {
      provider = usedProvider
      model = attempt.model ?? model
      for (const colonna of attempt.extraction?.columns ?? []) {
        const chiave = normalizeColumn(colonna)
        if (!viste.has(chiave)) {
          viste.add(chiave)
          columns.push(colonna)
        }
      }
    }

    const risultato: BandResult = {
      index: band.index,
      columnFrom: band.columnFrom,
      columnTo: band.columnTo,
      ok: attempt.ok,
      extraction: attempt.extraction,
      rawOutput: attempt.rawOutput,
      error: attempt.ok ? undefined : attempt.error,
      attempts: attempt.attempts,
    }

    bands.push(risultato)
    if (input.onBand) await input.onBand(risultato)
  }

  return {
    bands,
    failures: bands.filter((b) => !b.ok),
    columns,
    provider,
    model,
    rawOutputs: bands.map((b) => ({ index: b.index, raw: b.rawOutput })),
  }
}
