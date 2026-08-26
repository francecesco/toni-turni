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

export class VisionProviderError extends Error {}
