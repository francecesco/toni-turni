import type { Point } from '@/lib/homography'
import {
  fitComb,
  fitLine,
  findBorderRule,
  findValleys,
  lineAt,
  median,
  sideMax,
  traceRules,
  trackBoundaries,
  type Comb,
  type Dip,
  type Line,
} from './grid-numeric'
import { GridNotFoundError, type RgbImage } from './grid-types'

/**
 * Il rilevamento dei filetti della griglia sull'immagine: profili di contrasto
 * locale, sequenze di filetti dentro una striscia, interpolazione dei quattro
 * lati della tabella.
 *
 * Le distanze di ricerca derivano dal **passo misurato** fra filetti
 * consecutivi, non dalle dimensioni della foto. È la differenza fra un
 * rilevatore che funziona su questo reparto e uno che funziona su queste due
 * foto: chi fotografa il foglio da più lontano dimezza il passo in pixel senza
 * cambiare niente della tabella. Le sole grandezze in pixel sono quelle di un
 * filetto stampato — il suo spessore e il suo contrasto sulla carta — e sono
 * proprietà del foglio, non dell'inquadratura.
 */

/** Un filetto stampato è più scuro della carta accanto almeno di questo (su 255). */
const MIN_CONTRAST = 12
/**
 * Raggi, in pixel, con cui si misura il contrasto di un pixel rispetto ai suoi
 * vicini *attraverso* il filetto. Non sono una taratura dell'inquadratura: un
 * filetto stampato è spesso pochi pixel, e questi tre valori coprono le scale a
 * cui una foto leggibile lo può rendere. Si tiene la scala che spiega meglio il
 * profilo, quindi non c'è un valore giusto da indovinare.
 */
const CONTRAST_RADII = [4, 8, 16]
/**
 * Un filetto attraversa la striscia: si accetta come filetto solo una posizione
 * in cui almeno metà dei pixel della striscia è localmente scura. È ciò che
 * distingue un filetto dal testo dentro le celle, che è scuro ma non attraversa
 * niente — e il testo è la ragione per cui una striscia stretta, che è l'unico
 * modo di non sfocare la prospettiva, prima non funzionava.
 */
const RULE_PRESENCE = 50
/** Passo minimo credibile fra due filetti: sotto, la tabella sarebbe illeggibile comunque. */
const MIN_STEP = 6
/**
 * Le tre soglie che prima erano un'unica costante, e che hanno mestieri diversi.
 *
 * `MIN_TABLE_RULES` è un controllo di **dominio**: la tabella di un mese ha una
 * riga per giorno, quindi almeno 28 filetti orizzontali la delimitano. Vale solo
 * per l'innesco, cioè per la domanda «questa foto contiene una tabella turni?».
 * Misurato: 33-34 filetti su agosto (31 giorni + titolo + intestazione), 32-33
 * su settembre (30 giorni).
 *
 * `MIN_RULES_FOR_MAX_STEP` limita il passo massimo cercato: un passo più grande
 * di `lunghezza / (questo - 1)` non lascerebbe spazio a una sequenza. Tenerlo
 * basso lascia margine (su queste foto ammette fino a 86 px contro un passo
 * misurato di 32), e alzarlo a 28 lo dimezzerebbe.
 *
 * `MIN_STRIP_RULES` è il filtro con cui una striscia viene ammessa a votare per
 * i lati: qui una sequenza incompleta è normale (un filetto sbiadito, una cella
 * evidenziata), e pretendere il conteggio di dominio farebbe cadere strisce
 * buone — fino a scendere sotto il numero minimo di strisce concordi e a far
 * fallire il rilevamento su una foto valida.
 */
const MIN_TABLE_RULES = 28
const MIN_RULES_FOR_MAX_STEP = 15
const MIN_STRIP_RULES = 15
/** Sotto questo numero di confini di colonna, non c'è una tabella. */
const MIN_COLUMN_BOUNDARIES = 3

/** Larghezza massima di un filetto, in frazione del passo misurato: più larga è un'ombra o un bordo. */
const RULE_WIDTH_FRAC = 0.5

