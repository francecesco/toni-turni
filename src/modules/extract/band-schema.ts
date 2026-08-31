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
  /**
   * Il tetto e quello di una **tabella intera**, non di una banda: alla
   * strategia a chiamata singola la banda e tutta la tabella, e settembre ha 13
   * colonne di contenuto. Un tetto a 12, scritto quando una banda ne portava
   * due, faceva rifiutare l intera lettura per un limite che non riguardava piu
   * niente. 40 e lo stesso tetto di `extractionSchema`: un foglio di reparto con
   * quaranta colonne non esiste, ma non e questo il posto dove accorgersene.
   */
  columns: z.array(z.string().trim().min(1).max(60)).max(40),
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

  const ripulito = scartaColonneSenzaNome(parsed)
  if (!ripulito.ok) return ripulito

  const result = bandExtractionSchema.safeParse(ripulito.value)
  if (!result.success) return { ok: false, error: formatIssues(result.error) }

  return { ok: true, value: result.data }
}

/**
 * Butta via le colonne **senza nome** e le celle che le citano, prima della
 * validazione.
 *
 * Misurato su Gemini, sulla tabella intera: la prima casella dell intestazione —
 * quella sopra la striscia dei giorni — sul foglio e vuota, e il modello la
 * elenca come tale (`"columns": ["3°PIANO", "", "RENATA", ...]`). Con lo schema
 * che pretende nomi non vuoti, quel `""` faceva **rifiutare l intera lettura**:
 * 240 celle buone buttate per una casella senza nome. Con le bande da due
 * colonne non capitava, perche l intestazione della striscia dei giorni non
 * entrava mai nel conto.
 *
 * Le celle attribuite a una colonna senza nome si scartano e **non** si contano
 * fra le lette: non sono assegnabili a nessuna persona, e tenerle creerebbe una
 * colonna fantasma in fase di fusione. Se il modello ci ha messo dentro turni
 * veri, la colonna vera risulta corta e il buco si dichiara: la rete di
 * sicurezza resta quella, non questa tolleranza.
 *
 * Tollerare il nome vuoto non diventa "va bene tutto": se le colonne c erano e
 * **nessuna** aveva un nome leggibile, non c e niente da attribuire, e la
 * lettura e fallita — cosi `tryBand` chiede una riparazione invece di accettare
 * una tabella vuota.
 */
function scartaColonneSenzaNome(
  parsed: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof parsed !== 'object' || parsed === null) return { ok: true, value: parsed }

  const payload = parsed as { columns?: unknown; cells?: unknown }
  const haNome = (value: unknown) => typeof value === 'string' && value.trim() !== ''

  if (!Array.isArray(payload.columns)) return { ok: true, value: parsed }

  const tenute = payload.columns.filter(haNome)
  if (tenute.length === payload.columns.length) return { ok: true, value: parsed }

  if (tenute.length === 0) {
    return {
      ok: false,
      error: 'Nessuna colonna con un nome leggibile: la lettura non e attribuibile a nessuno',
    }
  }

  const celle = Array.isArray(payload.cells)
    ? payload.cells.filter(
        (cella) =>
          typeof cella !== 'object' ||
          cella === null ||
          haNome((cella as { column?: unknown }).column),
      )
    : payload.cells

  return { ok: true, value: { ...payload, columns: tenute, cells: celle } }
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
 *
 * Sopra i tre numeri c è un caso che li scavalca: la banda che **non nomina
 * nulla che non sia di servizio**. Sottrarre per occorrenze non basta, perché
 * due colonne intitolate allo stesso modo il modello le nomina una volta sola —
 * è quello che fa sull ultima banda di agosto, dove `AIUTO MATT.` è stampato
 * due volte e letto una — e `2 - 1 = 1` inventava una colonna che sul foglio non
 * esiste, lasciando la tabella `partial` a ogni caricamento. Quindi: se la
 * banda ha nominato **almeno una** colonna di servizio e **nessuna** colonna di
 * persona, non ha niente da leggere e le attese sono zero.
 *
 * I due bordi di questa regola sono deliberati, ed è dove regge il caso opposto:
 *
 * - basta **una** colonna di persona nominata perché il silenzio decada e torni
 *   il conto dei tre numeri, che non scende mai sotto le colonne geometriche
 *   meno quelle di servizio. La banda mista che risponde corta continua a
 *   dichiarare il buco;
 * - il nome del **reparto** non innesca il silenzio da solo: non è una colonna
 *   del foglio, quindi non prova che non ci fosse niente da leggere. Una banda
 *   che nomina soltanto `3°PIANO` — o che non nomina niente — è una lettura
 *   fallita, e resta un buco dichiarato.
 *
 * ## Sulla tabella intera il pavimento geometrico non si applica
 *
 * Misurato: Gemini ha letto la tabella intera di settembre **perfettamente**, 240
 * celle su 240, e il conto ha dichiarato «240 celle su 270 attese». Il pavimento
 * sottraeva alle **13 colonne geometriche** i **4 nomi di servizio** letti,
 * ottenendo 9 colonne attese invece di 8 — due grandezze che sulla tabella intera
 * non misurano la stessa cosa, per due ragioni entrambe misurate:
 *
 * 1. il foglio stampa **14** colonne di contenuto e la geometria ne rileva **13**,
 *    perché `pruneColumnBoundaries` fonde `TOT M` e `TOT P`;
 * 2. il modello **collassa i nomi doppi**: `AIUTO MATT.` è stampato due volte e
 *    nominato una.
 *
 * Su una banda da due colonne nessuna delle due morde, e il pavimento resta: senza,
 * una banda che salta una collega si dichiarerebbe completa.
 *
 * Quello che sulla tabella intera **continua** a dichiarare il buco è il modo in cui
 * una lettura lunga sbaglia davvero: fermarsi per strada, o leggere una colonna a
 * metà. L'unico caso che smette di essere dichiarato è la collega **mai nominata**,
 * e non sparisce in silenzio: a valle lei legge «Non c'è ancora una colonna
 * associata a te su questa tabella» e la referente vede che la colonna manca.
 * Un avviso che grida al lupo su ogni tabella, invece, insegna a ignorarlo — e
 * allora non protegge più nessuno.
 */
export function countBandCells(
  spec: Pick<BandSpec, 'columns' | 'dayFrom' | 'dayTo' | 'whole'>,
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
  // tutto quello che la banda ha nominato è di servizio: non ha colonne da
  // leggere, quante ne mostri la geometria non conta
  const soloDiServizio = servizioDistinte.size > 0 && diPersona.size === 0

  // Sulla **tabella intera** il pavimento geometrico non si applica: vedi il
  // paragrafo «Sulla tabella intera» nella documentazione qui sopra.
  const pavimento = spec.whole === true ? 0 : geometriche - scartate
  const attese = soloDiServizio
    ? 0
    : Math.min(geometriche, Math.max(diPersona.size, pavimento))

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
