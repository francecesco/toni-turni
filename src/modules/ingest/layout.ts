import { medianGap } from './grid-numeric'

/**
 * Le costanti geometriche del modulo cartaceo che **nessuno rileva**.
 *
 * I confini di colonna non stanno qui: arrivano misurati da `detectTableQuad`,
 * perché frazioni fisse del riquadro non trasferiscono da una foto all'altra
 * (la foto di agosto taglia il foglio, quindi l'area delle infermiere ne occupa
 * 0,693 contro 0,552 su settembre: scarto 0,159 contro una soglia di 0,03).
 * Quello che resta è la struttura verticale, che invece è la stessa.
 */
export interface RosterLayout {
  /**
   * Dove finisce l'intestazione e cominciano le righe dei giorni, in frazione
   * dell'altezza del riquadro. Serve all'aritmetica del taglio del mese.
   */
  headerHeight: number
  /**
   * Altezza della striscia d'intestazione anteposta alla seconda metà del mese.
   * Un filo più di `headerHeight`, così la riga dei nomi non viene rasata; il
   * poco che ruba alla prima riga di giorni non fa danno, perché quella riga
   * sta per intero nella banda della prima metà.
   */
  headerStrip: number
  /** Sovrapposizione fra le due metà del mese, in frazione dell'altezza. */
  monthOverlap: number
  /**
   * Sotto quale frazione della distanza mediana due confini consecutivi non
   * possono essere due colonne del modulo.
   */
  boundaryMinRatio: number
}

/**
 * Misurato sulle due foto reali, sui riquadri rilevati e raddrizzati (agosto a
 * 1600x1491, settembre a 1600x1113), individuando i filetti orizzontali col
 * profilo di luminosità media:
 *
 * - `headerHeight`: le righe dei giorni cominciano a 95/1491 = 0,0637 su agosto
 *   e a 74/1113 = 0,0665 su settembre. Il default è la media, 0,065. Con questo
 *   valore il filetto di metà mese calcolato per interpolazione cade a 0,547
 *   contro 0,544 misurato su agosto e a 0,533 contro 0,536 su settembre: dentro
 *   un decimo di riga, e la sovrapposizione copre il resto.
 * - `headerStrip`: la riga dei nomi finisce a 0,0637 (agosto) e 0,0665
 *   (settembre); 0,075 la prende intera in entrambe con un margine di sicurezza.
 * - `monthOverlap`: 0,022 è **0,73 righe** su agosto e 0,70 su settembre (una
 *   riga vale 0,03018 e 0,03145). Serve tanto perché la cucitura è calcolata e
 *   il filetto vero sta altrove: misurato sui filetti del raddrizzato, la
 *   cucitura cade a 0,5476 contro 0,5433 su agosto (+0,143 righe) e a 0,5325
 *   contro 0,5355 su settembre (−0,095 righe). Con 0,012 il margine peggiore fra
 *   il filetto vero e il bordo della banda che lo possiede era **0,254 righe**:
 *   un quarto di riga di tolleranza su un modulo cartaceo che può cambiare, e il
 *   guasto è mezza riga di giorno tagliata via. Con 0,022 i quattro margini
 *   misurati sono 0,87 e 0,59 righe su agosto, 0,61 e 0,80 su settembre, cioè un
 *   peggiore di **0,59 righe**: più di mezza riga, quindi nemmeno un errore da
 *   mezza riga nella previsione della cucitura taglia la riga del giorno di
 *   cucitura. Il prezzo è un terzo di riga in più di riga vicina dentro ogni
 *   banda, che il modello scarta perché il giorno lo legge dalla striscia.
 * - `boundaryMinRatio`: vedi `pruneColumnBoundaries`.
 */
export const DEFAULT_ROSTER_LAYOUT: RosterLayout = {
  headerHeight: 0.065,
  headerStrip: 0.075,
  monthOverlap: 0.022,
  boundaryMinRatio: 0.65,
}

