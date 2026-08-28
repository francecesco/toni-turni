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
 * Punto unico di verità per l identità di una colonna: usata qui per validare
 * (colonna dichiarata, duplicati), dalla fusione delle bande (canone dei nomi e
 * scarto delle colonne che non sono di una persona) e da `scripts/accuracy.ts`
 * per il confronto con la fixture. Non è la forma del valore salvato in
 * `Extraction` — quella resta il testo letto, solo `.trim()` — ma quella su cui
 * si decide se due colonne sono "la stessa".
 *
 * Cade tutto ciò che non è una lettera o una cifra: spazi **e** punteggiatura.
 * Le due cose sono lo stesso problema e vanno collassate insieme, perché il
 * modello scrive quello che vede sul foglio e il foglio non è coerente:
 *
 * - `SARA DP.` letto in una banda e `SARA DP` nell altra spaccava la stessa
 *   infermiera in due colonne da mezzo mese ciascuna, senza nemmeno un
 *   conflitto: metà mese che si stacca dalla persona giusta;
 * - `3°PIANO` letto fra i nomi di colonna (è l intestazione del foglio, in cima
 *   alla striscia dei giorni) si scarta confrontandolo col reparto che arriva
 *   dal chiamante — e chi lo digita scriverà `3° PIANO` o `3 PIANO`, non la
 *   grafia esatta della foto. Col confronto sugli spazi la colonna fantasma
 *   sopravviveva con 31 celle attribuite a una collega che non esiste.
 *
 * Non accorpa per sbaglio: perché due colonne diventino la stessa devono avere
 * le stesse lettere nello stesso ordine, quindi `SARA D.` e `SARA DP` restano
 * distinte. È **una** nozione, non una in più: lo scarto delle colonne di
 * servizio in `band-schema` la riusa tale e quale, senza derivazioni proprie.
 */
export function normalizeColumn(value: string): string {
  return value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

const estrazioneBase = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  ward: z.string().trim().min(1).max(60),
  columns: z.array(z.string().trim().min(1).max(60)).max(40),
  cells: z.array(extractedCellSchema),
})

/**
 * Le invarianti che valgono in ogni punto della pipeline: ogni cella cita una
 * colonna dichiarata, il giorno esiste in quel mese, nessuna coppia
 * giorno/colonna è ripetuta. Stanno in una funzione sola perché sono usate da
 * due schemi e due copie possono divergere in silenzio.
 */
const invarianti: Parameters<typeof estrazioneBase.superRefine>[0] = (value, ctx) => {
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
}

/**
 * Quello che il modello deve restituire per la tabella intera: almeno una
 * colonna, perché una risposta senza colonne è una risposta sbagliata e va
 * riparata o ritentata.
 */
export const extractionSchema = estrazioneBase
  .extend({ columns: z.array(z.string().trim().min(1).max(60)).min(1).max(40) })
  .superRefine(invarianti)

/**
 * Le stesse invarianti su un estrazione che può essere **vuota**: dopo il
 * passaggio alle bande, `columns: []` è la forma legittima di "nessuna banda
 * letta", e rifiutarla all ingresso del database trasformerebbe un buco
 * dichiarato in un errore — cioè perderebbe proprio l informazione che lo stato
 * `partial` esiste per conservare. L unica differenza con `extractionSchema` è
 * quel minimo.
 */
export const storedExtractionSchema = estrazioneBase.superRefine(invarianti)

export type Extraction = z.infer<typeof extractionSchema>
export type ExtractedCell = z.infer<typeof extractedCellSchema>

/**
 * Isola il primo oggetto JSON bilanciato presente nel testo.
 *
 * Esportata perché la serve anche `band-schema`: l estrazione a ritagli riceve
 * lo stesso genere di risposta sporca (recinti markdown, frasi di cortesia) e
 * duplicarne la lettura significherebbe farla divergere.
 */
export function sliceJsonObject(raw: string): string | null {
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