/** Quante strisce si usano per interpolare ciascun lato del riquadro. */
const STRIP_COUNT = 5
/** Quante posizioni si provano per l'innesco delle righe, lungo la pagina. */
const BOOTSTRAP_PROBES = [0.25, 0.5, 0.75]
/**
 * Altezza della fascia con cui si innescano i confini di colonna, in **righe
 * della tabella**: quattro righe bastano perché un filetto verticale attraversi
 * la fascia, e la deriva prospettica su quattro righe è di pochi pixel. Misurato
 * su agosto: con una fascia del 20% dell'altezza (210 px) i filetti si sfocano e
 * la tabella risulta larga 225..1046 invece di 25..1175, cioè il 30% fuori.
 */
const BOOTSTRAP_BAND_ROWS = 4
/** Ampiezza di una striscia, in frazione del lato della tabella. */
const STRIP_FRAC = 0.08
const MIN_STRIP_SIZE = 12
/** Scarto massimo di un angolo dal lato interpolato, in frazione del passo. */
const EDGE_TOL_FRAC = 0.35
/** Sotto questo numero di strisce concordi, il lato non è affidabile. */
const MIN_EDGE_POINTS = 3
/** Profondità minima del filetto di bordo, in frazione della profondità mediana dei filetti. */
const BORDER_DEPTH_FRAC = 0.5

export function toGreyscale(rgb: RgbImage): Float64Array {
  const { data, width, height, channels } = rgb
  const grey = new Float64Array(width * height)
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * channels
    grey[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
  }
  return grey
}

/** Il rettangolo di immagine su cui si cercano i filetti. */
export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * Profilo di "filettosità" lungo un asse: per ogni posizione, 100 meno la
 * percentuale di pixel della striscia che sono localmente più scuri dei loro
 * vicini attraverso il filetto. Un filetto stampato tende a 0, la carta a 100,
 * il testo dentro le celle resta alto perché occupa solo una parte della
 * striscia. È un profilo di contrasto locale, quindi non lo disturbano né
 * l'illuminazione non uniforme né le evidenziature colorate.
 *
 * **Quello che questo profilo non sa fare** è distinguere un filetto stampato
 * dal bordo del foglio quando il bordo porta la propria riga d'ombra: l'ombra è
 * più scura sia della carta sopra sia della scrivania sotto, quindi soddisfa il
 * criterio a due lati. Provato e misurato: pretendere anche «lo stesso tono dai
 * due lati» costa i filetti veri (su agosto raddrizzato la sequenza scende da 34
 * a 26 filetti), perché per pixel quel criterio è molto più rumoroso di quanto
 * la separazione fra le mediane faccia sperare. La difesa sta quindi a valle,
 * dove il candidato viene confrontato con i filetti già trovati: `traceRules`
 * (profondità e continuità della sequenza) e `fitEdge` (consenso fra strisce).
 */
export function ruleProfile(
  grey: Float64Array,
  width: number,
  axis: 'row' | 'col',
  box: Box,
  radius: number,
  contrast: number,
): number[] {
  const along = axis === 'row' ? box.y1 - box.y0 : box.x1 - box.x0
  const across = axis === 'row' ? box.x1 - box.x0 : box.y1 - box.y0
  const dark = new Float64Array(along)
  const line = new Float64Array(along)

  for (let j = 0; j < across; j += 1) {
    for (let i = 0; i < along; i += 1) {
      const x = axis === 'row' ? box.x0 + j : box.x0 + i
      const y = axis === 'row' ? box.y0 + i : box.y0 + j
      line[i] = grey[y * width + x]
    }
    const before = sideMax(line, radius, -1)
    const after = sideMax(line, radius, 1)
    for (let i = 0; i < along; i += 1) {
      if (Math.min(before[i], after[i]) - line[i] >= contrast) dark[i] += 1
    }
  }

  const profile: number[] = []
  for (let i = 0; i < along; i += 1) profile.push(100 * (1 - dark[i] / across))
  return profile
}

/** La sequenza di filetti trovata in una striscia, con il passo misurato. */
export interface RuleSequence {
  /** Posizioni dei filetti in coordinate immagine. */
  lines: number[]
  /** Passo misurato fra filetti consecutivi. */
  step: number
  /** Raggio di contrasto che ha spiegato meglio il profilo: è la scala fisica del filetto. */
  contrastRadius: number
  /** Tutte le valli del profilo alla scala giusta: servono a cercare il filetto di bordo. */
  dips: Dip[]
}