/**
 * Ripulisce i confini di colonna rilevati scartando quelli **troppo vicini** al
 * confine tenuto che li precede: due filetti a meno di `minRatio` della
 * distanza mediana non possono delimitare due colonne del modulo.
 *
 * I numeri che scelgono 0,65, misurati su entrambe le foto (distanze espresse
 * in multipli della distanza mediana fra confini consecutivi):
 *
 * | distanza dal confine precedente tenuto | agosto | settembre |
 * |---|---|---|
 * | confini da scartare, la peggiore | 0,442 (0,5442, artefatto) | **0,533** (0,0902, artefatto) |
 * | confini da tenere, la più corta | 0,815 (blocco dei giorni) | **0,767** (blocco dei giorni) |
 * | la colonna d'infermiera più stretta | 0,839 (ALEX) | 0,859 (ALEX) |
 *
 * Fra 0,533 e 0,767 non c'è nulla: 0,65 sta in mezzo, con un margine di 1,22x
 * verso il basso e 1,18x verso l'alto. La colonna d'infermiera più stretta è a
 * 0,839, cioè un altro 29% di margine oltre il caso peggiore da tenere.
 *
 * Non tutti gli scartati sono artefatti: 0,0289 (agosto) e 0,0217 (settembre)
 * sono il filetto vero fra numero del giorno e giorno della settimana, e 0,9684
 * (settembre) quello fra `TOT M` e `TOT P`. Buttarli non costa niente — il
 * blocco dei giorni entra intero in ogni banda e le colonne di servizio si
 * scartano per nome — mentre tenerli spezzerebbe il blocco dei giorni in due.
 *
 * Lo scarto è greedy da sinistra e i due lati del riquadro restano sempre:
 * sono confini per costruzione, non misure. Se il penultimo confine tenuto
 * finisce troppo vicino al lato destro, si butta lui e non il lato.
 *
 * Nessun confine viene **spostato**: fondere due confini nella loro media
 * sposterebbe quello vero di mezza colonna, che è esattamente il danno da
 * evitare. Si tiene il primo dei due e si scarta l'altro.
 */
export function pruneColumnBoundaries(
  columns: readonly number[],
  minRatio: number = DEFAULT_ROSTER_LAYOUT.boundaryMinRatio,
): number[] {
  if (columns.length < 2) {
    throw new Error(
      `Servono almeno due confini per delimitare una colonna, ricevuti ${columns.length}`,
    )
  }

  const minimo = medianGap(columns) * minRatio
  const tenuti = [columns[0]]

  for (let i = 1; i < columns.length - 1; i += 1) {
    if (columns[i] - tenuti[tenuti.length - 1] >= minimo) tenuti.push(columns[i])
  }

  const destro = columns[columns.length - 1]
  while (tenuti.length > 1 && destro - tenuti[tenuti.length - 1] < minimo) tenuti.pop()
  tenuti.push(destro)

  return tenuti
}

/** Un ritaglio in frazioni del riquadro raddrizzato. */
export interface Crop {
  left: number
  top: number
  width: number
  height: number
}

export interface BandSpec {
  /**
   * Indici delle colonne di contenuto della banda, riferiti ai confini
   * **ripuliti**: 0 è il blocco dei giorni, che non è mai una colonna di
   * contenuto perché entra in ogni banda.
   *
   * Sono indici di posizione e non identità: a valle le celle vanno chiavate
   * sul nome che il modello legge nell'intestazione della banda, così una banda
   * che slittasse di una colonna resta autocorrettiva.
   */
  columns: number[]
  dayFrom: number
  dayTo: number
  /**
   * La striscia del blocco dei giorni, da comporre **a sinistra** del ritaglio.
   * È sempre la colonna 0, cioè i due lati del blocco dei giorni: quel blocco
   * serve in ogni banda, perché è l'unica cosa che dice a quale giorno
   * appartiene una cella.
   *
   * Non ha `top` né `height` perché prende quelli del ritaglio: è la ragione per
   * cui la composizione è esatta invece di approssimata. Le due strisce sono
   * tagliate dalla stessa immagine raddrizzata, alla stessa ordinata e con la
   * stessa altezza, quindi le loro righe combaciano riga per riga senza
   * registrazione — e dopo il warp dell'omografia le righe sono orizzontali per
   * costruzione, quindi non c'è nemmeno una deriva prospettica da compensare.
   */
  days: { left: number; width: number }
  /** Il ritaglio delle sole colonne del gruppo, righe dei giorni. */
  crop: Crop
  /**
   * Striscia d'intestazione da anteporre alla banda, o `null` se l'intestazione
   * è già dentro (prima metà del mese). Vale per **entrambe** le strisce
   * affiancate: si taglia alla stessa `left`/`width` di `days` e a quelle di
   * `crop`, e le due metà si compongono nello stesso ordine, quindi le colonne
   * dell'intestazione stanno sopra le colonne a cui appartengono.
   */
  header: { top: number; height: number } | null
}

