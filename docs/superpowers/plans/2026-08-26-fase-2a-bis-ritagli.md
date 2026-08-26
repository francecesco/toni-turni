# Fase 2A-bis — Estrazione a ritagli: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare l'accuratezza dell'estrazione dal 18,5% misurato a un livello utilizzabile, raddrizzando la foto e leggendola a bande verticali invece che in una sola chiamata.

**Architecture:** Tre pezzi nuovi davanti alla pipeline esistente, e nessuna riscrittura di quella. `homography` raddrizza; `grid` trova il riquadro della tabella; `crop` taglia le bande. Sopra, un'orchestrazione a bande con pacing chiama il provider una banda alla volta, fonde i risultati in un'unica `Extraction` e la persiste una volta sola. Lo schema Zod, l'interfaccia `VisionProvider`, la risoluzione dei codici contro la legenda e `saveExtraction` restano quelli della Fase 2A.

**Tech Stack:** TypeScript, `sharp` (solo per leggere e riscrivere pixel), matematica dell'omografia scritta in casa, Zod, Groq, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-toni-turni-design.md`

## Perché questa fase esiste

La misura della Fase 2A: **46/248 celle corrette (18,5%)** leggendo la tabella intera in una chiamata, con 199 celle mai prodotte e solo 3 lette male fra quelle prodotte. Lo stesso modello, sullo stesso prompt, su un ritaglio di due colonne per mezzo mese: **30/30**. Il collo di bottiglia non è il modello, è quante celle stanno in un'immagine.

## Decisioni già prese, con i dati che le giustificano

| Tema | Decisione | Dato |
|---|---|---|
| Frazioni di layout | **Frazioni interne alla tabella**, non all'immagine | Sull'immagine divergono fino a 0,183 fra le due foto (≈3 colonne); sul riquadro tabella coincidono entro 0,026 |
| Raddrizzamento | **Sì, omografia a 4 punti**, prima di ritagliare | Incollare la colonna giorni accanto a colonne lontane sfasa di una riga intera in settembre e di 2/3 di riga in direzione opposta in agosto: nessuna correzione costante è possibile |
| Come raddrizzare | **In casa con `sharp` + matematica nostra**, non ImageMagick | ImageMagick processerebbe file caricati dall'esterno ed è un bersaglio storico di vulnerabilità su input non fidato; libvips è più conservativo e la matematica è ~150 righe testabili |
| Taglio orizzontale | **Metà mese**, con 0,012 di sovrapposizione | Il filetto di metà mese è l'unico praticamente orizzontale in entrambe le foto (agosto y=840,5 a x=78/300/800) |
| Bande | Colonna giorni + **2 colonne di persone** per banda | Il ritaglio misurato al 100% aveva esattamente questa forma |
| Fallimento di una banda | **Salva il parziale e segnala i buchi** | Otto letture buone non si buttano per una mancata, e il tetto di token rende le ripetizioni costose |
| Pacing | Attesa fra le chiamate, iniettabile nei test | Il piano gratuito di Groq conta i token **prenotati**: 8000 al minuto |

## Global Constraints

- **Node 22**, npm. **La shell di default ha Node 18.17.0: `nvm use 22` prima di npm e dei test.** Target: ZimaBoard x86_64, 8 GB.
- **TDD obbligatorio.** Nessun codice di produzione senza un test rosso; nessun "fatto" senza aver eseguito la suite e letto l'output.
- **Nessuna nuova dipendenza runtime.** Il raddrizzamento si scrive, non si installa.
- **Nessuna chiamata di rete nei test.** Solo `npm run eval` parla col provider.
- **L'output del modello non è mai fidato:** sempre Zod prima del database.
- **Un turno che sparisce è il guasto peggiore:** una banda non letta produce un buco dichiarato, mai una cella silenziosamente assente.
- Identificatori e messaggi di commit in **inglese**; commenti, descrizioni dei test e output a schermo in **italiano**. I codici turno non si traducono.
- **Un commit per task.**

## File Structure

| File | Responsabilità |
|---|---|
| `src/lib/homography.ts` | Matrice di omografia da 4 punti e rimappatura bilineare dei pixel |
| `src/modules/ingest/grid.ts` | Individua il quadrilatero della tabella nella foto |
| `src/modules/ingest/layout.ts` | Frazioni interne calibrate e derivazione delle bande |
| `src/modules/ingest/crop.ts` | Raddrizza e produce le bande da inviare al modello |
| `src/modules/extract/band-schema.ts` | Schema Zod di una banda e fusione in un'unica `Extraction` |
| `src/modules/extract/band-prompt.ts` | Prompt per una banda |
| `src/modules/extract/extract-bands.ts` | Orchestrazione a bande, pacing, parziali |
| `prisma/schema.prisma` | `Roster.missingBands` e stato `partial` |
| `scripts/eval-extraction.ts` | Passa alla strategia a bande e misura |

---

### Task 1: Omografia

**Files:**
- Create: `src/lib/homography.ts`
- Test: `tests/lib/homography.test.ts`

