import sharp from 'sharp'
import { warpPerspective, type Point } from '@/lib/homography'
import { detectTableQuad } from './grid'
import { planBands, planWholeTable, pruneColumnBoundaries, type BandSpec } from './layout'

/**
 * Larghezza del riquadro raddrizzato. Sui riquadri delle due foto reali (1148 e
 * 1495 px di larghezza nella foto) è un ingrandimento fra 1,07x e 1,39x: abbastanza
 * generoso perché il ricampionamento delle bande non parta già in perdita, e non
 * tanto da far pesare il raddrizzamento.
 */
const DEFAULT_DESKEW_WIDTH = 1600

/** Qualità JPEG delle bande e del raddrizzato. */
const DEFAULT_QUALITY = 88

/**
 * Altezza a cui si porta ogni banda. La leggibilità non dipende dalla larghezza
 * ma dai **pixel per riga**, e le righe per banda sono le stesse su entrambe le
 * foto (mezzo mese più le due righe d'intestazione, cioè 17-18): il riferimento
 * è il ritaglio letto al 100%, alto 1313 px per 17 righe circa.
 */
const TARGET_BAND_HEIGHT = 1300

/**
 * Tetto ai pixel di una banda. Il ritaglio misurato al 100% era 700x1313 = 0,92
 * Mpx e costava circa 4020 token. Il tetto esisteva per il piano gratuito di Groq,
 * che contava anche i token prenotati per l'uscita; resta perché una banda che
 * cresce perde pixel per riga, e quello va rimisurato prima, non dopo.
 *
 * Da quando le bande sono **composte** (blocco dei giorni affiancato al gruppo di
 * colonne) la loro larghezza è quasi costante e vicina a quella del ritaglio di
 * riferimento, quindi il tetto morde poco: su agosto lima la banda più grossa da
 * 756x1300 a 731x1258, cioè 70 pixel per riga contro i 77 del riferimento. Resta
 * come tetto vero e proprio, non come correzione: è quello che regge se
 * `columnsPerBand` viene alzato, e in quel caso i pixel per riga scendono e la
 * leggibilità va rimisurata.
 */
const MAX_BAND_PIXELS = 920_000

/**
 * Pixel per riga a cui si porta la **tabella intera**, quando ci sta.
 *
 * Il riferimento e la configurazione misurata al 100%: un ritaglio alto 1313 px
 * per ~17 righe, cioe ~77 px per riga. Non e risoluzione vera — le foto reali
 * arrivano a 1600 px di lato lungo e una riga vale ~32 px di dettaglio
 * effettivo — ma il ricampionamento e proprio quello che rendeva leggibili le
 * bande, e non c e ragione di darne meno alla tabella intera.
 */
const TARGET_WHOLE_ROW_HEIGHT = 78

/**
 * Lato massimo dell immagine della tabella intera.
 *
 * Sopra un certo lato il provider ricampiona da se: spendere byte oltre non
 * aggiunge dettaglio, fa solo decidere a qualcun altro con che filtro ridurre.
 * 3000 sta sotto quel limite con un margine.
 *
 * Su una tabella larga il tetto morde prima del bersaglio sui pixel per riga, e
 * va bene cosi: e geometria, non una scelta. Settembre (14 colonne, riquadro
 * 1600x1113) arriva a ~67 px per riga invece di 78, che e ancora il doppio del
 * dettaglio vero.
 */
const MAX_WHOLE_EDGE = 3000

/** Il riquadro raddrizzato, con i confini di colonna già ripuliti. */
export interface DeskewedRoster {
  /** JPEG del riquadro raddrizzato. */
  data: Buffer
  width: number
  height: number
  /**
   * Confini di colonna in frazione della larghezza, ripuliti dai filetti
   * spuri: 0 e 1 sono i due lati del riquadro.
   */
  columns: number[]
}

/** Una banda pronta da mandare al modello. */
export interface RosterBand {
  spec: BandSpec
  /** JPEG della banda: intestazione con i nomi in cima, poi le righe dei giorni. */
  image: Buffer
  width: number
  height: number
}

interface RawImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