/**
 * Scarta le valli a meno di `margin` dagli estremi del profilo: lì `ruleProfile`
 * non ha carta da entrambi i lati, quindi non può distinguere un filetto da un
 * gradino, e il bordo del foglio diventerebbe un filetto.
 */
function dropMargin(valleys: Dip[], margin: number, length: number): Dip[] {
  return valleys.filter((v) => v.index >= margin && v.index < length - margin)
}

/**
 * Trova la sequenza di filetti dentro il rettangolo dato. Due passaggi: il
 * primo *misura* il passo, provando le scale di contrasto e tenendo quella che
 * spiega meglio il profilo; il secondo insegue la sequenza filetto per filetto
 * con una tolleranza derivata da quel passo, così la deriva prospettica non la
 * spezza. Restituisce null se nel rettangolo non c'è nessuna sequenza periodica
 * di filetti.
 */
export function detectRules(
  grey: Float64Array,
  width: number,
  axis: 'row' | 'col',
  box: Box,
): RuleSequence | null {
  const along = axis === 'row' ? box.y1 - box.y0 : box.x1 - box.x0
  const offset = axis === 'row' ? box.y0 : box.x0
  const maxStep = Math.floor(along / (MIN_RULES_FOR_MAX_STEP - 1))
  if (maxStep < MIN_STEP) return null

  // I raggi si provano dal più piccolo: allargare la finestra rende "scuro"
  // sempre più roba (il massimo locale può solo crescere), quindi un raggio
  // grande trova più filetti ma anche più falsi. Si tiene il primo raggio che
  // spiega una sequenza abbastanza lunga, e si sale solo se non ci riesce —
  // com'è necessario quando i filetti sono spessi perché la foto è grande.
  let best: { comb: Comb; valleys: Dip[]; radius: number } | null = null
  for (const radius of CONTRAST_RADII) {
    if (radius * 2 >= along) break
    const profile = ruleProfile(grey, width, axis, box, radius, MIN_CONTRAST)
    const valleys = dropMargin(findValleys(profile, RULE_PRESENCE), radius, profile.length)
    const comb = fitComb(valleys, MIN_STEP, maxStep)
    if (!comb) continue
    if (best === null || comb.score > best.comb.score) best = { comb, valleys, radius }
    if (comb.lines.length >= MIN_STRIP_RULES) break
  }
  if (!best) return null

  const { comb, radius } = best
  const maxWidth = Math.max(3, Math.round(comb.step * RULE_WIDTH_FRAC))
  const valleys = best.valleys.filter((v) => v.width <= maxWidth)
  const seeds = comb.lines.filter((l) => valleys.some((v) => v.index === l))
  const lines = seeds.length >= 2 ? traceRules(valleys, seeds, comb.step) : comb.lines

  return {
    lines: lines.map((l) => l + offset),
    step: comb.step,
    contrastRadius: radius,
    dips: valleys.map((v) => ({ ...v, index: v.index + offset })),
  }
}

/**
 * Estende la sequenza al filetto di bordo della griglia stampata, se c'è: la
 * riga del titolo di questa tabella è più alta delle righe dei giorni, quindi il
 * suo filetto cade fuori passo e la sequenza regolare si ferma prima. Senza
 * questo passaggio il riquadro taglia a metà l'intestazione.
 */
function extendToBorders(sequence: RuleSequence): number[] {
  const { lines, step, dips } = sequence
  // La profondità di riferimento è quella dei filetti della sequenza. Se la
  // sequenza viene dal pettine invece che dall'inseguimento, qualche sua
  // posizione può non essere fra le valli sottili: in quel caso si usa la
  // mediana di tutte le valli, perché un riferimento a zero renderebbe
  // accettabile qualunque ombra — compreso il bordo del foglio.
  const usate = dips.filter((d) => lines.includes(d.index)).map((d) => d.depth)
  const depths = usate.length > 0 ? usate : dips.map((d) => d.depth)
  const limits = {
    minDepth: median(depths) * BORDER_DEPTH_FRAC,
    maxWidth: Math.max(3, Math.round(step * RULE_WIDTH_FRAC)),
  }

  const first = findBorderRule(dips, lines[0], -1, step, limits)
  const last = findBorderRule(dips, lines[lines.length - 1], +1, step, limits)
  return [...(first === null ? [] : [first]), ...lines, ...(last === null ? [] : [last])]
}

