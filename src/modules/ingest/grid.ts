import sharp from 'sharp'
import { applyHomography, solveHomography } from '@/lib/homography'
import {
  bootstrapColumns,
  bootstrapRows,
  detectHorizontalEdges,
  detectVerticalEdges,
  toGreyscale,
} from './grid-lines'
import { intersect, lineAt } from './grid-numeric'
import { findPageBBox } from './grid-page'
import { validateQuad } from './grid-quad'
import { GridNotFoundError, type DetectedTable, type RgbImage, type TableQuad } from './grid-types'

export type { DetectedTable, TableQuad } from './grid-types'
export { GridNotFoundError } from './grid-types'
export { validateQuad } from './grid-quad'

/** Lato minimo dell'immagine perché possa contenere una tabella fotografata. */
const MIN_SIDE = 200

async function loadRgb(image: Buffer): Promise<RgbImage> {
  const meta = await sharp(image).metadata()
  if ((meta.width ?? 0) < MIN_SIDE || (meta.height ?? 0) < MIN_SIDE) {
    throw new GridNotFoundError('Immagine troppo piccola per contenere una tabella')
  }

  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/** Il riquadro raddrizzato in coordinate normalizzate: 0..1 su entrambi i lati. */
const QUADRATO_UNITARIO = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
] as const

/**
 * Individua il riquadro della tabella turni in una foto.
 *
 * La tabella è un reticolo di filetti scuri su carta chiara. Si isola prima la
 * pagina (`grid-page`), poi si misura il passo della griglia su una striscia
 * centrale, e da quel passo — non dalle dimensioni della foto — derivano tutte
 * le distanze di ricerca. I quattro lati vengono interpolati sui filetti veri
 * misurati in cinque strisce ciascuno, e gli angoli sono le intersezioni dei
 * lati: così il riquadro è parallelo alle righe e alle colonne stampate, che è
 * la condizione perché il raddrizzamento raddrizzi la tabella invece del
 * quadrilatero.
 *
 * Il riquadro è la griglia stampata *intera*, fino all'ultimo filetto
 * verticale: le colonne di servizio (`AIUTO MATT.`, `TOT M`…) restano dentro e
 * si escludono a livello di banda. Chiedere al rilevatore quali colonne siano
 * delle infermiere significherebbe chiedergli di indovinare una semantica.
 *
 * Insieme al riquadro tornano i **confini di colonna** rilevati, in coordinate
 * del riquadro raddrizzato: servono a valle per tagliare le bande, e sono già
 * stati misurati qui per trovare i lati sinistro e destro. Frazioni fisse del
 * riquadro non servirebbero: misurate sulle due foto di calibrazione, i confini
 * delle infermiere differiscono fino a 0,159 della larghezza.
 *
 * Se un passaggio non trova quello che cerca, la funzione fallisce
 * esplicitamente con `GridNotFoundError`: un ritaglio sbagliato produce turni
 * sbagliati, che è peggio di un'estrazione mancata.
 */
export async function detectTableQuad(image: Buffer): Promise<DetectedTable> {
  const rgb = await loadRgb(image)
  const grey = toGreyscale(rgb)
  const page = findPageBBox(rgb)

  // 1. innesco: passo della griglia ed estensione verticale approssimativa
  const boot = bootstrapRows(grey, rgb.width, page.x, page.y)

  // 2. innesco dei confini di colonna, per sapere dove sta la tabella in orizzontale
  const xApprox = bootstrapColumns(grey, rgb.width, page.x, boot.span, boot.step, boot.contrastRadius)

  // 3. lati superiore e inferiore, interpolati sui primi e ultimi filetti di cinque strisce
  const horizontal = detectHorizontalEdges(grey, rgb.width, xApprox, page.y)

  // 4. lati sinistro e destro, dentro l'altezza vera della tabella
  const yTrue = {
    start: Math.max(page.y.start, Math.floor(Math.min(lineAt(horizontal.top, xApprox.start), lineAt(horizontal.top, xApprox.end)))),
    end: Math.min(page.y.end, Math.ceil(Math.max(lineAt(horizontal.bottom, xApprox.start), lineAt(horizontal.bottom, xApprox.end)))),
  }
  const vertical = detectVerticalEdges(grey, rgb.width, page.x, yTrue, horizontal.step, boot.contrastRadius)

  // 5. gli angoli sono le intersezioni dei lati: ogni angolo sta su due filetti veri
  const quad: TableQuad = {
    topLeft: intersect(horizontal.top, vertical.left),
    topRight: intersect(horizontal.top, vertical.right),
    bottomRight: intersect(horizontal.bottom, vertical.right),
    bottomLeft: intersect(horizontal.bottom, vertical.left),
  }

  validateQuad(quad, rgb.width, rgb.height)

  // 6. i confini di colonna, portati nel riquadro raddrizzato con l'omografia
  // del riquadro stesso: ogni confine è una retta, e la sua ascissa nel
  // raddrizzato è la stessa in cima e in fondo, quindi si prende la media dei
  // due estremi (differiscono di ~0,005 per il rumore di misura)
  const toRect = solveHomography(
    [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft],
    QUADRATO_UNITARIO,
  )
  const columns = vertical.boundaries.map((boundary) => {
    const alto = applyHomography(toRect, intersect(horizontal.top, boundary))
    const basso = applyHomography(toRect, intersect(horizontal.bottom, boundary))
    return (alto.x + basso.x) / 2
  })

  return { ...quad, columns }
}