**Interfaces:**
- Produces: da `@/lib/homography`: `interface Point { x: number; y: number }`, `type Matrix3 = readonly number[]` (9 elementi, righe), `solveHomography(src: [Point, Point, Point, Point], dst: [Point, Point, Point, Point]): Matrix3`, `applyHomography(m: Matrix3, p: Point): Point`, `invertHomography(m: Matrix3): Matrix3`, `warpPerspective(input: { data: Buffer; width: number; height: number; channels: number }, srcQuad: [Point, Point, Point, Point], outWidth: number, outHeight: number): Buffer`

**Il senso:** dati i quattro angoli della tabella nella foto, produrre l'immagine in cui quella tabella è un rettangolo perfetto. Si calcola l'omografia dal rettangolo di destinazione **verso** la foto e si campiona a rovescio (per ogni pixel di destinazione si guarda da dove viene): è l'unico modo per non lasciare buchi nell'immagine prodotta.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/lib/homography.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyHomography,
  invertHomography,
  solveHomography,
  warpPerspective,
  type Point,
} from '@/lib/homography'

const rect = (w: number, h: number): [Point, Point, Point, Point] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
]

describe('solveHomography', () => {
  it('mappa un quadrilatero sui punti richiesti', () => {
    const src: [Point, Point, Point, Point] = [
      { x: 10, y: 20 },
      { x: 90, y: 10 },
      { x: 100, y: 80 },
      { x: 5, y: 95 },
    ]
    const dst = rect(100, 100)

    const m = solveHomography(src, dst)

    for (let i = 0; i < 4; i += 1) {
      const mapped = applyHomography(m, src[i])
      expect(mapped.x).toBeCloseTo(dst[i].x, 4)
      expect(mapped.y).toBeCloseTo(dst[i].y, 4)
    }
  })

  it('su una traslazione pura si comporta come una traslazione', () => {
    const src = rect(10, 10)
    const dst: [Point, Point, Point, Point] = src.map((p) => ({ x: p.x + 3, y: p.y + 7 })) as [Point, Point, Point, Point]

    const m = solveHomography(src, dst)

    expect(applyHomography(m, { x: 5, y: 5 })).toEqual({
      x: expect.closeTo(8, 6),
      y: expect.closeTo(12, 6),
    })
  })

  it('rifiuta quattro punti allineati, che non definiscono un quadrilatero', () => {
    const collinear: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]
    expect(() => solveHomography(collinear, rect(10, 10))).toThrow(/degenere|allineati/i)
  })
})

describe('invertHomography', () => {
  it('composta con l originale riporta al punto di partenza', () => {
    const src: [Point, Point, Point, Point] = [
      { x: 2, y: 3 },
      { x: 40, y: 1 },
      { x: 44, y: 33 },
      { x: 0, y: 30 },
    ]
    const m = solveHomography(src, rect(50, 40))
    const back = invertHomography(m)

    const p = { x: 12, y: 9 }
    const roundTrip = applyHomography(back, applyHomography(m, p))

    expect(roundTrip.x).toBeCloseTo(p.x, 4)
    expect(roundTrip.y).toBeCloseTo(p.y, 4)
  })
})

describe('warpPerspective', () => {
  /** Immagine 4x4 a un canale: una scacchiera che rende visibile la rimappatura. */
  function checker(): { data: Buffer; width: number; height: number; channels: number } {
    const data = Buffer.alloc(16)
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        data[y * 4 + x] = (x + y) % 2 === 0 ? 0 : 255
      }
    }
    return { data, width: 4, height: 4, channels: 1 }
  }

  it('con il quadrilatero identico all immagine restituisce l immagine', () => {
    const img = checker()
    const out = warpPerspective(img, rect(4, 4), 4, 4)
    expect(Array.from(out)).toEqual(Array.from(img.data))
  })

  it('produce un buffer della dimensione richiesta, canali inclusi', () => {
    const img = checker()
    const out = warpPerspective(img, rect(4, 4), 8, 6)
    expect(out.byteLength).toBe(8 * 6 * 1)
  })

  it('raddrizza un quadrilatero inclinato riempiendo tutta la destinazione', () => {
    // 8x8 con una diagonale marcata: dopo il raddrizzamento nessun pixel resta nero-zero
    const width = 8
    const height = 8
    const data = Buffer.alloc(width * height, 128)
    const img = { data, width, height, channels: 1 }

    const skew: [Point, Point, Point, Point] = [
      { x: 1, y: 0 },
      { x: 7, y: 1 },
      { x: 6, y: 7 },
      { x: 0, y: 6 },
    ]

    const out = warpPerspective(img, skew, 8, 8)

    expect(out.byteLength).toBe(64)
    // il valore costante dell interno si conserva: l interpolazione non inventa valori
    expect(out[8 * 4 + 4]).toBe(128)
  })

  it('gestisce tre canali senza mescolarli', () => {
    const width = 2
    const height = 2
    const data = Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0])
    const out = warpPerspective({ data, width, height, channels: 3 }, rect(2, 2), 2, 2)
    expect(Array.from(out.subarray(0, 3))).toEqual([255, 0, 0])
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/lib/homography.test.ts`
Expected: FAIL — `@/lib/homography` non esiste.

- [ ] **Step 3: Implementare**

Crea `src/lib/homography.ts`:

```ts
export interface Point {
  x: number
  y: number
}

