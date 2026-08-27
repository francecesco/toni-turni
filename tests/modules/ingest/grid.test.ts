import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { warpPerspective, type Point } from '@/lib/homography'
import { detectTableQuad, GridNotFoundError, type TableQuad } from '@/modules/ingest/grid'
import { detectRules, toGreyscale } from '@/modules/ingest/grid-lines'
import { median } from '@/modules/ingest/grid-numeric'

const fixture = (name: string): Buffer => readFileSync(join(process.cwd(), 'fixtures', name))

/**
 * Le coordinate dei filetti veri sulle due foto reali, misurate a mano con un
 * metodo indipendente dal codice di produzione: frazione di pixel localmente
 * più scuri dei vicini in strisce larghe 50 px, picchi sopra il 72%. Ogni lato
 * della griglia stampata è dato da **due** punti, uno per estremità, perché è
 * l'unico modo di verificare che il riquadro sia parallelo ai filetti e non
 * soltanto vicino agli angoli: il difetto che ha fatto respingere la prima
 * versione era un lato inferiore piatto che agganciava l'ultimo filetto da un
 * lato e il penultimo dall'altro.
 *
 * Le tolleranze sono in pixel assoluti e stanno sotto il passo di riga (32 px
 * su agosto, 31 su settembre) e sotto la colonna più stretta (28 px): un errore
 * di una riga o di una colonna non passa. Sono più strette del ±5% prescritto
 * dal brief, che valeva ±80 px in verticale e non poteva vedere il difetto.
 */
const CALIBRAZIONE = {
  'roster-2026-08-3piano.jpeg': {
    dimensioni: { width: 1200, height: 1600 },
    giorni: 31,
    /** Filetto in cima alla griglia stampata (bordo alto della riga del titolo). */
    sopra: [
      { x: 70, y: 255 },
      { x: 1125, y: 286 },
    ],
    /** Ultimo filetto orizzontale (sotto il giorno 31). */
    sotto: [
      { x: 70, y: 1355 },
      { x: 1125, y: 1333 },
    ],
    /** Primo filetto verticale (bordo sinistro della griglia). */
    sinistra: [
      { y: 375, x: 38 },
      { y: 1175, x: 15 },
    ],
    /** Ultimo filetto verticale visibile: qui il foglio è tagliato dal fotogramma. */
    destra: [
      { y: 375, x: 1160 },
      { y: 1175, x: 1188 },
    ],
    angoli: {
      topLeft: { x: 41, y: 255 },
      topRight: { x: 1156, y: 286 },
      bottomRight: { x: 1194, y: 1333 },
      bottomLeft: { x: 10, y: 1355 },
    },
  },
  'roster-2026-09-3piano.jpeg': {
    dimensioni: { width: 1600, height: 1200 },
    giorni: 30,
    sopra: [
      { x: 97, y: 119 },
      { x: 1505, y: 68 },
    ],
    sotto: [
      { x: 97, y: 1104 },
      { x: 1505, y: 1144 },
    ],
    sinistra: [
      { y: 275, x: 54 },
      { y: 925, x: 61 },
    ],
    destra: [
      { y: 275, x: 1551 },
      { y: 925, x: 1549 },
    ],
    angoli: {
      topLeft: { x: 47, y: 119 },
      topRight: { x: 1552, y: 68 },
      bottomRight: { x: 1548, y: 1144 },
      bottomLeft: { x: 68, y: 1104 },
    },
  },
} as const

/** Scarto massimo fra un lato del riquadro e il filetto misurato che deve seguire. */
const TOLLERANZA_LATO_PX = 12
/** Scarto massimo su un angolo, che è l'intersezione estrapolata di due lati. */
const TOLLERANZA_ANGOLO_PX = 14

/** Ordinata del lato del riquadro fra due angoli, all'ascissa data. */
function ordinataSul(a: Point, b: Point, x: number): number {
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
}

/** Ascissa del lato del riquadro fra due angoli, all'ordinata data. */
function ascissaSul(a: Point, b: Point, y: number): number {
  return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y)
}

/** Margine con cui si raddrizza per i controlli: serve a vedere i filetti estremi. */
const MARGINE_RADDRIZZAMENTO = 0.04

/**
 * Raddrizza il riquadro allargato di un margine noto. Il margine non è un
 * dettaglio del test: senza di esso i filetti estremi cadono esattamente sul
 * bordo dell'immagine raddrizzata, dove non hanno carta da entrambi i lati e
 * non sono più riconoscibili — quindi non si potrebbe verificare che ci siano.
 */