/** I centri delle strisce con cui si campiona un lato della tabella. */
function stripCentres(from: number, to: number): number[] {
  const size = to - from
  return Array.from({ length: STRIP_COUNT }, (_, i) => from + (size * (i + 0.5)) / STRIP_COUNT)
}

function stripHalfSize(from: number, to: number): number {
  return Math.max(MIN_STRIP_SIZE, Math.round(((to - from) * STRIP_FRAC) / 2))
}

/**
 * Interpola il lato del riquadro sui punti misurati in ciascuna striscia,
 * tenendo solo quelli che concordano fra loro.
 *
 * È la difesa contro il difetto che questo task esiste per evitare: un lato che
 * aggancia l'ultimo filetto da un'estremità e il penultimo dall'altra, cioè un
 * riquadro sbagliato di una riga intera senza che nessuna coordinata risulti
 * assurda (il cancello sull'angolo non lo vede: i lati divergono di ~2°).
 *
 * Il consenso si cerca sulle rette per ogni coppia di punti e si tiene
 * l'insieme più numeroso entro tolleranza, invece di potare via il residuo
 * peggiore un punto per volta: la potatura greedy, con quattro punti e uno fuori
 * di un passo, toglie per primo un punto *buono* — il residuo massimo dei minimi
 * quadrati cade in mezzo, non sul fuoriposto — e le tre rette rimaste spalmano
 * il passo intero in residui che passano la tolleranza. La tolleranza è una
 * frazione del passo **misurato**, quindi un punto fuori di un passo intero non
 * può mai essere concorde.
 *
 * Se i punti concordi scendono sotto `MIN_EDGE_POINTS` il lato non si
 * restituisce: si fallisce esplicitamente. Un lato inventato produce turni
 * sbagliati, che è peggio di un'estrazione mancata.
 */
export function fitEdge(points: readonly Point[], step: number, cosa: string): Line {
  const tol = Math.max(2, step * EDGE_TOL_FRAC)
  const troppoPochi = (concordi: number): GridNotFoundError =>
    new GridNotFoundError(
      `Troppo poche strisce concordi per interpolare ${cosa} del riquadro (${concordi} su ${points.length})`,
    )

  if (points.length < MIN_EDGE_POINTS) throw troppoPochi(points.length)

  const inliersOf = (line: Line): Point[] =>
    points.filter((p) => Math.abs(p.y - lineAt(line, p.x)) <= tol)
  /**
   * Consenso "morbido": ogni punto agganciato vale 1 se ci cade esattamente
   * sopra e 0 se sta al limite della tolleranza. Contare i punti e basta non
   * funziona: una retta inclinata quel tanto che basta può agganciare quattro
   * punti presi metà da un filetto e metà da quello sotto, con residui grossi ma
   * dentro tolleranza, e battere i tre punti che stanno esattamente su un filetto
   * vero. Pesando i residui, i tre esatti valgono 3,0 e i quattro tirati 2,6.
   */
  const consensus = (line: Line, inliers: readonly Point[]): number =>
    inliers.reduce((sum, p) => sum + (1 - Math.abs(p.y - lineAt(line, p.x)) / tol), 0)

  let best: Point[] = []
  let bestScore = -Infinity
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (points[i].x === points[j].x) continue
      const candidate = fitLine([points[i], points[j]])
      const inliers = inliersOf(candidate)
      const score = consensus(candidate, inliers)
      if (score > bestScore || (score === bestScore && inliers.length > best.length)) {
        best = inliers
        bestScore = score
      }
    }
  }

  if (best.length < MIN_EDGE_POINTS) throw troppoPochi(best.length)

  // Rifinitura ai minimi quadrati sui soli punti concordi: la retta per due
  // punti passa esattamente per quei due, e usare tutti i concordi la centra. Se
  // la rifinitura fa uscire di tolleranza un punto lo si scarta e si rifà, ma
  // non si scende sotto `MIN_EDGE_POINTS`: qui **non** c'è un ramo d'errore,
  // perché con tre punti concordi non potrebbe scattare, e un controllo che non
  // può scattare è peggio di un controllo assente — il codice sembra difeso e
  // non lo è. La proprietà che serve («il lato restituito ha almeno
  // `MIN_EDGE_POINTS` punti dentro tolleranza») è provata da un test diretto,
  // non da un `throw` morto.
  const work = [...best]
  while (work.length > MIN_EDGE_POINTS) {
    const line = fitLine(work)
    let worst = -1
    let worstResidual = 0
    for (let i = 0; i < work.length; i += 1) {
      const residual = Math.abs(work[i].y - lineAt(line, work[i].x))
      if (residual > worstResidual) {
        worstResidual = residual
        worst = i
      }
    }
    if (worstResidual <= tol) return line
    work.splice(worst, 1)
  }
  return fitLine(work)
}

