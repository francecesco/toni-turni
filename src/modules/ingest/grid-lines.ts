import { GridNotFoundError, type RgbImage, type Span } from './grid-types'

// --- rilevamento dei filetti orizzontali (righe della tabella) ---

/** Raggio della finestra di massimo locale, come frazione dell altezza. */
const ROW_RADIUS_FRAC = 0.02
/** Un pixel conta come "scuro" se piu scuro del massimo locale di almeno questo. */
const ROW_MIN_DEPTH = 6
/** Tolleranza (basso/alto) sul passo fra righe consecutive per considerarle parte della stessa griglia. */
const ROW_ALIGN_TOL_LOW = 0.5
const ROW_ALIGN_TOL_HIGH = 2.2
/** Sotto questo numero di filetti allineati, non ci si fida che sia una tabella. */
const MIN_ALIGNED_LINES = 15

// --- rilevamento dei filetti verticali (colonne della tabella) ---

const COL_RADIUS_FRAC = 0.012
const COL_MIN_DEPTH = 6
/** Distanza minima fra due filetti verticali contigui, come frazione della larghezza pagina. */
const COL_SUPPRESS_FRAC = 0.05
const MIN_COLUMN_BOUNDARIES = 3

/**
 * Ampiezza della striscia laterale usata per stimare la deriva prospettica
 * (angoli non allineati su un rettangolo), come frazione della larghezza
 * della tabella.
 */
const TRAPEZOID_STRIP_FRAC = 0.1
const MIN_STRIP_WIDTH = 20

export function toGreyscale(rgb: RgbImage): Float64Array {
  const { data, width, height, channels } = rgb
  const grey = new Float64Array(width * height)
  for (let i = 0; i < width * height; i += 1) {
    const idx = i * channels
    grey[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
  }
  return grey
}

/** Massimo locale su una finestra [i-r, i+r], calcolato in O(n) con una deque monotona. */
function rollingMax(values: Float64Array, radius: number): Float64Array {
  const n = values.length
  const out = new Float64Array(n)
  const deque: number[] = []
  for (let i = 0; i < n; i += 1) {
    while (deque.length && deque[0] < i - radius) deque.shift()
    while (deque.length && values[deque[deque.length - 1]] <= values[i]) deque.pop()
    deque.push(i)
    const center = i - radius
    if (center >= 0) out[center] = values[deque[0]]
  }
  for (let i = n; i < n + radius; i += 1) {
    while (deque.length && deque[0] < i - radius) deque.shift()
    const center = i - radius
    if (center >= 0 && center < n) out[center] = values[deque[0]]
  }
  return out
}

/** Luminosita media per riga (o colonna), nel rettangolo [x0,x1) x [y0,y1). */
function meanProfile(
  grey: Float64Array,
  width: number,
  axis: 'row' | 'col',
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number[] {
  const profile: number[] = []
  if (axis === 'row') {
    for (let y = y0; y < y1; y += 1) {
      let sum = 0
      for (let x = x0; x < x1; x += 1) sum += grey[y * width + x]
      profile.push(sum / (x1 - x0))
    }
  } else {
    for (let x = x0; x < x1; x += 1) {
      let sum = 0
      for (let y = y0; y < y1; y += 1) sum += grey[y * width + x]
      profile.push(sum / (y1 - y0))
    }
  }
  return profile
}

interface Dip {
  index: number
  depth: number
}

/**
 * Trova gli avvallamenti del profilo rispetto al proprio massimo locale: un
 * filetto scuro fa scendere la luminosita sotto quella della carta bianca
 * circostante, indipendentemente da quanto sia luminosa la pagina in quel
 * punto (utile con evidenziature colorate o illuminazione non uniforme).
 * Scarta gli avvallamenti troppo vicini ai bordi del profilo, dove il massimo
 * locale e calcolato su una finestra incompleta e quindi inaffidabile.
 */
function findDips(profile: number[], radius: number, minDepth: number): Dip[] {
  const values = Float64Array.from(profile)
  const baseline = rollingMax(values, radius)
  const dips: Dip[] = []
  let runStart = -1

  const closeRun = (end: number): void => {
    let bestIndex = runStart
    let bestDepth = -Infinity
    for (let k = runStart; k < end; k += 1) {
      const depth = baseline[k] - values[k]
      if (depth > bestDepth) {
        bestDepth = depth
        bestIndex = k
      }
    }
    dips.push({ index: bestIndex, depth: bestDepth })
  }

  for (let i = 0; i < values.length; i += 1) {
    const isDark = baseline[i] - values[i] >= minDepth
    if (isDark && runStart === -1) runStart = i
    if (!isDark && runStart !== -1) {
      closeRun(i)
      runStart = -1
    }
  }
  if (runStart !== -1) closeRun(values.length)

  return dips.filter((d) => d.index >= radius && d.index < values.length - radius)
}

/** Tiene solo il piu profondo fra gli avvallamenti a meno di minDist l uno dall altro. */
function suppressNearby(dips: Dip[], minDist: number): Dip[] {
  const sorted = [...dips].sort((a, b) => b.depth - a.depth)
  const kept: Dip[] = []
  for (const dip of sorted) {
    if (kept.every((k) => Math.abs(k.index - dip.index) >= minDist)) kept.push(dip)
  }
  return kept.sort((a, b) => a.index - b.index)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Tiene solo i punti la cui distanza da almeno un vicino e compatibile con il
 * passo mediano della sequenza: individua cosi la porzione realmente regolare
 * di una lista di posizioni (i filetti della tabella), scartando le righe di
 * titolo o di intestazione che cadono fuori passo.
 */
function keepRegularlySpaced(points: number[], tolLow: number, tolHigh: number): number[] {
  if (points.length < 3) return points
  const gaps: number[] = []
  for (let i = 1; i < points.length; i += 1) gaps.push(points[i] - points[i - 1])
  const step = median(gaps)
  const lo = step * tolLow
  const hi = step * tolHigh

  const kept: number[] = []
  for (let i = 0; i < points.length; i += 1) {
    const prevOk = i > 0 && gaps[i - 1] >= lo && gaps[i - 1] <= hi
    const nextOk = i < gaps.length && gaps[i] >= lo && gaps[i] <= hi
    if (prevOk || nextOk) kept.push(points[i])
  }
  return kept
}

/**
 * Cerca il filetto piu marcato in un intorno di approxY, senza pretendere di
 * ritrovare un intera sequenza regolare. Restituisce null se non c e un
 * avvallamento sufficientemente netto: utile per capire se oltre l ultima
 * riga trovata ce ne sia davvero un altra, o se la tabella finisce li.
 */
function findLineNear(
  grey: Float64Array,
  width: number,
  x0: number,
  x1: number,
  approxY: number,
  searchRadius: number,
  y0: number,
  y1: number,
): number | null {
  const ay0 = Math.max(y0, Math.round(approxY - searchRadius))
  const ay1 = Math.min(y1, Math.round(approxY + searchRadius))
  if (ay1 - ay0 < 2 || x1 - x0 < 2) return null

  const profile = meanProfile(grey, width, 'row', x0, x1, ay0, ay1)
  let bestIndex = -1
  let bestValue = Infinity
  let maxValue = -Infinity
  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] < bestValue) {
      bestValue = profile[i]
      bestIndex = i
    }
    if (profile[i] > maxValue) maxValue = profile[i]
  }
  if (bestIndex === -1 || maxValue - bestValue < ROW_MIN_DEPTH) return null
  return ay0 + bestIndex
}