/** Matrice 3x3 in ordine di riga. */
export type Matrix3 = readonly number[]

type Quad = readonly [Point, Point, Point, Point]

/** Risolve un sistema lineare con eliminazione di Gauss e pivot parziale. */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-12) {
      throw new Error('Sistema degenere: i quattro punti non definiscono un quadrilatero')
    }
    ;[m[col], m[pivot]] = [m[pivot], m[col]]

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = m[row][col] / m[col][col]
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k]
    }
  }

  return m.map((row, i) => row[n] / row[i])
}

/**
 * Omografia che porta i quattro punti `src` sui quattro punti `dst`.
 * Otto incognite (h33 fissato a 1), due equazioni per coppia di punti.
 */
export function solveHomography(src: Quad, dst: Quad): Matrix3 {
  const a: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }

  const h = solveLinearSystem(a, b)
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function applyHomography(m: Matrix3, p: Point): Point {
  const denom = m[6] * p.x + m[7] * p.y + m[8]
  if (Math.abs(denom) < 1e-12) {
    throw new Error('Punto proiettato all infinito: omografia non applicabile qui')
  }
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / denom,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / denom,
  }
}

export function invertHomography(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m

  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Omografia non invertibile')

  const adj = [
    A,
    -(b * i - c * h),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * h - b * g),
    a * e - b * d,
  ]
  return adj.map((value) => value / det)
}

function sample(
  input: { data: Buffer; width: number; height: number; channels: number },
  x: number,
  y: number,
  channel: number,
): number {
  // Interpolazione bilineare, con i bordi tenuti dentro l immagine.
  const x0 = Math.max(0, Math.min(input.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(input.height - 1, Math.floor(y)))
  const x1 = Math.min(input.width - 1, x0 + 1)
  const y1 = Math.min(input.height - 1, y0 + 1)
  const dx = Math.max(0, Math.min(1, x - x0))
  const dy = Math.max(0, Math.min(1, y - y0))

  const at = (px: number, py: number): number =>
    input.data[(py * input.width + px) * input.channels + channel]

  const top = at(x0, y0) * (1 - dx) + at(x1, y0) * dx
  const bottom = at(x0, y1) * (1 - dx) + at(x1, y1) * dx
  return top * (1 - dy) + bottom * dy
}

/**
 * Raddrizza `srcQuad` in un rettangolo `outWidth` x `outHeight`.
 * Si calcola l omografia dalla destinazione verso la sorgente e si campiona a
 * rovescio: iterando sui pixel di destinazione non restano buchi da riempire.
 */
export function warpPerspective(
  input: { data: Buffer; width: number; height: number; channels: number },
  srcQuad: Quad,
  outWidth: number,
  outHeight: number,
): Buffer {
  const dstQuad: Quad = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ]
  const toSource = solveHomography(dstQuad, srcQuad)

  const out = Buffer.alloc(outWidth * outHeight * input.channels)

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const p = applyHomography(toSource, { x, y })
      for (let c = 0; c < input.channels; c += 1) {
        out[(y * outWidth + x) * input.channels + c] = Math.round(sample(input, p.x, p.y, c))
      }
    }
  }

  return out
}
```

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/lib/homography.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add four-point homography and perspective warping"
```

---

### Task 2: Individuare il riquadro della tabella

**Files:**
- Create: `src/modules/ingest/grid.ts`
- Test: `tests/modules/ingest/grid.test.ts`

**Interfaces:**
- Consumes: `sharp`, `Point` da `@/lib/homography`
- Produces: da `@/modules/ingest/grid`: `interface TableQuad { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point }`, `detectTableQuad(image: Buffer): Promise<TableQuad>`, `class GridNotFoundError extends Error`

**Il senso e il rischio:** è il pezzo più fragile della fase. La tabella è un reticolo di filetti scuri su carta bianca: si converte in scala di grigi, si cerca dove le righe e le colonne di pixel scuri si addensano, e si prendono i due estremi in ciascuna direzione. Se il rilevamento non trova una griglia plausibile **deve fallire in modo esplicito**, non restituire un quadrilatero inventato: un ritaglio sbagliato produrrebbe turni sbagliati, che è peggio di un'estrazione mancata.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/ingest/grid.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/ingest/grid.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

Crea `src/modules/ingest/grid.ts`. L'approccio: scala di grigi ridotta, soglia adattiva sulla media, poi profili di proiezione. Adatta le costanti se i test sulle foto reali non passano — **ma non allargare la tolleranza dei test per farli passare**: se il rilevamento non trova la tabella, il difetto è nell'algoritmo.