/** Innesco del rilevamento: il passo della griglia e dove sta la tabella, all'incirca. */
export interface RowBootstrap {
  step: number
  contrastRadius: number
  span: { start: number; end: number }
}

/**
 * Primo passaggio: misura il passo della griglia e l'estensione verticale
 * approssimativa della tabella su una striscia centrale della pagina. Si usa una
 * striscia stretta e non tutta la larghezza perché la deriva prospettica sfoca i
 * filetti: sulla foto di settembre l'ultimo filetto scende di 40 px da un capo
 * all'altro della tabella, più di un passo di riga intero.
 */
export function bootstrapRows(
  grey: Float64Array,
  width: number,
  x: { start: number; end: number },
  y: { start: number; end: number },
): RowBootstrap {
  const size = x.end - x.start
  const half = stripHalfSize(x.start, x.end)
  let best: RuleSequence | null = null

  // Si provano tre posizioni: la tabella non è necessariamente al centro del
  // fotogramma, e una striscia che cade fuori dalla tabella non troverebbe
  // niente. Si tiene quella con più filetti. È l'unico punto in cui l'ampiezza
  // della ricerca è una frazione dell'area di ricerca invece che del passo della
  // griglia, perché è qui che il passo viene misurato per la prima volta.
  for (const probe of BOOTSTRAP_PROBES) {
    const centre = x.start + size * probe
    const x0 = Math.max(x.start, Math.round(centre - half))
    const x1 = Math.min(x.end, Math.round(centre + half))
    if (x1 - x0 < 2) continue
    const sequence = detectRules(grey, width, 'row', { x0, x1, y0: y.start, y1: y.end })
    if (sequence && (best === null || sequence.lines.length > best.lines.length)) best = sequence
  }

  if (!best || best.lines.length < MIN_TABLE_RULES) {
    throw new GridNotFoundError(
      `Nessuna tabella turni riconoscibile: servono almeno ${MIN_TABLE_RULES} filetti orizzontali regolari, trovati ${best?.lines.length ?? 0}`,
    )
  }
  return {
    step: best.step,
    contrastRadius: best.contrastRadius,
    span: { start: best.lines[0], end: best.lines[best.lines.length - 1] },
  }
}

/**
 * Estensione orizzontale approssimativa della tabella, misurata su una fascia
 * centrale della sua altezza. Come per le righe, la fascia è stretta perché la
 * deriva prospettica sposta un filetto verticale di una ventina di pixel da
 * cima a fondo della tabella: su tutta l'altezza il filetto si sfoca e non
 * supera più la soglia di presenza.
 */
export function bootstrapColumns(
  grey: Float64Array,
  width: number,
  x: { start: number; end: number },
  y: { start: number; end: number },
  rowStep: number,
  contrastRadius: number,
): { start: number; end: number } {
  const middle = (y.start + y.end) / 2
  const half = Math.max(MIN_STRIP_SIZE, Math.round((rowStep * BOOTSTRAP_BAND_ROWS) / 2))
  const y0 = Math.max(y.start, Math.round(middle - half))
  const y1 = Math.min(y.end, Math.round(middle + half))
  const boundaries = detectColumnBoundaries(grey, width, x, y0, y1, rowStep, contrastRadius)
  return { start: boundaries[0], end: boundaries[boundaries.length - 1] }
}

