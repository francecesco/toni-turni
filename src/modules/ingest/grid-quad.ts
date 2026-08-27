import type { Point } from '@/lib/homography'
import { GridNotFoundError, type TableQuad } from './grid-types'

/**
 * Il riquadro trovato deve occupare almeno questa frazione dell area dell
 * immagine. Le due foto di calibrazione occupano il 53-56%; un valore molto
 * piu piccolo indica quasi certamente un rilevamento sbagliato (rumore di
 * sfondo, non la tabella).
 */
const MIN_AREA_FRACTION = 0.15

/** Rapporto larghezza/altezza plausibile per una tabella turni stampata. */
const MIN_ASPECT = 0.15
const MAX_ASPECT = 6

/**
 * Scarto massimo, in gradi, fra l orientamento del lato superiore e quello
 * del lato inferiore (e fra sinistro e destro). La deriva prospettica reale
 * misurata sulle foto di calibrazione e di 1-2 gradi: una tabella stampata
 * non puo avere lati che divergono molto di piu.
 */
const MAX_EDGE_ANGLE_DIFF_DEG = 25

function shoelaceArea(quad: TableQuad): number {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  let sum = 0
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

function angleDeg(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function angleDiffDeg(a1: number, a2: number): number {
  let diff = Math.abs(a1 - a2) % 360
  if (diff > 180) diff = 360 - diff
  return diff
}

/**
 * Verifica che il quadrilatero trovato sia plausibile come tabella stampata,
 * prima di restituirlo. L omografia (in @/lib/homography) rifiuta solo punti
 * esattamente allineati con una soglia assoluta: quattro angoli quasi
 * allineati - il modo in cui sbaglia un rilevamento imperfetto - passerebbero
 * quella soglia e produrrebbero un raddrizzamento silenziosamente storto.
 * Qui si controllano area, proporzioni e parallelismo dei lati.
 */
export function validateQuad(quad: TableQuad, imageWidth: number, imageHeight: number): void {
  const area = shoelaceArea(quad)
  const areaFraction = area / (imageWidth * imageHeight)
  if (areaFraction < MIN_AREA_FRACTION) {
    throw new GridNotFoundError('Il riquadro trovato e troppo piccolo rispetto alla foto')
  }

  const topWidth = quad.topRight.x - quad.topLeft.x
  const bottomWidth = quad.bottomRight.x - quad.bottomLeft.x
  const leftHeight = quad.bottomLeft.y - quad.topLeft.y
  const rightHeight = quad.bottomRight.y - quad.topRight.y
  const avgWidth = (topWidth + bottomWidth) / 2
  const avgHeight = (leftHeight + rightHeight) / 2
  if (avgWidth <= 0 || avgHeight <= 0) {
    throw new GridNotFoundError('Il quadrilatero trovato e degenere')
  }
  const aspect = avgWidth / avgHeight
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
    throw new GridNotFoundError('Le proporzioni del riquadro trovato non sono plausibili per una tabella')
  }

  const topAngle = angleDeg(quad.topLeft, quad.topRight)
  const bottomAngle = angleDeg(quad.bottomLeft, quad.bottomRight)
  const leftAngle = angleDeg(quad.topLeft, quad.bottomLeft)
  const rightAngle = angleDeg(quad.topRight, quad.bottomRight)

  if (angleDiffDeg(topAngle, bottomAngle) > MAX_EDGE_ANGLE_DIFF_DEG) {
    throw new GridNotFoundError('Il lato superiore e quello inferiore del riquadro non sono abbastanza paralleli')
  }
  if (angleDiffDeg(leftAngle, rightAngle) > MAX_EDGE_ANGLE_DIFF_DEG) {
    throw new GridNotFoundError('Il lato sinistro e quello destro del riquadro non sono abbastanza paralleli')
  }
}