```ts
import sharp from 'sharp'
import type { Point } from '@/lib/homography'

export interface TableQuad {
  topLeft: Point
  topRight: Point
  bottomRight: Point
  bottomLeft: Point
}

export class GridNotFoundError extends Error {}

const WORK_WIDTH = 800
const MIN_SIDE = 200
/** Una tabella deve occupare almeno questa frazione dell immagine per essere plausibile. */
const MIN_COVERAGE = 0.2

interface Grey {
  data: Buffer
  width: number
  height: number
}

async function toGrey(image: Buffer): Promise<Grey> {
  const meta = await sharp(image).metadata()
  if ((meta.width ?? 0) < MIN_SIDE || (meta.height ?? 0) < MIN_SIDE) {
    throw new GridNotFoundError('Immagine troppo piccola per contenere una tabella')
  }

  const { data, info } = await sharp(image)
    .greyscale()
    .resize({ width: WORK_WIDTH, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })

  return { data, width: info.width, height: info.height }
}

/** Frazione di pixel scuri per ciascuna riga (o colonna) dell immagine di lavoro. */
function darkProfile(grey: Grey, axis: 'row' | 'col', threshold: number): number[] {
  const outer = axis === 'row' ? grey.height : grey.width
  const inner = axis === 'row' ? grey.width : grey.height
  const profile: number[] = []

  for (let i = 0; i < outer; i += 1) {
    let dark = 0
    for (let j = 0; j < inner; j += 1) {
      const value = axis === 'row' ? grey.data[i * grey.width + j] : grey.data[j * grey.width + i]
      if (value < threshold) dark += 1
    }
    profile.push(dark / inner)
  }

  return profile
}

/** Primo e ultimo indice in cui il profilo supera la soglia di densità. */
function span(profile: number[], minDensity: number): { start: number; end: number } {
  let start = -1
  let end = -1
  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] >= minDensity) {
      if (start === -1) start = i
      end = i
    }
  }
  return { start, end }
}

/**
 * Individua il riquadro della tabella. La tabella è un reticolo di filetti scuri:
 * le righe e le colonne che lo contengono hanno molti più pixel scuri della carta
 * attorno, e i due estremi di quella fascia sono i bordi.
 */
export async function detectTableQuad(image: Buffer): Promise<TableQuad> {
  const grey = await toGrey(image)

  const mean = grey.data.reduce((sum, value) => sum + value, 0) / grey.data.length
  const threshold = mean * 0.75

  const rows = darkProfile(grey, 'row', threshold)
  const cols = darkProfile(grey, 'col', threshold)

  const vertical = span(rows, 0.35)
  const horizontal = span(cols, 0.35)

  if (vertical.start === -1 || horizontal.start === -1) {
    throw new GridNotFoundError('Nessuna griglia riconoscibile nella foto')
  }

  const heightCoverage = (vertical.end - vertical.start) / grey.height
  const widthCoverage = (horizontal.end - horizontal.start) / grey.width
  if (heightCoverage < MIN_COVERAGE || widthCoverage < MIN_COVERAGE) {
    throw new GridNotFoundError('La griglia trovata è troppo piccola per essere una tabella turni')
  }

  const meta = await sharp(image).metadata()
  const scaleX = (meta.width ?? grey.width) / grey.width
  const scaleY = (meta.height ?? grey.height) / grey.height

  const left = horizontal.start * scaleX
  const right = horizontal.end * scaleX
  const top = vertical.start * scaleY
  const bottom = vertical.end * scaleY

  return {
    topLeft: { x: left, y: top },
    topRight: { x: right, y: top },
    bottomRight: { x: right, y: bottom },
    bottomLeft: { x: left, y: bottom },
  }
}
```

- [ ] **Step 4: Eseguire i test e adattare le costanti**

Run: `npx vitest run tests/modules/ingest/grid.test.ts`
Expected: PASS, 4 test. Se i due test sulle foto reali non passano, regola `threshold`, la densità minima o `WORK_WIDTH` — e riporta nel report quali valori hai dovuto usare e perché. **Non toccare le tolleranze dei test.**

- [ ] **Step 5: Salvare un'immagine di verifica**