/** I filetti orizzontali della tabella, misurati in più strisce verticali. */
export interface HorizontalEdges {
  top: Line
  bottom: Line
  /** Passo di riga misurato: è la scala fisica della griglia. */
  step: number
}

/**
 * Individua i lati superiore e inferiore della tabella. In ciascuna striscia
 * verticale si cerca la sequenza completa di filetti orizzontali e si prendono
 * il primo e l'ultimo: i due lati vengono poi interpolati su quei punti, quindi
 * sono *paralleli ai filetti veri* e non a una loro media. Con un lato inferiore
 * non parallelo ai filetti, il raddrizzamento non raddrizza la tabella:
 * raddrizza il quadrilatero, e l'ultima riga esce dal bordo.
 */
export function detectHorizontalEdges(
  grey: Float64Array,
  width: number,
  x: { start: number; end: number },
  y: { start: number; end: number },
): HorizontalEdges {
  const half = stripHalfSize(x.start, x.end)
  const firsts: { x: number; y: number }[] = []
  const lasts: { x: number; y: number }[] = []
  const steps: number[] = []

  for (const centre of stripCentres(x.start, x.end)) {
    const x0 = Math.max(x.start, Math.round(centre - half))
    const x1 = Math.min(x.end, Math.round(centre + half))
    if (x1 - x0 < 2) continue
    const sequence = detectRules(grey, width, 'row', { x0, x1, y0: y.start, y1: y.end })
    if (!sequence || sequence.lines.length < MIN_STRIP_RULES) continue

    const lines = extendToBorders(sequence)
    firsts.push({ x: centre, y: lines[0] })
    lasts.push({ x: centre, y: lines[lines.length - 1] })
    steps.push(sequence.step)
  }

  if (steps.length < MIN_EDGE_POINTS) {
    throw new GridNotFoundError(
      `Solo ${steps.length} strisce su ${STRIP_COUNT} contengono una sequenza di filetti orizzontali: ne servono almeno ${MIN_EDGE_POINTS} per interpolare i lati`,
    )
  }

  const step = median(steps)
  return {
    top: fitEdge(firsts, step, 'il lato superiore'),
    bottom: fitEdge(lasts, step, 'il lato inferiore'),
    step,
  }
}

/**
 * Confini di colonna nella fascia di righe [y0,y1): i filetti verticali della
 * griglia, dal primo all'ultimo. Nessuna decisione su quali colonne portino
 * turni: chiedere al rilevatore quali colonne sono delle infermiere significa
 * chiedergli di indovinare una semantica. Le colonne di servizio (aiuto turno,
 * totali) restano dentro il riquadro e si escludono a livello di banda.
 */
export function detectColumnBoundaries(
  grey: Float64Array,
  width: number,
  x: { start: number; end: number },
  y0: number,
  y1: number,
  rowStep: number,
  contrastRadius: number,
): number[] {
  const box = { x0: x.start, x1: x.end, y0, y1 }
  const profile = ruleProfile(grey, width, 'col', box, contrastRadius, MIN_CONTRAST)
  const maxWidth = Math.max(3, Math.round(rowStep * RULE_WIDTH_FRAC))
  const valleys = findValleys(profile, RULE_PRESENCE, maxWidth)

  // Le prime e le ultime posizioni del profilo non hanno carta da entrambi i
  // lati, quindi lì `ruleProfile` non può distinguere un filetto da un gradino:
  // si scartano, altrimenti il bordo del foglio diventerebbe il lato sinistro.
  const margin = contrastRadius
  const boundaries = valleys
    .filter((v) => v.index >= margin && v.index < profile.length - margin)
    .map((v) => v.index + x.start)

  if (boundaries.length < MIN_COLUMN_BOUNDARIES) {
    throw new GridNotFoundError('Nessun confine di colonna riconoscibile nella tabella')
  }
  return boundaries
}

