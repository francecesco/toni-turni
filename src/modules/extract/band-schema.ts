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
 * Le chiavi delle colonne di servizio, secondo l unica nozione di identità di
 * colonna del progetto (`normalizeColumn`, che collassa spazi e punteggiatura):
 * qui non c è nessuna derivazione in più, perché una seconda nozione può
 * divergere dalla prima senza che nessuno se ne accorga.
 */
const SERVIZIO = new Set(COLONNE_DI_SERVIZIO.map(normalizeColumn))

/**
 * Vero per le colonne di **servizio**: le colonne di aiuto e di totale.
 *
 * Il prefisso `AIUTO` copre anche le forme non abbreviate (`AIUTO MATTINO`):
 * nessuna colonna di persona si intitola così, mentre una colonna di aiuto
 * letta per intero, se sopravvivesse, finirebbe in calendario come se fosse un
 * turno.
 *
 * Sono colonne **stampate sul foglio**: occupano una colonna della geometria, e
 * per questo il conteggio delle celle attese di una banda può sottrarle (vedi
 * `countBandCells`).
 *
 * Esportata perché la usa anche la Fase 3 (`modules/review`): la griglia di
 * conferma deve riconoscere una colonna di servizio che fosse sopravvissuta alla
 * fusione, e una seconda nozione di "colonna di servizio" divergerebbe dalla
 * prima senza che nessuno se ne accorga.
 */
export function isColonnaDiServizio(name: string): boolean {
  const chiave = normalizeColumn(name)
  return chiave.startsWith('AIUTO') || SERVIZIO.has(chiave)
}

/**
 * Vero per il nome del **reparto**: `3°PIANO` è l intestazione del foglio, in
 * cima alla striscia dei giorni, e la misura di agosto l ha visto comparire fra
 * i nomi di colonna di qualche banda, producendo 31 celle per una collega che
 * non esiste. Il nome arriva dal chiamante (`header.ward`), non da un
 * indovinello su cosa sembri un nome di persona.
 *
 * **Non è una colonna del foglio**, ed è la differenza che conta per
 * `countBandCells`: scartarlo non libera nessuna colonna della geometria.
 */
function isNomeDelReparto(name: string, ward: string): boolean {
  const reparto = normalizeColumn(ward)
  return reparto.length > 0 && normalizeColumn(name) === reparto
}

