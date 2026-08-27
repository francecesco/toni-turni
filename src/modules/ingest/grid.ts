import sharp from 'sharp'
import { detectColumnBoundaries, detectQuadCorners, detectRightEdge, detectRowSpan, toGreyscale } from './grid-lines'
import { findPageBBox } from './grid-page'
import { validateQuad } from './grid-quad'
import { GridNotFoundError, type RgbImage, type TableQuad } from './grid-types'

export type { TableQuad } from './grid-types'
export { GridNotFoundError } from './grid-types'

/** Lato minimo dell immagine perche possa contenere una tabella fotografata. */
const MIN_SIDE = 200

async function loadRgb(image: Buffer): Promise<RgbImage> {
  const meta = await sharp(image).metadata()
  if ((meta.width ?? 0) < MIN_SIDE || (meta.height ?? 0) < MIN_SIDE) {
    throw new GridNotFoundError('Immagine troppo piccola per contenere una tabella')
  }

  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

/**
 * Individua il riquadro della tabella turni in una foto. La tabella e un
 * reticolo di filetti scuri su carta chiara: si isola prima la pagina
 * (`grid-page`, carta bianca vs sfondo), poi i filetti orizzontali e
 * verticali dentro quella pagina (`grid-lines`, le righe e le colonne del
 * reticolo, comprese le colonne di margine quasi vuote da escludere e la
 * deriva prospettica agli angoli), infine si verifica che il quadrilatero
 * risultante sia plausibile come tabella stampata (`grid-quad`).
 * Se un passaggio fallisce, la funzione fallisce esplicitamente: un ritaglio
 * sbagliato produce turni sbagliati, peggio di un estrazione mancata.
 */
export async function detectTableQuad(image: Buffer): Promise<TableQuad> {
  const rgb = await loadRgb(image)
  const grey = toGreyscale(rgb)
  const page = findPageBBox(rgb)

  const rowSpan = detectRowSpan(grey, rgb.width, rgb.height, page.x.start, page.x.end, page.y.start, page.y.end)
  const boundaries = detectColumnBoundaries(grey, rgb.width, page.x.start, page.x.end, rowSpan.start, rowSpan.end)
  const left = boundaries[0]
  const right = detectRightEdge(grey, rgb.width, boundaries, rowSpan.start, rowSpan.end)

  const corners = detectQuadCorners(grey, rgb.width, rgb.height, left, right, rowSpan)
  const quad: TableQuad = {
    topLeft: { x: left, y: corners.topLeftY },
    topRight: { x: right, y: corners.topRightY },
    bottomRight: { x: right, y: corners.bottomRightY },
    bottomLeft: { x: left, y: corners.bottomLeftY },
  }

  validateQuad(quad, rgb.width, rgb.height)

  return quad
}
