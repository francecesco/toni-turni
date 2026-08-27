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
 * Le coordinate dei filetti veri sulle due foto reali, misurate a mano.
 *
 * Il metodo di misura è il profilo di **luminosità media** con base a finestra
 * simmetrica, che è una famiglia diversa da quella del codice di produzione
 * (`ruleProfile` conta la frazione di pixel localmente scuri da entrambi i
 * lati): due profili diversi che concordano sulla posizione di un filetto sono
 * una verifica reale. Le posizioni sono state controllate anche a occhio su
 * ritagli ingranditi degli angoli, che è l'unico modo di distinguere il filetto
 * della tabella dal bordo del foglio e dall'ombra fra due fogli.
 *
 * Ogni lato è dato da **due** punti, uno per estremità, perché è l'unico modo di
 * verificare che il riquadro sia parallelo ai filetti e non soltanto vicino agli
 * angoli: il difetto che ha fatto respingere la prima versione era un lato
 * inferiore piatto che agganciava l'ultimo filetto da un lato e il penultimo
 * dall'altro.
 *
 * Le tolleranze sono in pixel assoluti e stanno sotto il passo di riga (32 px su
 * agosto, 33 su settembre) e sotto la colonna più stretta (28 px): un errore di
 * una riga o di una colonna non passa. Sono più strette del ±5% prescritto dal
 * brief, che valeva ±80 px in verticale e non poteva vedere il difetto.
 *
 * Nota sul filetto verticale destro di settembre: **non è rettilineo** (la carta
 * è incurvata, misurato 1551 a y=290, 1549 a y=925, 1553 a y=1055, 1559 a
 * y=1120, cioè ±5 px di ondulazione). I due punti scelti stanno dove il filetto
 * è netto, e nessuna retta può seguirlo meglio di così.
 */
const CALIBRAZIONE = {
  'roster-2026-08-3piano.jpeg': {
    giorni: 31,
    /** Filetto in cima alla griglia stampata (bordo alto della riga del titolo). */
    sopra: [
      { x: 70, y: 257 },
      { x: 1125, y: 286 },
    ],
    /** Ultimo filetto orizzontale (sotto il giorno 31). */
    sotto: [
      { x: 70, y: 1356 },
      { x: 1125, y: 1332 },
    ],
    /** Primo filetto verticale (bordo sinistro della griglia). */
    sinistra: [
      { y: 375, x: 38 },
      { y: 1175, x: 15 },
    ],
    /**
     * Ultimo filetto verticale visibile: qui il foglio è tagliato dal fotogramma.
     * Non è rettilineo: misurato (centroide del minimo su bande di 20-40 px)
     * 1160 a y=375 · 1188 a y=1175 · 1190,6 a y=1210 · 1193,4 a y=1260 · 1196,4 a
     * y=1315 · 1196,7 a y=1325. La pendenza raddoppia nell'ultimo quinto.
     */
    destra: [
      { y: 375, x: 1160 },
      { y: 1175, x: 1188 },
    ],
    angoli: {
      topLeft: { x: 41, y: 257 },
      topRight: { x: 1156, y: 286 },
      /**
       * Misurato **sull'angolo**, non estrapolato dai due punti del lato: il
       * filetto verticale destro sta a 1196,7 a y=1325 e il lato inferiore passa
       * per y=1330,6 a quell'ascissa. La costante precedente diceva 1193, cioè 4
       * px a sinistra del vero, e siccome il rilevatore è **corto** su questo
       * angolo (vedi N10) una costante corta gli dava ragione: un test che
       * premia l'errore è peggio di un test assente.
       */
      bottomRight: { x: 1197, y: 1331 },
      bottomLeft: { x: 10, y: 1356 },
    },
    /**
     * I confini delle colonne delle infermiere, in frazione della larghezza del
     * riquadro raddrizzato: bordo sinistro di RENATA, i sette confini fra le
     * otto infermiere, bordo destro di CARMEN. Sono la misura fatta nel giro
     * precedente **sull'immagine raddrizzata** (riquadro rilevato portato a
     * 1400×1000, consenso di tre fasce), riportata dal rapporto del fix 1: una
     * misura indipendente da come il rilevatore normalizza le ascisse, che è la
     * cosa che questo test deve verificare.
     */
    colonne: [0.0721, 0.165, 0.255, 0.3429, 0.4307, 0.5036, 0.59, 0.6714, 0.765],
  },
  'roster-2026-09-3piano.jpeg': {
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
      { y: 290, x: 55 },
      { y: 925, x: 62 },
    ],
    destra: [
      { y: 300, x: 1552 },
      { y: 1120, x: 1559 },
    ],
    angoli: {
      topLeft: { x: 47, y: 119 },
      topRight: { x: 1552, y: 68 },
      bottomRight: { x: 1561, y: 1145 },
      bottomLeft: { x: 68, y: 1104 },
    },
    colonne: [0.0536, 0.1243, 0.1936, 0.265, 0.3371, 0.3971, 0.4664, 0.5307, 0.6057],
  },
} as const

