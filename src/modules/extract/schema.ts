import { z } from 'zod'

export const extractedCellSchema = z.object({
  day: z.number().int().min(1).max(31),
  column: z.string().trim().min(1).max(60),
  /** Testo della cella come letto dalla foto; vuoto se la cella è vuota. */
  code: z.string().trim().max(20),
  confidence: z.number().min(0).max(1),
  /** Il modello ha visto una correzione a penna o col correttore. */
  handCorrected: z.boolean(),
})

/**
 * Forma usata solo per confrontare identità di colonna, non per il valore salvato:
 * uno spazio doppio fra nome e cognome, o uno spazio residuo dopo il `.trim()` del
 * campo, non deve far sembrare due colonne diverse ("ANNA LIA" / "ANNA  LIA").
 */
function normalizeColumn(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ')
}

export const extractionSchema = z
  .object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    ward: z.string().trim().min(1).max(60),
    columns: z.array(z.string().trim().min(1).max(60)).min(1).max(40),
    cells: z.array(extractedCellSchema),
  })
  .superRefine((value, ctx) => {
    const dichiarate = new Set(value.columns.map(normalizeColumn))
    const viste = new Set<string>()
    const giorniNelMese = new Date(value.year, value.month, 0).getDate()

    for (const cell of value.cells) {
      if (!dichiarate.has(normalizeColumn(cell.column))) {
        // 'custom' come stringa funziona sia in Zod 3 sia in Zod 4, dove
        // z.ZodIssueCode non esiste più.
        ctx.addIssue({
          code: 'custom',
          message: `La cella cita una colonna non dichiarata: ${cell.column}`,
        })
      }

      if (cell.day > giorniNelMese) {
        ctx.addIssue({
          code: 'custom',
          message: `Il giorno ${cell.day} non esiste nel mese ${value.month}/${value.year} (che ne ha ${giorniNelMese})`,
        })
      }

      const chiave = `${cell.day}:${normalizeColumn(cell.column)}`
      if (viste.has(chiave)) {
        ctx.addIssue({
          code: 'custom',
          message: `Cella duplicata per giorno e colonna: ${chiave}`,
        })
      }
      viste.add(chiave)
    }
  })

export type Extraction = z.infer<typeof extractionSchema>
export type ExtractedCell = z.infer<typeof extractedCellSchema>

/** Isola il primo oggetto JSON bilanciato presente nel testo. */
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

/**
 * I modelli aggiungono spesso una frase di cortesia o dei recinti markdown attorno
 * al JSON: si isola l oggetto invece di pretendere una risposta pulita.
 */
export function parseExtraction(
  raw: string,
): { ok: true; value: Extraction } | { ok: false; error: string } {
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

  const result = extractionSchema.safeParse(parsed)
  if (!result.success) {
    const messaggi = result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'radice'}: ${issue.message}`,
    )
    return { ok: false, error: messaggi.join('; ') }
  }

  return { ok: true, value: result.data }
}
