import { z } from 'zod'
import type { BandSpec } from '@/modules/ingest/layout'
import {
  extractedCellSchema,
  normalizeColumn,
  sliceJsonObject,
  type ExtractedCell,
  type Extraction,
} from './schema'

/**
 * Quello che una **banda** può dire, che è meno di quello che dice la tabella
 * intera: `year`, `month` e `ward` stanno nell intestazione del foglio e una
 * banda non li mostra, quindi non si chiedono — chiederli inviterebbe soltanto
 * a inventarli. Arrivano dal chiamante in fase di fusione.
 */
export const bandExtractionSchema = z.object({
  columns: z.array(z.string().trim().min(1).max(60)).max(12),
  cells: z.array(extractedCellSchema),
})

export type BandExtraction = z.infer<typeof bandExtractionSchema>

/**
 * I nomi delle colonne che non sono assegnazioni di turno. Finiscono in qualche
 * banda per costruzione — la geometria non decide la semantica — e si scartano
 * **per nome** in fase di fusione, non per indice.
 */
const COLONNE_DI_SERVIZIO = ['AIUTO MATT.', 'AIUTO POM.', 'TOT M', 'TOT P']

/**
 * Identità di una colonna ai soli fini dello scarto: `normalizeColumn` (l unico
 * punto di verità sull identità di colonna, riusato tale e quale) più la
 * caduta del punto di abbreviazione, che il modello mette o non mette a seconda
 * di come è scritto sul foglio.
 */
function chiaveDiServizio(name: string): string {
  return normalizeColumn(name).replace(/\./g, '')
}

const SERVIZIO = new Set(COLONNE_DI_SERVIZIO.map(chiaveDiServizio))

/**
 * Vero per le colonne che non sono l assegnazione di turno di una persona.
 *
 * Le colonne di aiuto e di totale: il prefisso `AIUTO` copre anche le forme non
 * abbreviate (`AIUTO MATTINO`): nessuna colonna di persona si intitola così,
 * mentre una colonna di aiuto letta per intero, se sopravvivesse, finirebbe in
 * calendario come se fosse un turno.
 *
 * E il **reparto**: `3°PIANO` è l intestazione del foglio, in cima alla striscia
 * dei giorni, e la misura di agosto l ha visto comparire fra i nomi di colonna
 * di qualche banda, producendo 31 celle per una collega che non esiste. Il nome
 * da scartare arriva dal chiamante (`header.ward`), non da un indovinello su
 * cosa sembri un nome di persona.
 */
function isColonnaDiServizio(name: string, ward: string): boolean {
  const chiave = chiaveDiServizio(name)
  if (chiave.startsWith('AIUTO') || SERVIZIO.has(chiave)) return true

  const reparto = chiaveDiServizio(ward)
  return reparto.length > 0 && chiave === reparto
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'radice'}: ${issue.message}`)
    .join('; ')
}

/**
 * Come `parseExtraction`, ma sullo schema di una singola banda: i modelli
 * incartano il JSON in recinti markdown e frasi di cortesia, quindi si isola
 * l oggetto invece di pretendere una risposta pulita.
 */
export function parseBandExtraction(
  raw: string,
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
  if (!result.success) return { ok: false, error: formatIssues(result.error) }

  return { ok: true, value: result.data }
}

/** Due codici sono lo stesso se differiscono solo per spazi o maiuscole. */
function stessoCodice(a: string, b: string): boolean {
  return normalizeColumn(a) === normalizeColumn(b)
}

/**
 * Fonde le bande in un unica `Extraction`.
 *
 * **Le celle si chiavano sul nome di colonna che il modello legge
 * nell intestazione della banda, mai sull indice.** Ogni banda porta in cima la
 * striscia con i nomi proprio perché il modello li legga: se una banda slitta
 * di una colonna per un errore geometrico, l errore si autocorregge, perché il
 * nome viene dall immagine e non dal conteggio. Per questo `spec.columns` non
 * entra qui: quegli indici dicono quali bande coprono cosa, non come si chiama
 * una colonna.
 *
 * Le regole, nell ordine in cui contano:
 *
 * 1. Le colonne che non sono di una persona — quelle di servizio (`AIUTO
 *    MATT.`, `TOT M`…) e il nome del reparto, che è l intestazione del foglio —
 *    si scartano **per nome** normalizzato. Una colonna scartata non è un
 *    conflitto: era attesa.
 * 2. Una cella con giorno fuori dall intervallo dichiarato della banda si
 *    scarta **ed è un conflitto**: il modello ha letto una riga che non gli era
 *    stata data, quindi non si sa quale riga abbia letto davvero.
 * 3. Le due metà del mese si sovrappongono di una riga, quindi la stessa cella
 *    può arrivare da due bande: vince la confidenza più alta, a parità la
 *    prima. Se i due codici sono diversi è un conflitto, anche se risolto.
 * 4. `year`, `month` e `ward` vengono dal chiamante.
 *
 * `columns` è l unione ordinata dei nomi letti (prima apparizione), e ogni
 * cella cita per costruzione una colonna dichiarata — l invariante che pretende
 * `extractionSchema`, quindi la fusione produce un estrazione che passa la
 * validazione completa.
 */
export function mergeBandExtractions(
  results: Array<{ spec: BandSpec; extraction: BandExtraction }>,
  header: { year: number; month: number; ward: string },
): { extraction: Extraction; conflicts: number } {
  // chiave normalizzata -> nome come letto la prima volta. È il canone: due
  // grafie della stessa persona ("ANNA LIA" / "Anna  Lia") non devono diventare
  // due colonne, né due `columnLabel` diversi nel database.
  const nomi = new Map<string, string>()
  const celle = new Map<string, ExtractedCell>()
  let conflicts = 0

  function canonico(name: string): string | null {
    if (isColonnaDiServizio(name, header.ward)) return null
    const chiave = normalizeColumn(name)
    const esistente = nomi.get(chiave)
    if (esistente !== undefined) return esistente
    const canone = name.trim()
    nomi.set(chiave, canone)
    return canone
  }

  for (const { spec, extraction } of results) {
    // prima i nomi dichiarati nell intestazione, così l ordine di `columns`
    // segue la tabella e non l ordine in cui il modello ha elencato le celle
    for (const name of extraction.columns) canonico(name)

    for (const cell of extraction.cells) {
      if (cell.day < spec.dayFrom || cell.day > spec.dayTo) {
        conflicts += 1
        continue
      }

      const colonna = canonico(cell.column)
      if (colonna === null) continue

      const chiave = `${cell.day}:${normalizeColumn(colonna)}`
      const presente = celle.get(chiave)
      const candidata: ExtractedCell = { ...cell, column: colonna }

      if (presente === undefined) {
        celle.set(chiave, candidata)
        continue
      }

      if (!stessoCodice(presente.code, candidata.code)) conflicts += 1
      if (candidata.confidence > presente.confidence) celle.set(chiave, candidata)
    }
  }

  return {
    extraction: {
      year: header.year,
      month: header.month,
      ward: header.ward,
      columns: [...nomi.values()],
      cells: [...celle.values()],
    },
    conflicts,
  }
}
