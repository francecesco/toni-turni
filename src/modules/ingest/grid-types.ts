import type { Point } from '@/lib/homography'

/**
 * Il quadrilatero della tabella dentro la foto: i quattro angoli, in senso
 * orario a partire da in alto a sinistra. Non e necessariamente un rettangolo
 * assiale: la foto e quasi sempre in prospettiva, quindi i lati possono avere
 * una lieve deriva.
 */
export interface TableQuad {
  topLeft: Point
  topRight: Point
  bottomRight: Point
  bottomLeft: Point
}

/**
 * La foto non contiene una griglia riconoscibile come tabella turni, oppure il
 * quadrilatero trovato non e plausibile. Va sempre gestito rifacendo lo scatto:
 * un estrazione mancata si nota, un ritaglio storto produce turni sbagliati
 * senza che nessuno se ne accorga.
 */
export class GridNotFoundError extends Error {}

/** Immagine caricata come pixel RGB grezzi, prima di qualunque analisi. */
export interface RgbImage {
  data: Buffer
  width: number
  height: number
  channels: number
}

/** Intervallo [start, end] di indici (righe, colonne o coordinate) lungo un asse. */
export interface Span {
  start: number
  end: number
}