/**
 * Scarto massimo su un confine di colonna, in frazione della larghezza del
 * riquadro. Vale 9 px sul riquadro di agosto (largo 1149 px) e 12 px su quello
 * di settembre (1497 px), cioè meno di mezza colonna delle infermiere, che è
 * larga 0,09 in queste unità. Lo scarto peggiore misurato è 0,0037.
 */
const TOLLERANZA_COLONNA = 0.008

/** Scarto massimo fra un lato del riquadro e il filetto misurato che deve seguire. */
const TOLLERANZA_LATO_PX = 12
/** Scarto massimo su un angolo, che è l'intersezione estrapolata di due lati. */
const TOLLERANZA_ANGOLO_PX = 14

const atteso_colonne = (nome: string): readonly number[] =>
  CALIBRAZIONE[nome as keyof typeof CALIBRAZIONE].colonne

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
async function raddrizza(
  buffer: Buffer,
  quad: TableQuad,
  width: number,
  height: number,
  margine: number = MARGINE_RADDRIZZAMENTO,
) {
  const corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  const cx = corners.reduce((s, p) => s + p.x, 0) / 4
  const cy = corners.reduce((s, p) => s + p.y, 0) / 4
  const k = 1 + 2 * margine
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

      /**
       * I confini di colonna sono già rilevati per trovare i lati sinistro e
       * destro: buttarli via costringerebbe il Task 3 a ri-rilevarli, e le
       * frazioni fisse del riquadro non trasferiscono da una foto all'altra
       * (misurato nel giro precedente: scarto 0,159 fra le due foto contro una
       * soglia di 0,03). Vengono restituiti in **coordinate del riquadro
       * raddrizzato**, che è dove il Task 4 taglierà le bande: 0 sul lato
       * sinistro, 1 sul destro. La conversione non è una proporzione di
       * lunghezze sul lato superiore — l'omografia non conserva i rapporti fra
       * segmenti — ma la posizione del confine *nel riquadro raddrizzato*,
       * calcolata con l'omografia stessa.
       */
      it('restituisce i confini di colonna in coordinate del riquadro raddrizzato', async () => {
        const tabella = await detectTableQuad(fixture(nome))

        // il primo e l'ultimo confine sono i lati del riquadro
        expect(tabella.columns[0]).toBeCloseTo(0, 6)
        expect(tabella.columns[tabella.columns.length - 1]).toBeCloseTo(1, 6)
        expect([...tabella.columns].sort((a, b) => a - b)).toEqual([...tabella.columns])

        for (const atteso of atteso_colonne(nome)) {
          const vicino = tabella.columns.reduce((best, c) =>
            Math.abs(c - atteso) < Math.abs(best - atteso) ? c : best,
          )
          expect(Math.abs(vicino - atteso), `confine atteso a ${atteso}`).toBeLessThanOrEqual(TOLLERANZA_COLONNA)
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

      /**
       * L'ultima linea di difesa contro il difetto originale, e va scritta in
       * modo che un errore da una riga la faccia diventare rossa.
       *
       * La versione precedente contava i filetti trovati in tutta l'immagine
       * raddrizzata, che è allargata del 4% per rendere visibili i filetti
       * estremi: quel margine vale ~37 px, più di un passo di riga (27-30 px nello
       * spazio raddrizzato), quindi un riquadro che perdeva una riga se la
       * ritrovava dentro il margine e il test restava verde — verificato sotto
       * mutazione. Qui si contano i filetti che **appartengono al riquadro**, cioè
       * quelli che stanno entro mezza riga dai suoi lati: un filetto una riga
       * intera fuori non conta più, ed è esattamente l'errore che questo task
       * esiste per evitare.
       *
       * Il conteggio atteso è «almeno un filetto più dei giorni del mese»: quello
       * che chiude l'ultima riga. Non pretende l'uguaglianza perché il numero vero
       * dipende da quante righe di intestazione ha il modulo (misurato: 31 giorni
       * + titolo + intestazione + chiusura = 34 filetti su agosto, 32-33 su
       * settembre), e perché un filetto sbiadito che sfugge al rilevamento
       * *dentro* la tabella non è un difetto del riquadro.
       *
       * Da solo, però, quel conteggio **non può** cadere per un errore da una
       * riga: le due righe di intestazione gli danno due filetti di margine
       * strutturale, e sotto mutazione (lato inferiore piatto) resta verde —
       * misurato. La seconda asserzione è quella sensibile: **nessun filetto della
       * sequenza sta fuori dal riquadro**. Se il lato inferiore taglia sopra
       * l'ultimo filetto, quel filetto resta nella sequenza ma fuori dal riquadro,
       * e il conteggio dei due non coincide più. Sotto mutazione questa diventa
       * rossa su settembre (33 filetti trovati, 32 dentro).
       */
      it('contiene tutti i giorni del mese, contati dentro il riquadro', async () => {
        const buffer = fixture(nome)
        const quad = await detectTableQuad(buffer)
        const width = 1400
        const height = 1000
        const rect = await raddrizza(buffer, quad, width, height)
        const grey = toGreyscale(rect)
        const bordo = (height * MARGINE_RADDRIZZAMENTO) / (1 + 2 * MARGINE_RADDRIZZAMENTO)

        for (const [x0, x1] of [
          [40, 140],
          [400, 500],
          [900, 1000],
          [width - 140, width - 40],
        ]) {
          const dove = `striscia x ${x0}..${x1}`
          const sequenza = detectRules(grey, width, 'row', { x0, x1, y0: 0, y1: height })
          expect(sequenza, dove).not.toBeNull()

          // appartiene al riquadro il filetto che sta entro mezza riga dai suoi
          // lati: la posizione di un filetto si misura a ±3 px, una riga intera
          // di scarto è invece il difetto da prendere
          const mezzaRiga = sequenza!.step * 0.5
          const dentro = sequenza!.lines.filter(
            (l) => l >= bordo - mezzaRiga && l <= height - bordo + mezzaRiga,
          )
          expect(dentro.length, `filetti dentro il riquadro, ${dove}`).toBeGreaterThanOrEqual(atteso.giorni + 1)
          expect(dentro.length, `filetti della sequenza fuori dal riquadro, ${dove}`).toBe(sequenza!.lines.length)
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
    // il messaggio dell'innesco, non un qualunque messaggio che parli di
    // filetti orizzontali: ce ne sono due, e devono restare distinguibili
    await expect(detectTableQuad(bianco)).rejects.toThrow(/tabella turni riconoscibile.*28 filetti/i)
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
    /** Frazione della larghezza del riquadro coperta dai filetti orizzontali. */
    righeLarghezza?: number
    /** Frazione dell'altezza del riquadro coperta dai filetti verticali. */
    colonneAltezza?: { da: number; a: number }
  }): Promise<Buffer> {
    const {
      width,
      height,
      box,
      righe,
      colonne,
      derivaMax = 0,
      righeLarghezza = 1,
      colonneAltezza = { da: 0, a: 1 },
    } = options
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

    const righeFino = box.left + boxWidth * righeLarghezza
    for (let r = 0; r <= righe; r += 1) {
      const y = box.top + (boxHeight * r) / righe
      // la deriva va da +derivaMax (riga in cima) a -derivaMax (riga in fondo)
      const deriva = derivaMax * (1 - (2 * r) / righe)
      drawSlantedLine(box.left, y - deriva, righeFino, y + deriva * righeLarghezza)
    }
    for (let c = 0; colonne > 0 && c <= colonne; c += 1) {
      const x = box.left + (boxWidth * c) / colonne
      drawVLine(x, box.top + boxHeight * colonneAltezza.da, box.top + boxHeight * colonneAltezza.a)
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
      righe: 30,
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
      righe: 30,
      colonne: 6,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(/proporzioni/i)
  })

  it('rifiuta una foto in cui la carta è sparsa invece di essere un foglio', async () => {
    // due fogli appoggiati in angoli opposti: righe e colonne con abbastanza
    // carta esistono, ma il riquadro che le contiene è mezzo vuoto
    const lato = 800
    const data = Buffer.alloc(lato * lato * 3)
    for (let y = 0; y < lato; y += 1) {
      for (let x = 0; x < lato; x += 1) {
        const primo = x < lato * 0.45 && y < lato * 0.45
        const secondo = x > lato * 0.55 && y > lato * 0.55
        const idx = (y * lato + x) * 3
        const [r, g, b] = primo || secondo ? [240, 240, 235] : [200, 90, 18]
        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
      }
    }
    const immagine = await sharp(data, { raw: { width: lato, height: lato, channels: 3 } }).jpeg().toBuffer()

    await expect(detectTableQuad(immagine)).rejects.toThrow(/foglio unico/i)
  })

  it('rifiuta una griglia di soli filetti orizzontali, senza colonne', async () => {
    const immagine = await grigliaSintetica({
      width: 1200,
      height: 1400,
      box: { left: 100, top: 200, right: 1100, bottom: 1300 },
      righe: 31,
      colonne: 0,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(/confine di colonna/i)
  })

  it('rifiuta una griglia regolare che non ha le righe di un mese', async () => {
    // una griglia c'è, ma con dodici righe non è la tabella dei turni di un mese:
    // è il controllo di dominio, e il messaggio dice quante righe servono
    const immagine = await grigliaSintetica({
      width: 1200,
      height: 1400,
      box: { left: 100, top: 200, right: 1100, bottom: 1200 },
      righe: 12,
      colonne: 6,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(GridNotFoundError)
    await expect(detectTableQuad(immagine)).rejects.toThrow(/tabella turni riconoscibile.*28 filetti/i)
  })

  /**
   * I due rami d'errore che nessun test raggiungeva, e che quindi nessuno
   * sapeva se fossero raggiungibili: un controllo che non può scattare è peggio
   * di un controllo assente, perché il codice sembra difeso. Qui si dimostra
   * che scattano davvero, e ciascuno con un messaggio che lo distingue dagli
   * altri — altrimenti asserire il messaggio non dice quale ramo è stato preso.
   */
  it('rifiuta una tabella i cui filetti orizzontali coprono solo una parte della larghezza', async () => {
    // i filetti orizzontali si fermano al 35% della larghezza (una tabella
    // fotografata a metà, o un pezzo di modulo diverso): l'innesco trova la
    // sequenza nella striscia di sinistra, ma delle cinque strisce su cui si
    // interpolano i lati solo due la contengono, e due strisce non definiscono
    // un lato di cui fidarsi.
    const immagine = await grigliaSintetica({
      width: 1200,
      height: 1400,
      box: { left: 100, top: 200, right: 1100, bottom: 1300 },
      righe: 31,
      colonne: 6,
      righeLarghezza: 0.35,
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(GridNotFoundError)
    await expect(detectTableQuad(immagine)).rejects.toThrow(/strisce su 5 contengono una sequenza/i)
  })

  it('rifiuta una tabella i cui filetti verticali coprono solo una fascia di righe', async () => {
    // i filetti verticali esistono solo attorno a metà altezza: l'innesco dei
    // confini di colonna, che guarda proprio lì, riesce; ma inseguire i filetti
    // lungo l'altezza della tabella no, e il messaggio deve dire che il
    // problema è lungo l'altezza, non nella singola fascia.
    const immagine = await grigliaSintetica({
      width: 1200,
      height: 1400,
      box: { left: 100, top: 200, right: 1100, bottom: 1300 },
      righe: 31,
      colonne: 6,
      colonneAltezza: { da: 0.41, a: 0.59 },
    })

    await expect(detectTableQuad(immagine)).rejects.toThrow(GridNotFoundError)
    await expect(detectTableQuad(immagine)).rejects.toThrow(/lungo l.altezza della tabella/i)
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
    await expect(detectTableQuad(immagine)).rejects.toThrow(/tabella turni riconoscibile.*28 filetti/i)
  })
})