/** Righe della tabella nella fascia [x0,x1) della pagina: prima e ultima riga allineata alla griglia. */
export function detectRowSpan(
  grey: Float64Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Span {
  const radius = Math.max(1, Math.round(height * ROW_RADIUS_FRAC))
  const profile = meanProfile(grey, width, 'row', x0, x1, y0, y1)
  const dips = suppressNearby(findDips(profile, radius, ROW_MIN_DEPTH), radius)
  const aligned = keepRegularlySpaced(
    dips.map((d) => d.index + y0),
    ROW_ALIGN_TOL_LOW,
    ROW_ALIGN_TOL_HIGH,
  )
  if (aligned.length < MIN_ALIGNED_LINES) {
    throw new GridNotFoundError('Nessuna sequenza regolare di filetti orizzontali riconoscibile')
  }

  // L ultima riga di una tabella (e talvolta la prima) puo restare "fusa" con
  // la penultima nella ricerca qui sopra, perche lo spazio bianco sotto la
  // tabella e troppo lontano per far salire la base di riferimento locale
  // usata per riconoscere l avvallamento. Si verifica quindi se esiste un
  // altro filetto un passo oltre, con una ricerca mirata piu ad ampio raggio.
  const gaps: number[] = []
  for (let i = 1; i < aligned.length; i += 1) gaps.push(aligned[i] - aligned[i - 1])
  const step = median(gaps)
  const extendRadius = Math.max(4, Math.round(step * 0.4))

  const beyondStart = findLineNear(grey, width, x0, x1, aligned[0] - step, extendRadius, y0, y1)
  const beyondEnd = findLineNear(grey, width, x0, x1, aligned[aligned.length - 1] + step, extendRadius, y0, y1)

  return {
    start: beyondStart ?? aligned[0],
    end: beyondEnd ?? aligned[aligned.length - 1],
  }
}

/**
 * Confini di colonna nella fascia di righe [y0,y1): il primo e sempre il bordo
 * sinistro della pagina (si assume che la tabella sia stampata vicino al
 * margine sinistro del foglio), gli altri sono i filetti verticali via via
 * incontrati spostandosi a destra.
 */
export function detectColumnBoundaries(
  grey: Float64Array,
  width: number,
  pageLeft: number,
  pageRight: number,
  y0: number,
  y1: number,
): number[] {
  const radius = Math.max(1, Math.round(width * COL_RADIUS_FRAC))
  const suppressDist = Math.max(1, Math.round(width * COL_SUPPRESS_FRAC))
  const profile = meanProfile(grey, width, 'col', pageLeft, pageRight, y0, y1)
  const dips = suppressNearby(findDips(profile, radius, COL_MIN_DEPTH), suppressDist)
  const boundaries = [pageLeft, ...dips.map((d) => d.index + pageLeft)]
  if (boundaries.length < MIN_COLUMN_BOUNDARIES) {
    throw new GridNotFoundError('Nessun confine di colonna riconoscibile nella tabella')
  }
  return boundaries
}

/**
 * Trova dove finiscono le colonne con davvero dei turni scritti e comincia la
 * fascia di colonne pressoche vuote che spesso segue (aiuto turno, totali):
 * la luminosita media di una colonna piena di scritte e sensibilmente piu
 * bassa di quella delle colonne vuote intorno. Se non si riconosce una
 * transizione netta, la tabella viene presa fino all ultimo confine trovato.
 */
function findContentBoundaryIndex(segmentMeans: number[]): number {
  const window = 2
  let bestIndex = segmentMeans.length - 1
  let bestScore = -Infinity
  for (let i = 0; i < segmentMeans.length - 1; i += 1) {
    const before = segmentMeans.slice(Math.max(0, i - window + 1), i + 1)
    const after = segmentMeans.slice(i + 1, i + 1 + window)
    const avgBefore = before.reduce((s, v) => s + v, 0) / before.length
    const avgAfter = after.reduce((s, v) => s + v, 0) / after.length
    const score = avgAfter - avgBefore
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }
  // Una transizione plausibile deve schiarire percettibilmente: altrimenti la
  // tabella non ha colonne vuote di margine e finisce all ultimo confine.
  return bestScore > 4 ? bestIndex : segmentMeans.length - 1
}

export function detectRightEdge(grey: Float64Array, width: number, boundaries: number[], y0: number, y1: number): number {
  const segmentMeans: number[] = []
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const profile = meanProfile(grey, width, 'col', boundaries[i], boundaries[i + 1], y0, y1)
    segmentMeans.push(profile.reduce((s, v) => s + v, 0) / profile.length)
  }
  const contentEnd = findContentBoundaryIndex(segmentMeans)
  // Include una colonna oltre l ultima con contenuto: alcuni moduli usano la
  // prima colonna dopo i turni per annotazioni del personale di supporto.
  const rightIndex = Math.min(contentEnd + 2, boundaries.length - 1)
  return boundaries[rightIndex]
}