Genera, in una cartella temporanea (non nel repository), le due foto con il riquadro trovato disegnato sopra, guardale, e riporta nel report se il riquadro contiene la tabella intera comprese le intestazioni.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: locate the roster table quad in a photo"
```

---

### Task 3: Frazioni interne e bande

**Files:**
- Create: `src/modules/ingest/layout.ts`
- Test: `tests/modules/ingest/layout.test.ts`

**Interfaces:**
- Produces: da `@/modules/ingest/layout`: `interface RosterLayout { dayColumnWidth: number; columnEdges: number[]; headerHeight: number }`, `DEFAULT_ROSTER_LAYOUT: RosterLayout`, `interface BandSpec { columns: number[]; dayFrom: number; dayTo: number; crop: { left: number; top: number; width: number; height: number } }`, `planBands(layout: RosterLayout, options: { daysInMonth: number; columnsPerBand?: number; overlap?: number }): BandSpec[]`

**I numeri, e da dove vengono:** i bordi delle colonne, misurati sulle due foto reali e normalizzati sulla larghezza dell'area persone, coincidono entro 0,026. Il default è la media dei due:

```
[0, 0.130, 0.256, 0.385, 0.512, 0.620, 0.746, 0.863, 1.0]
```

`dayColumnWidth` è la larghezza della colonna dei giorni in frazione della larghezza **totale** del riquadro tabella: 0,085 (media fra 0,0758 di agosto e 0,0584+... — usa 0,085 e correggi se i ritagli del Task 4 mostrano che taglia).

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/ingest/layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROSTER_LAYOUT, planBands } from '@/modules/ingest/layout'

describe('DEFAULT_ROSTER_LAYOUT', () => {
  it('descrive nove bordi per otto colonne, da 0 a 1', () => {
    expect(DEFAULT_ROSTER_LAYOUT.columnEdges).toHaveLength(9)
    expect(DEFAULT_ROSTER_LAYOUT.columnEdges[0]).toBe(0)
    expect(DEFAULT_ROSTER_LAYOUT.columnEdges.at(-1)).toBe(1)
  })

  it('ha bordi crescenti', () => {
    const edges = DEFAULT_ROSTER_LAYOUT.columnEdges
    for (let i = 1; i < edges.length; i += 1) {
      expect(edges[i]).toBeGreaterThan(edges[i - 1])
    }
  })

  it('lascia spazio alla colonna dei giorni e all intestazione', () => {
    expect(DEFAULT_ROSTER_LAYOUT.dayColumnWidth).toBeGreaterThan(0)
    expect(DEFAULT_ROSTER_LAYOUT.dayColumnWidth).toBeLessThan(0.2)
    expect(DEFAULT_ROSTER_LAYOUT.headerHeight).toBeGreaterThan(0)
    expect(DEFAULT_ROSTER_LAYOUT.headerHeight).toBeLessThan(0.2)
  })
})

describe('planBands', () => {
  it('copre tutte le otto colonne a coppie, e tutti i giorni', () => {
    const bands = planBands(DEFAULT_ROSTER_LAYOUT, { daysInMonth: 31 })

    const colonneCoperte = new Set(bands.flatMap((b) => b.columns))
    expect([...colonneCoperte].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

    for (let day = 1; day <= 31; day += 1) {
      expect(bands.some((b) => day >= b.dayFrom && day <= b.dayTo), `giorno ${day}`).toBe(true)
    }
  })

  it('divide il mese in due metà: otto bande per otto colonne a coppie', () => {
    expect(planBands(DEFAULT_ROSTER_LAYOUT, { daysInMonth: 31 })).toHaveLength(8)
  })

  it('include la colonna dei giorni in ogni ritaglio', () => {
    for (const band of planBands(DEFAULT_ROSTER_LAYOUT, { daysInMonth: 30 })) {
      expect(band.crop.left).toBe(0)
    }
  })

  it('produce ritagli dentro i limiti dell immagine', () => {
    for (const band of planBands(DEFAULT_ROSTER_LAYOUT, { daysInMonth: 30 })) {
      expect(band.crop.left).toBeGreaterThanOrEqual(0)
      expect(band.crop.top).toBeGreaterThanOrEqual(0)
      expect(band.crop.left + band.crop.width).toBeLessThanOrEqual(1.0001)
      expect(band.crop.top + band.crop.height).toBeLessThanOrEqual(1.0001)
    }
  })

  it('sovrappone le due metà del mese di una riga, così nessun giorno cade nella cucitura', () => {
    const bands = planBands(DEFAULT_ROSTER_LAYOUT, { daysInMonth: 31, overlap: 0.012 })
    const prima = bands.find((b) => b.dayFrom === 1)!
    const seconda = bands.find((b) => b.dayFrom > 1 && b.columns[0] === prima.columns[0])!
    expect(prima.crop.top + prima.crop.height).toBeGreaterThan(seconda.crop.top)
  })

  it('rispetta columnsPerBand', () => {
    const bands = planBands(DEFAULT_ROSTER_LAYOUT, { daysInMonth: 30, columnsPerBand: 4 })
    expect(bands).toHaveLength(4)
    for (const band of bands) expect(band.columns.length).toBeLessThanOrEqual(4)
  })

  it('rifiuta un mese impossibile', () => {
    expect(() => planBands(DEFAULT_ROSTER_LAYOUT, { daysInMonth: 0 })).toThrow(/giorni/i)
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/ingest/layout.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

Crea `src/modules/ingest/layout.ts`:

```ts
export interface RosterLayout {
  /** Larghezza della colonna dei giorni, in frazione della larghezza del riquadro tabella. */
  dayColumnWidth: number
  /** Bordi delle colonne di persona, in frazione della larghezza dell area persone. */
  columnEdges: number[]
  /** Altezza dell intestazione, in frazione dell altezza del riquadro tabella. */
  headerHeight: number
}

/**
 * Calibrato sulle due foto reali del reparto: i bordi normalizzati sulla larghezza
 * dell area persone coincidono fra le due entro 0,026, quindi il default è la loro
 * media. Se il modulo cartaceo cambia, si cambiano questi numeri e non il codice.
 */
export const DEFAULT_ROSTER_LAYOUT: RosterLayout = {
  dayColumnWidth: 0.085,
  columnEdges: [0, 0.13, 0.256, 0.385, 0.512, 0.62, 0.746, 0.863, 1],
  headerHeight: 0.06,
}

