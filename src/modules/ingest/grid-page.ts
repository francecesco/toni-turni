import { GridNotFoundError, type RgbImage, type Span } from './grid-types'

/** Un pixel e "carta" se poco saturo e non troppo scuro. */
const PAPER_SAT_MAX = 0.25
const PAPER_LIGHT_MIN = 100
/** Frazione minima di pixel-carta per considerare una riga/colonna dentro la pagina. */
const PAGE_MIN_DENSITY = 0.3
/** Passo di sottocampionamento per la maschera carta (solo per individuare la pagina, va bene una stima). */
const PAGE_MASK_STEP = 2

/**
 * Trova il riquadro della pagina (il foglio bianco) dentro la foto, distinguendolo
 * dallo sfondo (es. una scrivania colorata) tramite la saturazione: la carta e
 * poco satura, uno sfondo colorato no. Serve solo a restringere la ricerca della
 * griglia alla pagina, non a delimitare la tabella con precisione.
 */
export function findPageBBox(rgb: RgbImage): { x: Span; y: Span } {
  const { data, width, height, channels } = rgb
  const step = PAGE_MASK_STEP
  const cols = Math.floor(width / step)
  const rows = Math.floor(height / step)
  const mask = new Uint8Array(cols * rows)

  for (let ry = 0; ry < rows; ry += 1) {
    for (let rx = 0; rx < cols; rx += 1) {
      const x = rx * step
      const y = ry * step
      const idx = (y * width + x) * channels
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max
      mask[ry * cols + rx] = sat < PAPER_SAT_MAX && max > PAPER_LIGHT_MIN ? 1 : 0
    }
  }

  function span(axis: 'row' | 'col'): Span {
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
    return { start: start * step, end: end * step }
  }

  const x = span('col')
  const y = span('row')
  if (x.start === -1 || y.start === -1) {
    throw new GridNotFoundError('Nessuna pagina riconoscibile nella foto')
  }

  return { x, y }
}
