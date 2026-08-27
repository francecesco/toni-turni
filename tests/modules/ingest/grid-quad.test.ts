import { describe, expect, it } from 'vitest'
import { GridNotFoundError, validateQuad } from '@/modules/ingest/grid'

/**
 * `validateQuad` è l'ultimo cancello prima del raddrizzamento, e va esercitato
 * direttamente: attraverso `detectTableQuad` il ramo sul parallelismo non è
 * raggiungibile, perché una griglia abbastanza storta per attivarlo non viene
 * nemmeno riconosciuta come griglia. Nella versione precedente quel ramo non
 * era eseguito da nessun test, e la soglia era stata scelta così larga da non
 * vincolare nulla.
 *
 * Va esercitato direttamente anche perché non serve solo a `detectTableQuad`:
 * un quadrilatero indicato a mano dall'utente in fase di conferma deve passare
 * dallo stesso controllo.
 */

const FOTO = { width: 1600, height: 1200 }

/** Il riquadro realmente rilevato sulla foto di settembre: 3,8° di divergenza. */
const settembre = {
  topLeft: { x: 50.9, y: 116.3 },
  topRight: { x: 1548.2, y: 60.3 },
  bottomRight: { x: 1559.6, y: 1149.9 },
  bottomLeft: { x: 68.1, y: 1106.1 },
}

describe('validateQuad', () => {
  it('accetta il riquadro misurato su una foto reale, prospettiva compresa', () => {
    expect(() => validateQuad(settembre, FOTO.width, FOTO.height)).not.toThrow()
  })

  it('rifiuta un riquadro i cui lati superiore e inferiore non sono paralleli', () => {
    // lato superiore inclinato di +5°, inferiore di -5°: 10° di divergenza,
    // quasi il triplo della prospettiva peggiore misurata sulle foto reali
    const farfalla = {
      topLeft: { x: 100, y: 200 },
      topRight: { x: 1500, y: 200 + 1400 * Math.tan((5 * Math.PI) / 180) },
      bottomRight: { x: 1500, y: 1000 - 1400 * Math.tan((5 * Math.PI) / 180) },
      bottomLeft: { x: 100, y: 1000 },
    }

    expect(() => validateQuad(farfalla, FOTO.width, FOTO.height)).toThrow(GridNotFoundError)
    expect(() => validateQuad(farfalla, FOTO.width, FOTO.height)).toThrow(
      /superiore e quello inferiore.*paralleli/i,
    )
  })

  it('rifiuta un riquadro i cui lati sinistro e destro non sono paralleli', () => {
    const ventaglio = {
      topLeft: { x: 100, y: 150 },
      topRight: { x: 1500, y: 150 },
      bottomRight: { x: 1500 + 800 * Math.tan((5 * Math.PI) / 180), y: 950 },
      bottomLeft: { x: 100 - 800 * Math.tan((5 * Math.PI) / 180), y: 950 },
    }

    expect(() => validateQuad(ventaglio, FOTO.width, FOTO.height)).toThrow(
      /sinistro e quello destro.*paralleli/i,
    )
  })

  it('accetta la deriva prospettica di una tabella stampata (2°) e rifiuta il doppio del peggio misurato', () => {
    const conDeriva = (gradi: number) => ({
      topLeft: { x: 100, y: 200 },
      topRight: { x: 1500, y: 200 + 1400 * Math.tan((gradi * Math.PI) / 360) },
      bottomRight: { x: 1500, y: 1000 - 1400 * Math.tan((gradi * Math.PI) / 360) },
      bottomLeft: { x: 100, y: 1000 },
    })

    expect(() => validateQuad(conDeriva(2), FOTO.width, FOTO.height)).not.toThrow()
    expect(() => validateQuad(conDeriva(4), FOTO.width, FOTO.height)).not.toThrow()
    expect(() => validateQuad(conDeriva(9), FOTO.width, FOTO.height)).toThrow(/paralleli/i)
  })

  it('rifiuta un riquadro troppo piccolo rispetto alla foto', () => {
    const piccolo = {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 600 },
      bottomLeft: { x: 100, y: 600 },
    }

    expect(() => validateQuad(piccolo, FOTO.width, FOTO.height)).toThrow(
      /troppo piccolo rispetto alla foto/i,
    )
  })

  it('rifiuta proporzioni impossibili per una tabella turni', () => {
    const nastro = {
      topLeft: { x: 10, y: 500 },
      topRight: { x: 1590, y: 500 },
      bottomRight: { x: 1590, y: 700 },
      bottomLeft: { x: 10, y: 700 },
    }

    expect(() => validateQuad(nastro, FOTO.width, FOTO.height)).toThrow(/proporzioni/i)
  })

  it('rifiuta un quadrilatero degenere, che nessun rilevamento produce ma una correzione a mano sì', () => {
    const rovesciato = {
      topLeft: { x: 1500, y: 100 },
      topRight: { x: 100, y: 100 },
      bottomRight: { x: 100, y: 1100 },
      bottomLeft: { x: 1500, y: 1100 },
    }

    expect(() => validateQuad(rovesciato, FOTO.width, FOTO.height)).toThrow(/degenere/i)
  })
})