async function raddrizza(buffer: Buffer, quad: TableQuad, width: number, height: number) {
  const corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4
  const k = 1 + 2 * MARGINE_RADDRIZZAMENTO
  const [topLeft, topRight, bottomRight, bottomLeft] = corners.map((p) => ({
    x: cx + (p.x - cx) * k,
    y: cy + (p.y - cy) * k,
  }))

  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const input = { data, width: info.width, height: info.height, channels: info.channels }
  const out = warpPerspective(input, [topLeft, topRight, bottomRight, bottomLeft], width, height)
  return { data: out, width, height, channels: info.channels }
}

describe('detectTableQuad', () => {
  for (const [nome, atteso] of Object.entries(CALIBRAZIONE)) {
    describe(nome, () => {
      it('mette ogni lato del riquadro sul filetto stampato, a entrambe le estremità', async () => {
        const quad = await detectTableQuad(fixture(nome))

        for (const punto of atteso.sopra) {
          expect(
            Math.abs(ordinataSul(quad.topLeft, quad.topRight, punto.x) - punto.y),
            `lato superiore a x=${punto.x}`,
          ).toBeLessThanOrEqual(TOLLERANZA_LATO_PX)
        }
        for (const punto of atteso.sotto) {
          expect(
            Math.abs(ordinataSul(quad.bottomLeft, quad.bottomRight, punto.x) - punto.y),
            `lato inferiore a x=${punto.x}`,
          ).toBeLessThanOrEqual(TOLLERANZA_LATO_PX)
        }
        for (const punto of atteso.sinistra) {
          expect(
            Math.abs(ascissaSul(quad.topLeft, quad.bottomLeft, punto.y) - punto.x),
            `lato sinistro a y=${punto.y}`,
          ).toBeLessThanOrEqual(TOLLERANZA_LATO_PX)
        }
        for (const punto of atteso.destra) {
          expect(
            Math.abs(ascissaSul(quad.topRight, quad.bottomRight, punto.y) - punto.x),
            `lato destro a y=${punto.y}`,
          ).toBeLessThanOrEqual(TOLLERANZA_LATO_PX)
        }
      })

      it('trova i quattro angoli entro pochi pixel da quelli misurati', async () => {
        const quad = await detectTableQuad(fixture(nome))

        for (const [angolo, punto] of Object.entries(atteso.angoli)) {
          const trovato = quad[angolo as keyof TableQuad]
          expect(Math.abs(trovato.x - punto.x), `${angolo}.x`).toBeLessThanOrEqual(TOLLERANZA_ANGOLO_PX)
          expect(Math.abs(trovato.y - punto.y), `${angolo}.y`).toBeLessThanOrEqual(TOLLERANZA_ANGOLO_PX)
        }
      })

      it('è orientato correttamente', async () => {
        const quad = await detectTableQuad(fixture(nome))

        expect(quad.topLeft.x).toBeLessThan(quad.topRight.x)
        expect(quad.topLeft.y).toBeLessThan(quad.bottomLeft.y)
        expect(quad.bottomLeft.x).toBeLessThan(quad.bottomRight.x)
        expect(quad.topRight.y).toBeLessThan(quad.bottomRight.y)
      })

      /**
       * La prova che conta: dopo il raddrizzamento i filetti devono essere
       * *orizzontali*. Se il riquadro aggancia l'ultimo filetto da un lato e il
       * penultimo dall'altro, il raddrizzamento non raddrizza la tabella — e
       * l'ultima riga di giorni esce dal bordo su metà larghezza senza che
       * nessuna coordinata risulti assurda.
       */
      it('raddrizza la tabella, non il quadrilatero: l’ultimo filetto resta allineato da un capo all’altro', async () => {
        const buffer = fixture(nome)
        const quad = await detectTableQuad(buffer)
        const width = 1400
        const height = 1000
        const rect = await raddrizza(buffer, quad, width, height)
        const grey = toGreyscale(rect)
        const bordo = (height * MARGINE_RADDRIZZAMENTO) / (1 + 2 * MARGINE_RADDRIZZAMENTO)

        const strisce = [
          [40, 140],
          [400, 500],
          [900, 1000],
          [width - 140, width - 40],
        ].map(([x0, x1]) => {
          const seq = detectRules(grey, width, 'row', { x0, x1, y0: 0, y1: height })
          expect(seq, `striscia x ${x0}..${x1}`).not.toBeNull()
          return seq!
        })
        const passo = median(strisce.map((s) => s.step))
        const ultimi = strisce.map((s) => s.lines[s.lines.length - 1])

        // l'ultimo filetto sta alla stessa altezza in tutte le strisce: è lo
        // stesso filetto fisico a passare per i due angoli in basso
        expect(Math.max(...ultimi) - Math.min(...ultimi)).toBeLessThan(passo * 0.4)
        // e coincide col bordo inferiore del riquadro
        for (const ultimo of ultimi) {
          expect(Math.abs(ultimo - (height - bordo))).toBeLessThan(passo * 0.5)
        }

        // l'intestazione entra nel ritaglio: il primo filetto trovato non è più
        // di una riga sotto il bordo superiore (su agosto la versione precedente
        // tagliava a metà "Piano: 3°PIANO")
        for (const striscia of strisce) {
          expect(striscia.lines[0]).toBeLessThan(bordo + passo * 1.5)
        }
      })

      it('contiene tutti i giorni del mese più l’intestazione', async () => {
        const buffer = fixture(nome)
        const quad = await detectTableQuad(buffer)
        const rect = await raddrizza(buffer, quad, 1400, 1000)
        const grey = toGreyscale(rect)

        const conteggi = [
          [400, 500],
          [900, 1000],
          [1260, 1360],
        ].map(([x0, x1]) => detectRules(grey, 1400, 'row', { x0, x1, y0: 0, y1: 1000 })!.lines.length)

        // un filetto in più dei giorni: quello che chiude l'ultima riga
        for (const conteggio of conteggi) {
          expect(conteggio).toBeGreaterThanOrEqual(atteso.giorni + 1)
        }
      })
    })
  }

  it('rifiuta una foto senza carta riconoscibile', async () => {
    const scrivania = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#c85a12' },
    })
      .jpeg()
      .toBuffer()

    await expect(detectTableQuad(scrivania)).rejects.toThrow(/pagina riconoscibile/i)
  })

  it('fallisce in modo esplicito su un’immagine senza griglia', async () => {
    const bianco = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer()

    await expect(detectTableQuad(bianco)).rejects.toThrow(GridNotFoundError)
    await expect(detectTableQuad(bianco)).rejects.toThrow(/filetti orizzontali/i)
  })

  it('fallisce su un’immagine troppo piccola per contenere una tabella', async () => {
    const minuscola = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#000000' },
    })
      .jpeg()
      .toBuffer()

    await expect(detectTableQuad(minuscola)).rejects.toThrow(GridNotFoundError)
    await expect(detectTableQuad(minuscola)).rejects.toThrow(/troppo piccola/i)
  })

  /**
   * Costruisce un'immagine sintetica con una griglia di filetti orizzontali e
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
     * cima alla tabella è inclinato di +derivaMax da sinistra a destra, quello
     * in fondo di -derivaMax (segno opposto) — una vera tabella a trapezio,
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
    // fra loro), ma piccola rispetto a una foto molto più grande: non può
    // essere la tabella turni, solo un dettaglio nell'inquadratura.
    const immagine = await grigliaSintetica({
      width: 2200,
      height: 2200,
      box: { left: 200, top: 400, right: 900, bottom: 1400 },
      righe: 20,
      colonne: 5,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(/troppo piccolo rispetto alla foto/i)
  })

  it('rifiuta un riquadro con proporzioni assurde per una tabella', async () => {
    // griglia larga quasi quanto la foto ma alta una piccola frazione: l'area
    // è sufficiente (non scatta il controllo precedente), ma nessuna tabella
    // turni stampata ha queste proporzioni.
    const immagine = await grigliaSintetica({
      width: 2200,
      height: 600,
      box: { left: 100, top: 150, right: 2100, bottom: 450 },
      righe: 15,
      colonne: 6,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(/proporzioni/i)
  })

  it('rifiuta una griglia a farfalla, in cui i filetti non formano una sequenza regolare', async () => {
    // filetto in cima inclinato in un verso, filetto in fondo inclinato nel
    // verso opposto e di molto: una vera tabella stampata ha al più una lieve
    // deriva prospettica (misurata: 3,7° su settembre), non una farfalla.
    // Il rilevamento si ferma prima di arrivare alla validazione del
    // quadrilatero: con filetti così inclinati non c'è nessuna striscia in cui
    // formino una sequenza. Il cancello sul parallelismo è esercitato dal test
    // diretto di validateQuad (tests/modules/ingest/grid-quad.test.ts), che è
    // l'unico modo di raggiungerlo davvero.
    const immagine = await grigliaSintetica({
      width: 900,
      height: 1200,
      box: { left: 40, top: 200, right: 860, bottom: 1000 },
      righe: 24,
      colonne: 6,
      derivaMax: 100,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(GridNotFoundError)
    await expect(detectTableQuad(immagine)).rejects.toThrow(/filetti orizzontali/i)
  })
})
