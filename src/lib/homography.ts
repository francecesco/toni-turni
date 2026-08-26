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
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
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
