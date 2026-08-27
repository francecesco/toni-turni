import { GridNotFoundError, type RgbImage, type Span } from './grid-types'

/**
 * Una carta è poco satura per definizione (è bianca o quasi), mentre uno sfondo
 * — una scrivania, un pavimento, un tavolo di legno — di solito no. La soglia
 * di saturazione non è però una costante universale: dipende dalla luce con cui
 * è stata scattata la foto. Si calcola quindi sull'istogramma della saturazione
 * della foto stessa col metodo di Otsu, e la si tiene dentro un intervallo
 * plausibile: fuori da quell'intervallo Otsu sta separando il rumore, non la
 * carta dallo sfondo.
 */
const PAPER_SAT_MIN_THRESHOLD = 0.12
const PAPER_SAT_MAX_THRESHOLD = 0.45
/** La carta è chiara: almeno questa frazione del punto più luminoso della foto. */
const PAPER_LIGHT_FRAC = 0.55
const PAPER_LIGHT_FLOOR = 60
/** Frazione minima di pixel-carta per considerare una riga/colonna dentro la pagina. */
const PAGE_MIN_DENSITY = 0.3
/** Passo di sottocampionamento per la maschera carta (per individuare la pagina basta una stima). */
const PAGE_MASK_STEP = 2
/** Il foglio deve occupare almeno questa frazione di ciascun lato della foto. */
const MIN_PAGE_COVERAGE = 0.2
/** Densità minima di pixel-carta dentro il riquadro trovato, perché sia davvero un foglio. */
const MIN_PAGE_FILL = 0.5
/** Bin dell'istogramma di saturazione usato da Otsu. */
const SAT_BINS = 64

/** Soglia di Otsu su un istogramma: massimizza la varianza fra le due classi. */
function otsuThreshold(histogram: readonly number[]): number {
  const total = histogram.reduce((s, v) => s + v, 0)
  if (total === 0) return 0
  let sumAll = 0
  for (let i = 0; i < histogram.length; i += 1) sumAll += i * histogram[i]

  let weightBelow = 0
  let sumBelow = 0
  let best = 0
  let bestVariance = -1
  for (let i = 0; i < histogram.length; i += 1) {
    weightBelow += histogram[i]
    sumBelow += i * histogram[i]
    const weightAbove = total - weightBelow
    if (weightBelow === 0 || weightAbove === 0) continue
    const meanBelow = sumBelow / weightBelow
    const meanAbove = (sumAll - sumBelow) / weightAbove
    const variance = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      best = i
    }
  }
  return (best + 1) / histogram.length
}

interface PaperMask {
  mask: Uint8Array
  cols: number
  rows: number
  step: number
}

function buildPaperMask(rgb: RgbImage): PaperMask {
  const { data, width, height, channels } = rgb
  const step = PAGE_MASK_STEP
  const cols = Math.floor(width / step)
  const rows = Math.floor(height / step)

  const sat = new Float32Array(cols * rows)
  const light = new Float32Array(cols * rows)
  const histogram = new Array<number>(SAT_BINS).fill(0)
  let maxLight = 0

  for (let ry = 0; ry < rows; ry += 1) {
    for (let rx = 0; rx < cols; rx += 1) {
      const idx = (ry * step * width + rx * step) * channels
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const s = max === 0 ? 0 : (max - min) / max
      const at = ry * cols + rx
      sat[at] = s
      light[at] = max
      if (max > maxLight) maxLight = max
      histogram[Math.min(SAT_BINS - 1, Math.floor(s * SAT_BINS))] += 1
    }
  }

  const satThreshold = Math.min(
    PAPER_SAT_MAX_THRESHOLD,
    Math.max(PAPER_SAT_MIN_THRESHOLD, otsuThreshold(histogram)),
  )
  const lightThreshold = Math.max(PAPER_LIGHT_FLOOR, maxLight * PAPER_LIGHT_FRAC)

  const mask = new Uint8Array(cols * rows)
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = sat[i] < satThreshold && light[i] >= lightThreshold ? 1 : 0
  }
  return { mask, cols, rows, step }
}

/**
 * Trova il riquadro della pagina (il foglio) dentro la foto, distinguendolo
 * dallo sfondo per saturazione. Serve solo a restringere la ricerca della
 * griglia alla pagina, non a delimitare la tabella con precisione: il
 * rilevamento a valle deve reggere anche se questo riquadro è più largo del
 * foglio. Se invece non si riconosce nessun foglio, la funzione fallisce
 * esplicitamente: continuare su un riquadro sbagliato produrrebbe un ritaglio
 * sbagliato, che è peggio di un'estrazione mancata.
 */
export function findPageBBox(rgb: RgbImage): { x: Span; y: Span } {
  const { mask, cols, rows, step } = buildPaperMask(rgb)

  const spanOf = (axis: 'row' | 'col'): { start: number; end: number } | null => {
    const outer = axis === 'row' ? rows : cols
    const inner = axis === 'row' ? cols : rows
    let start = -1
    let end = -1
    for (let i = 0; i < outer; i += 1) {
      let count = 0
      for (let j = 0; j < inner; j += 1) count += axis === 'row' ? mask[i * cols + j] : mask[j * cols + i]
      if (count / inner >= PAGE_MIN_DENSITY) {
        if (start === -1) start = i
        end = i
      }
    }
    return start === -1 ? null : { start, end }
  }

  const xCells = spanOf('col')
  const yCells = spanOf('row')
  if (!xCells || !yCells) {
    throw new GridNotFoundError('Nessuna pagina riconoscibile nella foto')
  }

  const coverageX = (xCells.end - xCells.start + 1) / cols
  const coverageY = (yCells.end - yCells.start + 1) / rows
  if (coverageX < MIN_PAGE_COVERAGE || coverageY < MIN_PAGE_COVERAGE) {
    throw new GridNotFoundError('Il foglio riconosciuto è troppo piccolo per contenere una tabella turni')
  }

  let paper = 0
  let cells = 0
  for (let ry = yCells.start; ry <= yCells.end; ry += 1) {
    for (let rx = xCells.start; rx <= xCells.end; rx += 1) {
      paper += mask[ry * cols + rx]
      cells += 1
    }
  }
  if (paper / cells < MIN_PAGE_FILL) {
    throw new GridNotFoundError('Nessuna pagina riconoscibile nella foto')
  }

  return {
    x: { start: xCells.start * step, end: xCells.end * step },
    y: { start: yCells.start * step, end: yCells.end * step },
  }
}