export interface BandSpec {
  /** Indici delle colonne di persona contenute in questa banda. */
  columns: number[]
  dayFrom: number
  dayTo: number
  /** Ritaglio in frazioni del riquadro tabella raddrizzato. */
  crop: { left: number; top: number; width: number; height: number }
}

export function planBands(
  layout: RosterLayout,
  options: { daysInMonth: number; columnsPerBand?: number; overlap?: number },
): BandSpec[] {
  const { daysInMonth } = options
  if (!Number.isInteger(daysInMonth) || daysInMonth < 28 || daysInMonth > 31) {
    throw new Error(`Numero di giorni non plausibile per un mese: ${daysInMonth}`)
  }

  const columnsPerBand = options.columnsPerBand ?? 2
  const overlap = options.overlap ?? 0.012
  const columnCount = layout.columnEdges.length - 1
  const personArea = 1 - layout.dayColumnWidth

  // Il mese si taglia a metà perché il filetto centrale è l unico praticamente
  // orizzontale in entrambe le foto: è la cucitura meno rischiosa.
  const half = Math.ceil(daysInMonth / 2)
  const halves = [
    { dayFrom: 1, dayTo: half, top: layout.headerHeight, bottom: layout.headerHeight + (1 - layout.headerHeight) * (half / daysInMonth) + overlap },
    { dayFrom: half + 1, dayTo: daysInMonth, top: layout.headerHeight + (1 - layout.headerHeight) * (half / daysInMonth) - overlap, bottom: 1 },
  ]

  const bands: BandSpec[] = []

  for (let first = 0; first < columnCount; first += columnsPerBand) {
    const columns = []
    for (let c = first; c < Math.min(first + columnsPerBand, columnCount); c += 1) columns.push(c)

    // Il ritaglio parte sempre dal bordo sinistro del riquadro, così la colonna dei
    // giorni entra in ogni banda: dopo il raddrizzamento è allineata alle righe, e
    // comporla a parte sfaserebbe (misurato: fino a una riga intera di scarto).
    const rightEdge =
      layout.dayColumnWidth + layout.columnEdges[columns.at(-1)! + 1] * personArea

    for (const half of halves) {
      const top = Math.max(0, half.top)
      bands.push({
        columns,
        dayFrom: half.dayFrom,
        dayTo: half.dayTo,
        crop: {
          left: 0,
          top,
          width: Math.min(1, rightEdge),
          height: Math.min(1, half.bottom) - top,
        },
      })
    }
  }

  return bands
}
```

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/modules/ingest/layout.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: describe the roster layout and plan the crop bands"
```

---

### Task 4: Produrre le bande da una foto

**Files:**
- Create: `src/modules/ingest/crop.ts`
- Modify: `src/modules/ingest/index.ts`
- Test: `tests/modules/ingest/crop.test.ts`

**Interfaces:**
- Consumes: `detectTableQuad` da `./grid`, `warpPerspective` da `@/lib/homography`, `planBands`/`DEFAULT_ROSTER_LAYOUT` da `./layout`, `sharp`
- Produces: da `@/modules/ingest`: `interface RosterBand { spec: BandSpec; image: Buffer; width: number; height: number }`, `deskewRoster(image: Buffer, options?: { width?: number }): Promise<{ data: Buffer; width: number; height: number }>`, `cropRosterBands(image: Buffer, options: { daysInMonth: number; layout?: RosterLayout; columnsPerBand?: number }): Promise<RosterBand[]>`

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/ingest/crop.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { cropRosterBands, deskewRoster } from '@/modules/ingest'

const AGOSTO = join(process.cwd(), 'fixtures', 'roster-2026-08-3piano.jpeg')
const SETTEMBRE = join(process.cwd(), 'fixtures', 'roster-2026-09-3piano.jpeg')

