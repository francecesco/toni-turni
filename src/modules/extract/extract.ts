import { buildExtractionPrompt, buildRepairPrompt } from './prompt'
import { parseExtraction, type Extraction } from './schema'
import { VisionProviderError, type VisionProvider } from './providers'

export type ExtractionOutcome =
  | {
      ok: true
      extraction: Extraction
      rawOutput: string
      provider: string
      model: string
      attempts: number
    }
  | { ok: false; error: string; rawOutput: string | null; attempts: number }

interface ProviderAttempt {
  ok: boolean
  extraction?: Extraction
  rawOutput: string | null
  model?: string
  error?: string
  attempts: number
}

/**
 * Un provider ha due possibilità: la prima chiamata e, se l output non passa la
 * validazione, una richiesta di riparazione con l errore in mano. Un errore del
 * provider (quota, rete) non è un problema di formato: non si riprova, si passa
 * eventualmente alla riserva.
 */
async function tryProvider(
  provider: VisionProvider,
  image: Buffer,
  prompt: string,
): Promise<ProviderAttempt> {
  let attempts = 0
  let lastRaw: string | null = null
  let lastError = 'Estrazione non riuscita'

  for (let round = 0; round < 2; round += 1) {
    attempts += 1

    let result
    try {
      // Il prompt di estrazione (schema, colonne da ignorare, regola sulla
      // confidenza) resta sempre il primo turno: nel giro di riparazione si
      // aggiunge solo l ultimo output e l istruzione di correggerlo, senza
      // sostituire né duplicare le specifiche.
      const previousTurns =
        round === 0
          ? undefined
          : [
              { role: 'assistant' as const, text: lastRaw ?? '' },
              { role: 'user' as const, text: buildRepairPrompt(lastRaw ?? '', lastError) },
            ]
      result = await provider.extract({ image, prompt, previousTurns })
    } catch (error) {
      const message = error instanceof VisionProviderError ? error.message : String(error)
      return { ok: false, rawOutput: lastRaw, error: message, attempts }
    }

    lastRaw = result.raw
    const parsed = parseExtraction(result.raw)
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

export async function extractRoster(input: {
  image: Buffer
  knownCodes: string[]
  provider: VisionProvider
  fallback?: VisionProvider | null
}): Promise<ExtractionOutcome> {
  const prompt = buildExtractionPrompt(input.knownCodes)

  const primary = await tryProvider(input.provider, input.image, prompt)
  if (primary.ok && primary.extraction && primary.rawOutput !== null) {
    return {
      ok: true,
      extraction: primary.extraction,
      rawOutput: primary.rawOutput,
      provider: input.provider.name,
      model: primary.model ?? 'sconosciuto',
      attempts: primary.attempts,
    }
  }

  if (input.fallback) {
    const secondary = await tryProvider(input.fallback, input.image, prompt)
    if (secondary.ok && secondary.extraction && secondary.rawOutput !== null) {
      return {
        ok: true,
        extraction: secondary.extraction,
        rawOutput: secondary.rawOutput,
        provider: input.fallback.name,
        model: secondary.model ?? 'sconosciuto',
        attempts: primary.attempts + secondary.attempts,
      }
    }
    return {
      ok: false,
      error: secondary.error ?? 'Estrazione non riuscita',
      rawOutput: secondary.rawOutput,
      attempts: primary.attempts + secondary.attempts,
    }
  }

  return {
    ok: false,
    error: primary.error ?? 'Estrazione non riuscita',
    rawOutput: primary.rawOutput,
    attempts: primary.attempts,
  }
}
