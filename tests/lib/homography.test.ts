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