/**
 * Pianifica le bande verticali da mandare al modello una alla volta.
 *
 * Ogni banda è la **composizione** di due strisce: il blocco dei giorni e le
 * colonne del gruppo, affiancate. Non un unico ritaglio che parte dal lato
 * sinistro del riquadro: quello faceva crescere la larghezza di gruppo in
 * gruppo, e l'ultima banda mostrava mezza tabella intera — cioè la stessa
 * configurazione che, misurata, dà il 18,5% di celle corrette. Composta, ogni
 * banda ha la forma misurata al 100% (blocco dei giorni più due colonne) e una
 * dimensione praticamente costante fra le bande.
 *
 * La composizione è esatta perché le due strisce sono tagliate dalla stessa
 * immagine **già raddrizzata**, alla stessa ordinata e con la stessa altezza:
 * dopo il warp dell'omografia le righe sono orizzontali per costruzione, quindi
 * non c'è nessuno sfasamento fra la riga del giorno a sinistra e la cella a
 * destra. È la stessa tecnica già usata per la striscia d'intestazione.
 *
 * Ogni banda mostra anche la riga dei nomi, perché è su quel nome che si
 * chiavano le celle.
 *
 * Il mese si taglia in due metà: il filetto di metà mese è l'unico praticamente
 * orizzontale in entrambe le foto, quindi è la cucitura meno rischiosa.
 *
 * Le colonne di servizio (`AIUTO MATT.`, `TOT M`…) finiscono in qualche banda e
 * va bene: si scartano **per nome** in fase di fusione. Chiedere alla geometria
 * quali colonne siano delle infermiere è il difetto che è già stato rimosso dal
 * rilevatore, e per questo il numero di bande non è fisso ma dipende da quante
 * colonne ha la foto.
 */
export function planBands(
  columns: readonly number[],
  options: {
    daysInMonth: number
    headerHeight?: number
    columnsPerBand?: number
    overlap?: number
  },
): BandSpec[] {
  const { daysInMonth } = options
  if (!Number.isInteger(daysInMonth) || daysInMonth < 28 || daysInMonth > 31) {
    throw new Error(`Numero di giorni non plausibile per un mese: ${daysInMonth}`)
  }

  const headerHeight = options.headerHeight ?? DEFAULT_ROSTER_LAYOUT.headerHeight
  const overlap = options.overlap ?? DEFAULT_ROSTER_LAYOUT.monthOverlap
  const columnsPerBand = options.columnsPerBand ?? 2

  const bordi = pruneColumnBoundaries(columns)
  const colonne = bordi.length - 1
  if (colonne < 2) {
    throw new Error(
      `Servono almeno due colonne (il blocco dei giorni e una di contenuto), trovate ${colonne}`,
    )
  }

  // Le righe dei giorni sono regolari, quindi il filetto dopo il giorno `metà`
  // sta a questa frazione dell'altezza del riquadro.
  const meta = Math.ceil(daysInMonth / 2)
  const cucitura = headerHeight + (1 - headerHeight) * (meta / daysInMonth)

  const meta_mese = [
    {
      dayFrom: 1,
      dayTo: meta,
      // dal bordo alto: l'intestazione con i nomi è già dentro
      top: 0,
      bottom: Math.min(1, cucitura + overlap),
      header: null,
    },
    {
      dayFrom: meta + 1,
      dayTo: daysInMonth,
      top: Math.max(0, cucitura - overlap),
      bottom: 1,
      header: { top: 0, height: DEFAULT_ROSTER_LAYOUT.headerStrip },
    },
  ] as const

  const bande: BandSpec[] = []

  // la colonna 0 è il blocco dei giorni: si affianca a ogni banda, non fa gruppo
  const giorni = { left: bordi[0], width: bordi[1] - bordi[0] }

  for (let prima = 1; prima < colonne; prima += columnsPerBand) {
    const gruppo: number[] = []
    for (let c = prima; c < Math.min(prima + columnsPerBand, colonne); c += 1) gruppo.push(c)

    const sinistra = bordi[gruppo[0]]
    const destra = bordi[gruppo[gruppo.length - 1] + 1]

    for (const meta of meta_mese) {
      bande.push({
        columns: gruppo,
        dayFrom: meta.dayFrom,
        dayTo: meta.dayTo,
        days: giorni,
        crop: {
          left: sinistra,
          top: meta.top,
          width: destra - sinistra,
          height: meta.bottom - meta.top,
        },
        header: meta.header,
      })
    }
  }

  return bande
}
