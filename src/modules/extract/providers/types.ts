export interface VisionRequest {
  image: Buffer
  prompt: string
  /** Turni precedenti, usati per chiedere la riparazione di un output non valido. */
  previousTurns?: Array<{ role: 'assistant' | 'user'; text: string }>
}

export interface VisionResult {
  raw: string
  model: string
  provider: string
}

export interface VisionProvider {
  readonly name: string
  extract(request: VisionRequest): Promise<VisionResult>
}

export interface VisionProviderErrorOptions extends ErrorOptions {
  /** Stato HTTP della risposta, quando l errore viene da una chiamata di rete. */
  status?: number
  /** Secondi indicati dall header `retry-after`, quando presente (tipico di un 429). */
  retryAfterSeconds?: number
}

export class VisionProviderError extends Error {
  readonly status?: number
  readonly retryAfterSeconds?: number

  constructor(message: string, options?: VisionProviderErrorOptions) {
    super(message, options)
    this.status = options?.status
    this.retryAfterSeconds = options?.retryAfterSeconds
  }
}

/**
 * La risposta del modello è stata tagliata dal limite di token di output: non è un
 * problema di formato, e rimandare la stessa immagine con un prompt di riparazione
 * non farebbe che troncare di nuovo (consumando quota inutilmente).
 */
export class VisionTruncatedError extends VisionProviderError {}