/**
 * Individua con precisione, in una sottile striscia verticale, dove si trova
 * il filetto orizzontale gia noto (approssimativamente) all altezza approxY:
 * serve a catturare la deriva prospettica agli angoli della tabella. A
 * differenza di una nuova ricerca di una sequenza regolare - che vicino ai
 * margini della tabella ha meno colonne su cui mediare ed e piu incerta -
 * qui si cerca solo il punto piu scuro in un intorno del filetto gia trovato
 * sull intera larghezza, un problema molto piu semplice e robusto.
 */
function locateLineNear(
  grey: Float64Array,
  width: number,
  height: number,
  xCenter: number,
  stripWidth: number,
  approxY: number,
  searchRadius: number,
): number {
  const half = Math.max(1, Math.round(stripWidth / 2))
  const x0 = Math.max(0, xCenter - half)
  const x1 = Math.min(width, xCenter + half)
  return findLineNear(grey, width, x0, x1, approxY, searchRadius, 0, height) ?? approxY
}

/** Le quattro y dei vertici della tabella, con la deriva prospettica catturata agli angoli. */
export interface QuadCorners {
  topLeftY: number
  topRightY: number
  bottomLeftY: number
  bottomRightY: number
}

/**
 * Individua le quattro y dei vertici della tabella (le x sono gia note: i
 * bordi sinistro e destro trovati in precedenza), cercando il filetto
 * orizzontale localmente in una striscia stretta vicino a ciascun angolo:
 * cosi facendo il quadrilatero cattura la deriva prospettica invece di
 * assumere righe perfettamente orizzontali.
 */
export function detectQuadCorners(
  grey: Float64Array,
  width: number,
  height: number,
  left: number,
  right: number,
  rowSpan: Span,
): QuadCorners {
  const stripWidth = Math.max(MIN_STRIP_WIDTH, Math.round((right - left) * TRAPEZOID_STRIP_FRAC))
  const searchRadius = Math.max(10, Math.round(height * ROW_RADIUS_FRAC))
  const leftX = left + stripWidth / 2
  const rightX = right - stripWidth / 2

  return {
    topLeftY: locateLineNear(grey, width, height, leftX, stripWidth, rowSpan.start, searchRadius),
    topRightY: locateLineNear(grey, width, height, rightX, stripWidth, rowSpan.start, searchRadius),
    bottomLeftY: locateLineNear(grey, width, height, leftX, stripWidth, rowSpan.end, searchRadius),
    bottomRightY: locateLineNear(grey, width, height, rightX, stripWidth, rowSpan.end, searchRadius),
  }
}