/** I filetti verticali estremi della tabella, seguiti attraverso più fasce orizzontali. */
export interface VerticalEdges {
  left: Line
  right: Line
  /**
   * Tutti i filetti verticali che attraversano la tabella, dal più a sinistra al
   * più a destra: `left` è il primo e `right` è l'ultimo. Non si buttano via
   * perché sono i confini delle colonne, e ri-rilevarli a valle costerebbe un
   * secondo rilevamento sulla stessa immagine. Sono **candidati**: la
   * `detectColumnBoundaries` non sa quali colonne portino turni, e fra questi
   * filetti ci sono anche righe che non sono confini di colonna (misurato su
   * agosto: 14 catene, di cui due non corrispondono a un confine stampato).
   */
  boundaries: Line[]
}

/** Tolleranza di aggancio fra fasce contigue, in frazione del passo di riga. */
const TRACK_TOL_FRAC = 0.5
/** Frazione minima di fasce in cui un filetto deve comparire per contare come tale. */
const MIN_TRACK_COVERAGE = 0.6

/**
 * Individua i lati sinistro e destro della tabella. In ciascuna fascia
 * orizzontale si cercano i filetti verticali, poi si segue ciascun filetto da
 * una fascia all'altra: il lato sinistro è il filetto più a sinistra fra quelli
 * che attraversano davvero la tabella.
 *
 * Il lato sinistro è quindi un filetto rilevato, non il margine della pagina: in
 * entrambe le foto di calibrazione il foglio è tagliato dal fotogramma e il
 * margine vale 0 per caso, quindi usarlo nasconderebbe l'errore invece di
 * evitarlo. E dev'essere un filetto *inseguito*, non semplicemente il primo
 * trovato: sulla foto di settembre, nella fascia più in alto, la linea più a
 * sinistra è l'ombra fra il foglio e quello appoggiato accanto.
 */
export function detectVerticalEdges(
  grey: Float64Array,
  width: number,
  x: { start: number; end: number },
  y: { start: number; end: number },
  rowStep: number,
  contrastRadius: number,
): VerticalEdges {
  const half = stripHalfSize(y.start, y.end)
  const bands: { at: number; positions: number[] }[] = []

  for (const centre of stripCentres(y.start, y.end)) {
    const y0 = Math.max(y.start, Math.round(centre - half))
    const y1 = Math.min(y.end, Math.round(centre + half))
    if (y1 - y0 < 2) continue
    try {
      bands.push({
        at: centre,
        positions: detectColumnBoundaries(grey, width, x, y0, y1, rowStep, contrastRadius),
      })
    } catch {
      continue
    }
  }

  if (bands.length < MIN_EDGE_POINTS) {
    // messaggio diverso da quello di `detectColumnBoundaries`: lì il problema è
    // una singola fascia, qui è che i filetti verticali non si trovano lungo
    // l'altezza della tabella. Con lo stesso messaggio, un test che asserisce il
    // messaggio non distinguerebbe i due rami.
    throw new GridNotFoundError(
      `Nessun confine di colonna riconoscibile lungo l'altezza della tabella: solo ${bands.length} fasce su ${STRIP_COUNT} ne contengono`,
    )
  }

  const chains = trackBoundaries(bands, rowStep * TRACK_TOL_FRAC)
  const needed = Math.max(MIN_EDGE_POINTS, Math.ceil(bands.length * MIN_TRACK_COVERAGE))
  const crossing = chains.filter((c) => c.length >= needed)
  if (crossing.length < MIN_COLUMN_BOUNDARIES) {
    throw new GridNotFoundError('Troppi pochi filetti verticali attraversano la tabella')
  }

  const positionOf = (chain: Point[]): number => median(chain.map((p) => p.y))
  const sorted = [...crossing].sort((a, b) => positionOf(a) - positionOf(b))

  const boundaries = sorted.map((chain, i) =>
    fitEdge(chain, rowStep, i === 0 ? 'il lato sinistro' : i === sorted.length - 1 ? 'il lato destro' : 'un confine di colonna'),
  )

  return {
    left: boundaries[0],
    right: boundaries[boundaries.length - 1],
    boundaries,
  }
}
