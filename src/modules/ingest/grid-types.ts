import type { Point } from '@/lib/homography'

/**
 * Il quadrilatero della tabella dentro la foto: i quattro angoli, in senso
 * orario a partire da in alto a sinistra. Non è necessariamente un rettangolo
 * assiale: la foto è quasi sempre in prospettiva, quindi i lati possono avere
 * una lieve deriva.
 */
export interface TableQuad {
  topLeft: Point
  topRight: Point
  bottomRight: Point
  bottomLeft: Point
}

/**
 * La tabella individuata nella foto: il riquadro e i confini di colonna
 * rilevati. I confini sono in **coordinate del riquadro raddrizzato** — 0 sul
 * lato sinistro, 1 sul destro — perché è lì che serviranno per tagliare le
 * bande, e perché una frazione del lato superiore nella foto non è la stessa
 * cosa: l'omografia non conserva i rapporti fra segmenti.
 *
 * Sono **candidati**, non colonne: il rilevatore non sa quali colonne portino
 * turni (`AIUTO MATT.`, `TOT M` sono filetti come gli altri) e fra i confini
 * trovati ci sono anche righe che non sono confini stampati. Il primo vale 0 e
 * l'ultimo 1: sono i due lati del riquadro.
 */
export interface DetectedTable extends TableQuad {
  columns: number[]
}

/**
 * La foto non contiene una griglia riconoscibile come tabella turni, oppure il
 * quadrilatero trovato non è plausibile. Va sempre gestito rifacendo lo scatto:
 * un'estrazione mancata si nota, un ritaglio storto produce turni sbagliati
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