function distanza(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function fra(valore: number, minimo: number, massimo: number): number {
  return Math.max(minimo, Math.min(massimo, valore))
}

/**
 * Raddrizza il riquadro della tabella una volta sola, restituendo i pixel
 * grezzi: sia `deskewRoster` sia `cropRosterBands` partono da qui, così la
 * tabella non viene rilevata due volte e i ritagli non subiscono due
 * compressioni JPEG in fila.
 *
 * I confini escono **come rilevati**, non ripuliti: la ripulitura la fa una
 * volta sola chi la consuma (`deskewRoster` per il suo contratto pubblico,
 * `planBands` per il taglio). Ripulire qui e poi di nuovo a valle significava
 * passare la seconda volta su un elenco già ripulito, dove la distanza mediana
 * fra confini consecutivi è più grande — cioè con una soglia diversa da quella
 * su cui è tarata.
 *
 * L'altezza dell'uscita segue le **proporzioni del riquadro trovato**, non un
 * valore fisso: le due foto vedono lo stesso modulo con proporzioni diverse
 * (0,93 contro 0,70) perché quella di agosto taglia il foglio a destra, e
 * imporre una forma schiaccerebbe le righe di una delle due.
 */
async function warpRoster(
  image: Buffer,
  width: number,
): Promise<{ rect: RawImage; columns: number[] }> {
  const tabella = await detectTableQuad(image)
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const angoli = [
    tabella.topLeft,
    tabella.topRight,
    tabella.bottomRight,
    tabella.bottomLeft,
  ] as const
  const larghezzaSorgente =
    (distanza(tabella.topLeft, tabella.topRight) +
      distanza(tabella.bottomLeft, tabella.bottomRight)) /
    2
  const altezzaSorgente =
    (distanza(tabella.topLeft, tabella.bottomLeft) +
      distanza(tabella.topRight, tabella.bottomRight)) /
    2

  const height = Math.max(1, Math.round((width * altezzaSorgente) / larghezzaSorgente))
  const raddrizzato = warpPerspective(
    { data, width: info.width, height: info.height, channels: info.channels },
    angoli,
    width,
    height,
  )

  return {
    rect: { data: raddrizzato, width, height, channels: info.channels },
    columns: tabella.columns,
  }
}

/**
 * Individua la tabella nella foto e la raddrizza in un rettangolo.
 *
 * È il primo passo di `cropRosterBands`, esposto a parte perché è la cosa da
 * guardare quando un ritaglio esce storto: se il raddrizzato è buono, il
 * problema sta nei confini di colonna; se è storto, sta nel rilevamento.
 *
 * Fallisce con `GridNotFoundError` se la foto non contiene una tabella
 * riconoscibile: un raddrizzamento a caso produce turni sbagliati, che è peggio
 * di un'estrazione mancata.
 */
export async function deskewRoster(
  image: Buffer,
  options: { width?: number; quality?: number } = {},
): Promise<DeskewedRoster> {
  const width = options.width ?? DEFAULT_DESKEW_WIDTH
  const { rect, columns } = await warpRoster(image, width)

  const data = await sharp(rect.data, {
    raw: { width: rect.width, height: rect.height, channels: rect.channels as 1 | 2 | 3 | 4 },
  })
    .jpeg({ quality: options.quality ?? DEFAULT_QUALITY, mozjpeg: true })
    .toBuffer()

  return {
    data,
    width: rect.width,
    height: rect.height,
    columns: pruneColumnBoundaries(columns),
  }
}

/** Un pezzo di immagine già materializzato, con le sue dimensioni in pixel. */
interface Piece {
  data: Buffer
  width: number
  height: number
}

/** Il pezzo di `rect` descritto dal rettangolo in frazioni, come PNG. */
async function ritaglia(
  rect: RawImage,
  frazioni: { left: number; top: number; width: number; height: number },
): Promise<Piece> {
  const left = fra(Math.round(frazioni.left * rect.width), 0, rect.width - 1)
  const top = fra(Math.round(frazioni.top * rect.height), 0, rect.height - 1)
  const width = fra(Math.round(frazioni.width * rect.width), 1, rect.width - left)
  const height = fra(Math.round(frazioni.height * rect.height), 1, rect.height - top)

  const data = await sharp(rect.data, {
    raw: { width: rect.width, height: rect.height, channels: rect.channels as 1 | 2 | 3 | 4 },
  })
    .extract({ left, top, width, height })
    .png()
    .toBuffer()

  return { data, width, height }
}

/**
 * Affianca due pezzi, il primo a sinistra. Serve a comporre il blocco dei giorni
 * con le colonne del gruppo, e la stessa cosa per la striscia d'intestazione.
 *
 * L'allineamento verticale è **esatto**, non approssimato: i due pezzi vengono
 * tagliati dalla stessa immagine raddrizzata con la stessa `top` e la stessa
 * `height` in frazioni, quindi `ritaglia` li arrotonda agli stessi pixel e le
 * loro righe sono le stesse righe. Nessuna registrazione, nessuno sfasamento —
 * ed è la ragione per cui la composizione si può fare solo *dopo* il warp
 * dell'omografia, dove le righe della tabella sono orizzontali per costruzione.
 */
async function affianca(sinistra: Piece, destra: Piece): Promise<Piece> {
  const width = sinistra.width + destra.width
  const height = sinistra.height

  const data = await sharp({
    create: { width, height, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: sinistra.data, top: 0, left: 0 },
      { input: destra.data, top: 0, left: sinistra.width },
    ])
    .png()
    .toBuffer()

  return { data, width, height }
}

/** Sovrappone due pezzi, il primo in cima. Stessa larghezza per costruzione. */
async function impila(sopra: Piece, sotto: Piece): Promise<Piece> {
  const width = sopra.width
  const height = sopra.height + sotto.height

  const data = await sharp({
    create: { width, height, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: sopra.data, top: 0, left: 0 },
      { input: sotto.data, top: sopra.height, left: 0 },
    ])
    .png()
    .toBuffer()

  return { data, width, height }
}

/**
 * Compone l immagine di una banda dal riquadro raddrizzato: il blocco dei giorni
 * affiancato alle colonne del gruppo, con la riga dei nomi in cima.
 *
 * Il blocco dei giorni prende `top` e `height` dal ritaglio: e cio che rende
 * **esatta** la cucitura fra la riga del giorno e la cella che le sta accanto,
 * invece che approssimata.
 *
 * La composizione va materializzata prima di qualunque ridimensionamento: sharp
 * ridimensiona la base *prima* di comporre, e le strisce non ci starebbero piu.
 */
async function componi(rect: RawImage, spec: BandSpec): Promise<Piece> {
  const righe = await affianca(
    await ritaglia(rect, {
      left: spec.days.left,
      top: spec.crop.top,
      width: spec.days.width,
      height: spec.crop.height,
    }),
    await ritaglia(rect, spec.crop),
  )

  if (!spec.header) return righe

  const testa = await affianca(
    await ritaglia(rect, {
      left: spec.days.left,
      top: spec.header.top,
      width: spec.days.width,
      height: spec.header.height,
    }),
    await ritaglia(rect, {
      left: spec.crop.left,
      top: spec.header.top,
      width: spec.crop.width,
      height: spec.header.height,
    }),
  )
  return impila(testa, righe)
}

/**
 * Taglia la foto nelle bande verticali da mandare al modello una alla volta.
 *
 * Mandare la tabella intera in una sola chiamata dà il 18,5% di celle corrette;
 * lo stesso modello, sullo stesso prompt, su un ritaglio di due colonne per
 * mezzo mese legge tutte le celle. Il collo di bottiglia sono le celle per
 * immagine, e queste bande sono il modo di ridurle.
 *
 * Ogni banda è composta di due strisce affiancate: il blocco dei giorni e le
 * colonne del gruppo. Non un unico ritaglio che parte dal lato sinistro del
 * riquadro — quello faceva crescere la larghezza di banda in banda, e l'ultima
 * mostrava mezza tabella intera, cioè la configurazione misurata al 18,5%.
 *
 * Ogni banda porta in cima la riga dei nomi — anche quelle della seconda metà
 * del mese, dove la striscia d'intestazione viene anteposta al ritaglio — perché
 * è sul nome letto nell'intestazione che le celle vanno chiavate. Tutte le
 * cuciture, orizzontali e verticali, sono esatte per costruzione: i pezzi
 * affiancati condividono `top` e `height`, quelli impilati condividono `left` e
 * `width`, quindi `ritaglia` li arrotonda agli stessi pixel.
 */
export async function cropRosterBands(
  image: Buffer,
  options: {
    daysInMonth: number
    columnsPerBand?: number
    deskewWidth?: number
    quality?: number
  },
): Promise<RosterBand[]> {
  const { rect, columns } = await warpRoster(image, options.deskewWidth ?? DEFAULT_DESKEW_WIDTH)
  const specifiche = planBands(columns, {
    daysInMonth: options.daysInMonth,
    columnsPerBand: options.columnsPerBand,
  })

  const bande: RosterBand[] = []

  for (const spec of specifiche) {
    const sorgente = await componi(rect, spec)
    const { width, height } = sorgente
    // Si scala sull'altezza, che è quello che decide i pixel per riga, ma non
    // oltre il tetto di pixel per banda.
    const scala = Math.min(
      TARGET_BAND_HEIGHT / height,
      Math.sqrt(MAX_BAND_PIXELS / (width * height)),
    )
    const larghezzaFinale = Math.max(1, Math.round(width * scala))
    const altezzaFinale = Math.max(1, Math.round(height * scala))

    bande.push({
      spec,
      image: await sharp(sorgente.data)
        .resize(larghezzaFinale, altezzaFinale, { fit: 'fill', kernel: 'lanczos3' })
        .jpeg({ quality: options.quality ?? DEFAULT_QUALITY, mozjpeg: true })
        .toBuffer(),
      width: larghezzaFinale,
      height: altezzaFinale,
    })
  }

  return bande
}

/**
 * Ritaglia la tabella **intera in una sola immagine**: la strategia a chiamata
 * singola.
 *
 * La tabella intera in una chiamata, misurata nella Fase 2A, dava il 18,5% di
 * celle corrette. Quella misura pero mandava al modello la **foto**: tabella in
 * prospettiva, annegata nello sfondo, con la riga di un giorno alta ~32 px. Qui
 * la tabella e raddrizzata sull omografia del riquadro, ritagliata sulla griglia
 * stampata e ricampionata ai pixel per riga della configurazione che ha
 * misurato il 100%. Sono tre differenze, non zero — e restano da misurare:
 * finche `npm run eval` non parla, il 18,5% e l unico numero che questa
 * strategia ha.
 *
 * Non e un percorso di codice separato: e `planWholeTable`, cioe una banda sola
 * che tiene tutte le colonne e tutti i giorni. Tutto quello che sta a valle —
 * scarto delle colonne di servizio per nome, buchi dichiarati per colonna e
 * giorni, persistenza che rispetta le correzioni a mano — resta quello gia
 * misurato.
 */
export async function cropRosterWhole(
  image: Buffer,
  options: { daysInMonth: number; deskewWidth?: number; quality?: number },
): Promise<RosterBand> {
  const { rect, columns } = await warpRoster(image, options.deskewWidth ?? DEFAULT_DESKEW_WIDTH)
  const [spec] = planWholeTable(columns, { daysInMonth: options.daysInMonth })

  const sorgente = await componi(rect, spec)
  const { width, height } = sorgente

  // Le righe sono i giorni del mese piu le due righe d intestazione (nomi e
  // giorno della settimana): e su quelle che si decide la scala.
  const righe = options.daysInMonth + 2
  const scala = Math.min(
    (TARGET_WHOLE_ROW_HEIGHT * righe) / height,
    MAX_WHOLE_EDGE / Math.max(width, height),
  )

  const larghezzaFinale = Math.max(1, Math.round(width * scala))
  const altezzaFinale = Math.max(1, Math.round(height * scala))

  return {
    spec,
    image: await sharp(sorgente.data)
      .resize(larghezzaFinale, altezzaFinale, { fit: 'fill', kernel: 'lanczos3' })
      .jpeg({ quality: options.quality ?? DEFAULT_QUALITY, mozjpeg: true })
      .toBuffer(),
    width: larghezzaFinale,
    height: altezzaFinale,
  }
}