describe('deskewRoster', () => {
  it('produce un immagine JPEG della larghezza richiesta', async () => {
    const out = await deskewRoster(readFileSync(AGOSTO), { width: 1000 })
    expect(out.width).toBe(1000)
    const meta = await sharp(out.data).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('raddrizza entrambe le foto senza fallire, nonostante orientamenti diversi', async () => {
    for (const path of [AGOSTO, SETTEMBRE]) {
      const out = await deskewRoster(readFileSync(path))
      expect(out.width).toBeGreaterThan(0)
      expect(out.height).toBeGreaterThan(0)
    }
  })
})

describe('cropRosterBands', () => {
  it('produce otto bande per un mese di 31 giorni', async () => {
    const bands = await cropRosterBands(readFileSync(AGOSTO), { daysInMonth: 31 })
    expect(bands).toHaveLength(8)
  })

  it('ogni banda è un JPEG non vuoto e più leggero della foto intera', async () => {
    const original = readFileSync(AGOSTO)
    const bands = await cropRosterBands(original, { daysInMonth: 31 })

    for (const band of bands) {
      expect(band.image.byteLength).toBeGreaterThan(1000)
      expect(band.image.byteLength).toBeLessThan(original.byteLength)
      expect((await sharp(band.image).metadata()).format).toBe('jpeg')
    }
  })

  it('le bande coprono insieme tutte le colonne e tutti i giorni', async () => {
    const bands = await cropRosterBands(readFileSync(SETTEMBRE), { daysInMonth: 30 })

    const colonne = new Set(bands.flatMap((b) => b.spec.columns))
    expect(colonne.size).toBe(8)
    for (let day = 1; day <= 30; day += 1) {
      expect(bands.some((b) => day >= b.spec.dayFrom && day <= b.spec.dayTo)).toBe(true)
    }
  })

  it('fallisce con un errore comprensibile se la foto non contiene una tabella', async () => {
    const bianco = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer()

    await expect(cropRosterBands(bianco, { daysInMonth: 31 })).rejects.toThrow(/griglia/i)
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/ingest/crop.test.ts`
Expected: FAIL — funzioni inesistenti.

- [ ] **Step 3: Implementare**

Crea `src/modules/ingest/crop.ts`. Struttura: `deskewRoster` legge i pixel raw con `sharp`, chiama `detectTableQuad`, passa il quadrilatero a `warpPerspective` e ricompone un JPEG con `sharp`; `cropRosterBands` raddrizza una volta e poi estrae ogni banda con `sharp().extract()`, ingrandendo il ritaglio a una larghezza fissa (comincia da 900 px: il ritaglio misurato al 100% era 700x1313 e costava 4020 token totali, quindi c'è margine, ma **resta sotto il tetto di token al minuto**).

Ricorda di esportare tutto da `src/modules/ingest/index.ts`.

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/modules/ingest`
Expected: PASS. Riporta il numero.

- [ ] **Step 5: Guardare le bande**

Salva le otto bande di agosto in una cartella temporanea (non nel repository), **guardale con lo strumento Read** e verifica nel report: la colonna dei giorni è leggibile in ciascuna? Le due colonne di persona sono intere, senza mangiare la vicina? L'intestazione col nome è visibile? Se qualcosa non torna, correggi le frazioni in `layout.ts` e dillo nel report — è esattamente per questo che le frazioni stanno in un file di configurazione.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: deskew a roster photo and cut it into readable bands"
```

---

### Task 5: Schema, prompt e fusione delle bande

**Files:**
- Create: `src/modules/extract/band-schema.ts`, `src/modules/extract/band-prompt.ts`
- Test: `tests/modules/extract/band-schema.test.ts`, `tests/modules/extract/band-prompt.test.ts`

**Interfaces:**
- Produces: da `@/modules/extract/band-schema`: `bandExtractionSchema` (Zod: `{ columns: string[], cells: { day, column, code, confidence, handCorrected }[] }` — **senza** `year`/`month`/`ward`, che una banda non mostra), `type BandExtraction`, `parseBandExtraction(raw: string)`, `mergeBandExtractions(results: Array<{ spec: BandSpec; extraction: BandExtraction }>, header: { year: number; month: number; ward: string }): { extraction: Extraction; conflicts: number }`
- Produces: da `@/modules/extract/band-prompt`: `buildBandPrompt(knownCodes: string[], context: { dayFrom: number; dayTo: number; columnCount: number }): string`

**Le regole della fusione, che sono la parte delicata:**
1. L'unione delle celle di tutte le bande forma l'`Extraction` finale; `columns` è l'unione ordinata dei nomi letti.
2. Le due metà del mese si sovrappongono di una riga: la stessa cella può arrivare da due bande. In quel caso **vince la confidenza più alta**, e se sono pari vince la prima; ogni collisione con codici *diversi* incrementa `conflicts`.
3. Una cella con giorno fuori dall'intervallo dichiarato della banda va **scartata** e conteggiata come conflitto: significa che il modello ha letto una riga che non gli era stata data.
4. `year`, `month`, `ward` vengono dal chiamante, non dal modello: la banda non li mostra e chiederglieli inviterebbe a inventarli.

- [ ] **Step 1: Scrivere i test** (falliranno)

Copri, per la fusione: unione semplice di due bande disgiunte; sovrapposizione con confidenze diverse (vince la più alta); sovrapposizione con codici diversi (conteggiata in `conflicts`); cella con giorno fuori intervallo scartata; `columns` unione ordinata senza duplicati; header preso dal chiamante. Per lo schema: rifiuto di `year`/`month` se presenti non è necessario (campi in più si ignorano), ma verifica che l'assenza di `columns` o `cells` sia rifiutata e che una confidenza fuori 0..1 sia rifiutata. Per il prompt: contiene i codici noti, dice l'intervallo di giorni, dice quante colonne aspettarsi, **chiede esplicitamente di riportare anche le righe vuote** e di leggere il giorno dalla colonna a sinistra.

- [ ] **Step 2-4: rosso, implementazione, verde**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: per-band extraction schema, prompt and merge"
```

---

### Task 6: Orchestrazione a bande con pacing e parziali

**Files:**
- Create: `src/modules/extract/extract-bands.ts`
- Modify: `src/modules/extract/index.ts`
- Test: `tests/modules/extract/extract-bands.test.ts`

**Interfaces:**
- Produces: da `@/modules/extract`: `interface BandFailure { spec: BandSpec; error: string }`, `interface BandsOutcome { extraction: Extraction; rawOutputs: string[]; failures: BandFailure[]; conflicts: number; provider: string; attempts: number }`, `extractRosterByBands(input: { bands: RosterBand[]; knownCodes: string[]; header: { year: number; month: number; ward: string }; provider: VisionProvider; fallback?: VisionProvider | null; pace?: (index: number) => Promise<void> }): Promise<BandsOutcome>`

**Comportamento richiesto:**
- Le bande si elaborano **in sequenza**, non in parallelo: il tetto è sui token al minuto e il parallelismo lo farebbe scattare subito.
- Fra una banda e l'altra si chiama `pace(index)`; il default attende quanto serve a stare sotto il tetto, e **nei test viene iniettata una funzione che non attende** (nessun test deve dormire).
- Una banda che fallisce (troncamento, rate limit, formato irreparabile) **non interrompe le altre**: finisce in `failures` con il motivo, e l'estrazione prosegue.
- Se `VisionProviderError` porta `retryAfterSeconds`, il pacer di produzione lo rispetta. Un solo ritentativo per banda, poi si passa avanti.
- `BandsOutcome` è sempre restituito, anche con zero celle: chi chiama decide se è utilizzabile. Non lanciare.

- [ ] **Step 1: Scrivere i test** (falliranno)

Copri: due bande riuscite si fondono; una banda fallita finisce in `failures` e le altre sono comunque presenti; le bande sono chiamate in sequenza (verifica l'ordine delle chiamate al provider finto); `pace` viene chiamato fra le bande e **non** dopo l'ultima; un `retryAfterSeconds` sull'errore viene passato al pacer; con tutte le bande fallite si ottiene un outcome con zero celle e otto `failures` invece di un'eccezione.

- [ ] **Step 2-4: rosso, implementazione, verde**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: extract a roster band by band, pacing calls and keeping partials"
```

---

### Task 7: Persistere un'estrazione parziale

**Files:**
- Modify: `prisma/schema.prisma`, `src/modules/roster/repository.ts`
- Create: migrazione
- Test: `tests/modules/roster/partial.test.ts`

**Interfaces:**
- Produces: `Roster.missingBands String?` (JSON con le bande non lette) e lo stato `partial`; `saveExtraction` accetta `meta: { provider: string; rawOutput: string; missingBands?: BandFailure[] }` e imposta `status: 'partial'` quando ce ne sono, `'extracted'` quando non ce ne sono.

**Perché conta:** l'infermiera deve poter vedere che tre celle non sono state lette per un problema tecnico, e non confonderle con tre celle vuote sul foglio. Una cella mancante silenziosa è un turno che scompare.

- [ ] **Step 1-5: test rossi, schema, migrazione, implementazione, verde, commit**

```bash
git commit -m "feat: record which bands were not read on a partial extraction"
```

---

### Task 8: Misurare la nuova strategia

**Files:**
- Modify: `scripts/eval-extraction.ts`
- Test: nessuno nuovo (lo script non è testabile senza rete)

**Comportamento:** per ogni fixture, raddrizza, taglia in bande, estrae banda per banda con il pacing reale, fonde, confronta con `*.expected.json` e stampa: accuratezza per cella e per colonna, bande fallite, conflitti di fusione, token e tempo totali, oltre alle metriche su `handCorrected` e sulle fasce di confidenza già presenti.

- [ ] **Step 1: Aggiornare lo script**

- [ ] **Step 2: Verifica senza chiave**

Run: `GROQ_API_KEY= npm run eval`
Expected: messaggio comprensibile, codice di uscita diverso da zero.

- [ ] **Step 3: LA MISURA**

Run: `npm run eval`
Expected: entrambe le foto misurate. Riporta l'output completo nel report.

**Non modificare il prompt, le fixture o le frazioni per far salire il numero.** Se l'accuratezza è bassa, il dato è il dato: si riporta e si decide dopo. Se una foto va in rate limit malgrado il pacing, riporta i token consumati per banda: serviranno a tarare l'attesa.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: measure the band-based extraction strategy"
```

---

## Definizione di completamento

- [ ] `npm test` verde, `npm run lint` e `npm run build` puliti
- [ ] `npm run eval` misura **entrambe** le foto senza incorrere nel tetto di token
- [ ] Le bande di entrambe le foto sono state guardate a occhio e contengono ciò che devono
- [ ] Una banda fallita produce un buco dichiarato, non una cella assente in silenzio
- [ ] Nessun test attende in tempo reale

## Il criterio di decisione, di nuovo

- **oltre il 95%** di celle corrette: si passa alla Fase 2B (upload e visualizzazione) con questa strategia
- **fra l'85% e il 95%**: si passa alla 2B, e la griglia di conferma della Fase 3 diventa il pezzo su cui investire
- **sotto l'85%**: si riapre la questione del provider con i numeri in mano — a quel punto il confronto con un modello più capace non è più una preferenza ma una necessità misurata