/** Vero per le colonne che non sono l assegnazione di turno di una persona. */
function isColonnaDaScartare(name: string, ward: string): boolean {
  return isColonnaDiServizio(name) || isNomeDelReparto(name, ward)
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

/**
 * Quante delle celle **chieste** la banda ha davvero prodotto, quante ne erano
 * attese e su quante colonne.
 *
 * Serve a trasformare una risposta valida e **corta** in un buco dichiarato:
 * nella Fase 2A questo stesso modello ometteva 199 celle su 248 con risposte
 * che passavano la validazione, e una banda letta a metà è peggio di una banda
 * non letta perché somiglia a un foglio con le celle vuote.
 *
 * Le **lette** si contano sugli incroci distinti dentro l intervallo di giorni,
 * non sulle righe di JSON — una cella ripetuta e una cella fuori intervallo non
 * riempiono il buco che lasciano le celle mancanti — e **senza** le colonne che
 * la fusione scarta: quelle celle non arrivano da nessuna parte, quindi non
 * possono nemmeno riempire un buco.
 *
 * Le **attese** sono giorni per colonne, ma non per le colonne *geometriche*
 * della banda: per quelle che restano dopo lo scarto. La geometria non decide la
 * semantica, quindi una banda può mostrare colonne che verranno scartate per
 * nome, e contarle fra le attese fa gridare al lupo (misurato su settembre:
 * quattro bande su quattordici dichiaravano un buco che non c era). Il conto
 * delle colonne attese sta fra tre numeri, in questo ordine:
 *
 * 1. le colonne **geometriche** della banda (`spec.columns.length`) sono il
 *    tetto: se il modello nomina una colonna in più, se l è inventata;
 * 2. si sottraggono le colonne di **servizio** riconosciute per nome, che sono
 *    stampate sul foglio e quindi occupano una colonna della geometria. Si
 *    contano per **occorrenze** nell intestazione, non per nomi distinti,
 *    perché due colonne possono essere intitolate allo stesso modo — su
 *    entrambe le foto reali `AIUTO MATT.` compare due volte di fila — e si
 *    incrocia col numero di nomi di servizio distinti visti anche fra le celle,
 *    così una banda che li nomina in un solo modo non ne perde il conto. Il
 *    nome del **reparto** non si sottrae: non è una colonna del foglio;
 * 3. il risultato non scende mai sotto il numero di colonne **di persona**
 *    davvero viste. È la difesa da non annacquare: se le attese si contassero
 *    solo sulle colonne che a valle si scoprono utili, la banda che salta una
 *    collega intera si dichiarerebbe completa e i suoi turni sparirebbero in
 *    silenzio.
 */
export function countBandCells(
  spec: Pick<BandSpec, 'columns' | 'dayFrom' | 'dayTo'>,
  extraction: BandExtraction,
  ward: string,
): { read: number; expected: number; columns: number } {
  const geometriche = spec.columns.length

  let servizioInIntestazione = 0
  for (const name of extraction.columns) {
    if (isColonnaDiServizio(name)) servizioInIntestazione += 1
  }

  const servizioDistinte = new Set<string>()
  const diPersona = new Set<string>()
  const viste = new Set<string>()

  function classifica(name: string): void {
    if (isColonnaDiServizio(name)) servizioDistinte.add(normalizeColumn(name))
    else if (!isNomeDelReparto(name, ward)) diPersona.add(normalizeColumn(name))
  }

  for (const name of extraction.columns) classifica(name)

  for (const cell of extraction.cells) {
    classifica(cell.column)
    if (cell.day < spec.dayFrom || cell.day > spec.dayTo) continue
    if (isColonnaDaScartare(cell.column, ward)) continue
    viste.add(`${cell.day}:${normalizeColumn(cell.column)}`)
  }

  const scartate = Math.min(
    geometriche,
    Math.max(servizioInIntestazione, servizioDistinte.size),
  )
  const attese = Math.min(geometriche, Math.max(diPersona.size, geometriche - scartate))

  return {
    read: viste.size,
    expected: (spec.dayTo - spec.dayFrom + 1) * attese,
    columns: attese,
  }
}

/**
 * Due codici sono lo stesso se differiscono solo per spazi o maiuscole.
 *
 * È l identità di un **codice turno**, non di una colonna, e per questo non
 * riusa `normalizeColumn`: quella elimina la punteggiatura, e in un codice la
 * punteggiatura conta (`M 1°P` non è `M1P`). La nozione autorevole per i codici
 * è `compactCode` in `modules/codes`, che non si importa qui per non far
 * dipendere l estrazione dalla legenda; questo confronto resta quindi
 * volutamente **conservativo** — segnala un conflitto in più, mai uno in meno,
 * e un conflitto è una bandiera, non uno scarto.
 */
function stessoCodice(a: string, b: string): boolean {
  const compatta = (value: string) => value.trim().toUpperCase().replace(/\s+/g, ' ')
  return compatta(a) === compatta(b)
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
 *    si scartano **per nome** normalizzato, con l unica nozione di identità di
 *    colonna del progetto: spazi e punteggiatura non contano, quindi il reparto
 *    si riconosce anche se il chiamante lo scrive `3° PIANO`. Una colonna
 *    scartata non è un conflitto: era attesa.
 * 2. Una cella con giorno fuori dall intervallo dichiarato della banda si
 *    scarta **ed è un conflitto**: il modello ha letto una riga che non gli era
 *    stata data, quindi non si sa quale riga abbia letto davvero.
 * 3. Se la stessa cella arriva da due bande vince la confidenza più alta, a
 *    parità la prima; se i due codici sono diversi è un conflitto, anche se
 *    risolto. **Oggi in produzione questo ramo non scatta**: le due metà del
 *    mese si sovrappongono in pixel (`monthOverlap`) ma gli intervalli di giorni
 *    che dichiarano sono disgiunti (1-16 e 17-31), quindi nessuna cella arriva
 *    due volte. Resta perché è la regola che serve appena due bande si
 *    sovrapporranno davvero — far dichiarare a ciascuna metà un giorno in comune
 *    richiede prima che i pixel ne mostrino la riga **intera**, e con la
 *    sovrapposizione attuale (0,7 righe) non la mostrano: la banda chiederebbe
 *    una riga che non si vede, il modello la ometterebbe e il controllo sul
 *    conteggio delle celle dichiarerebbe un buco che non c è.
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
    if (isColonnaDaScartare(name, header.ward)) return null
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
