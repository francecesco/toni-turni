import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { detectTableQuad, GridNotFoundError } from '@/modules/ingest/grid'

const fixture = (name: string): Buffer => readFileSync(join(process.cwd(), 'fixtures', name))

/**
 * I valori attesi vengono dalla calibrazione misurata sulle due foto reali:
 * il riquadro della tabella, in frazione dell immagine.
 */
const attesi = {
  'roster-2026-08-3piano.jpeg': { left: 0.02, right: 0.85, top: 0.18, bottom: 0.85 },
  'roster-2026-09-3piano.jpeg': { left: 0.025, right: 0.65, top: 0.10, bottom: 0.95 },
}

describe('detectTableQuad', () => {
  for (const [nome, atteso] of Object.entries(attesi)) {
    it(`trova il riquadro della tabella in ${nome}`, async () => {
      const buffer = fixture(nome)
      const { width, height } = await sharp(buffer).metadata()

      const quad = await detectTableQuad(buffer)

      // tolleranza generosa: serve che il riquadro contenga la tabella,
      // non che coincida al pixel con la calibrazione
      const tol = 0.08
      expect(quad.topLeft.x / width!).toBeCloseTo(atteso.left, 1)
      expect(quad.topLeft.y / height!).toBeCloseTo(atteso.top, 1)
      expect(quad.bottomRight.x / width!).toBeCloseTo(atteso.right, 1)
      expect(quad.bottomRight.y / height!).toBeCloseTo(atteso.bottom, 1)

      // i quattro angoli devono formare un quadrilatero orientato correttamente
      expect(quad.topLeft.x).toBeLessThan(quad.topRight.x)
      expect(quad.topLeft.y).toBeLessThan(quad.bottomLeft.y)
      expect(Math.abs(quad.topLeft.y - quad.topRight.y) / height!).toBeLessThan(tol)
    })
  }

  it('fallisce in modo esplicito su un immagine senza griglia', async () => {
    const bianco = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer()

    await expect(detectTableQuad(bianco)).rejects.toThrow(GridNotFoundError)
  })

  it('fallisce su un immagine troppo piccola per contenere una tabella', async () => {
    const minuscola = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#000000' },
    })
      .jpeg()
      .toBuffer()

    await expect(detectTableQuad(minuscola)).rejects.toThrow(GridNotFoundError)
  })

  /**
   * Costruisce un immagine sintetica con una griglia di filetti orizzontali e
   * verticali regolari dentro il rettangolo [box], su uno sfondo bianco di
   * dimensione [width]x[height]. Serve per controllare la validazione del
   * quadrilatero: la griglia va rilevata (righe abbastanza numerose e
   * regolari) ma il riquadro risultante deve poi essere giudicato implausibile.
   */
  async function grigliaSintetica(options: {
    width: number
    height: number
    box: { left: number; top: number; right: number; bottom: number }
    righe: number
    colonne: number
    /**
     * Deriva massima (in px) applicata ai filetti orizzontali: il filetto in
     * cima alla tabella e inclinato di +derivaMax da sinistra a destra, quello
     * in fondo di -derivaMax (segno opposto) - una vera tabella a trapezio,
     * non un semplice rettangolo ruotato.
     */
    derivaMax?: number
  }): Promise<Buffer> {
    const { width, height, box, righe, colonne, derivaMax = 0 } = options
    const channels = 3
    const data = Buffer.alloc(width * height * channels, 255)

    const setPixel = (x: number, y: number): void => {
      if (x < 0 || x >= width || y < 0 || y >= height) return
      const idx = (y * width + x) * channels
      data[idx] = 40
      data[idx + 1] = 40
      data[idx + 2] = 40
    }

    const drawSlantedLine = (x0: number, y0: number, x1: number, y1: number): void => {
      const steps = Math.max(1, Math.round(x1 - x0))
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps
        const x = x0 + (x1 - x0) * t
        const y = y0 + (y1 - y0) * t
        setPixel(Math.round(x), Math.round(y))
        setPixel(Math.round(x), Math.round(y) + 1)
      }
    }
    const drawVLine = (x: number, y0: number, y1: number): void => {
      for (let y = Math.round(y0); y <= Math.round(y1); y += 1) {
        setPixel(Math.round(x), y)
        setPixel(Math.round(x) + 1, y)
      }
    }

    const boxWidth = box.right - box.left
    const boxHeight = box.bottom - box.top

    for (let r = 0; r <= righe; r += 1) {
      const y = box.top + (boxHeight * r) / righe
      // la deriva va da +derivaMax (riga in cima) a -derivaMax (riga in fondo)
      const deriva = derivaMax * (1 - (2 * r) / righe)
      drawSlantedLine(box.left, y - deriva, box.right, y + deriva)
    }
    for (let c = 0; c <= colonne; c += 1) {
      const x = box.left + (boxWidth * c) / colonne
      drawVLine(x, box.top, box.bottom)
    }

    return sharp(data, { raw: { width, height, channels } }).jpeg().toBuffer()
  }

  it('rifiuta un riquadro plausibilmente rilevato ma troppo piccolo rispetto alla foto', async () => {
    // griglia regolare e ben rilevabile (righe ben distanziate, non confuse
    // fra loro), ma piccola rispetto a una foto molto piu grande: non puo
    // essere la tabella turni, solo un dettaglio nell inquadratura.
    const immagine = await grigliaSintetica({
      width: 2200,
      height: 2200,
      box: { left: 200, top: 400, right: 650, bottom: 1400 },
      righe: 15,
      colonne: 3,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(GridNotFoundError)
  })

  it('rifiuta un riquadro con proporzioni assurde per una tabella', async () => {
    // griglia larga quasi quanto la foto ma alta una piccola frazione: l area
    // e sufficiente (non scatta il controllo precedente), ma nessuna tabella
    // turni stampata ha queste proporzioni.
    const immagine = await grigliaSintetica({
      width: 2200,
      height: 600,
      box: { left: 100, top: 150, right: 2100, bottom: 450 },
      righe: 15,
      colonne: 6,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(GridNotFoundError)
  })

  it('rifiuta un riquadro i cui lati non sono abbastanza paralleli', async () => {
    // filetto in cima inclinato in un verso, filetto in fondo inclinato nel
    // verso opposto e di molto: una vera tabella stampata ha al piu una lieve
    // deriva prospettica (1-2 gradi), non una vera e propria farfalla.
    const immagine = await grigliaSintetica({
      width: 900,
      height: 1200,
      box: { left: 40, top: 200, right: 860, bottom: 1000 },
      righe: 24,
      colonne: 6,
      derivaMax: 100,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(GridNotFoundError)
  })
})
