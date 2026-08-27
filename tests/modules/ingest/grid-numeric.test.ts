import { describe, expect, it } from 'vitest'
import {
  fitComb,
  fitLine,
  findBorderRule,
  findValleys,
  intersect,
  lineAt,
  median,
  medianGap,
  sideMax,
  traceRules,
  trackBoundaries,
} from '@/modules/ingest/grid-numeric'

/**
 * Le primitive numeriche del rilevamento della griglia. Sono il posto dove
 * l'errore è invisibile a occhio: un massimo mobile calcolato su mezza finestra
 * ha prodotto un riquadro sbagliato di una riga intera su una foto reale senza
 * che nessun test end-to-end lo notasse. Ogni primitiva ha qui il suo test
 * diretto, con i casi limite per primi.
 */

describe('sideMax', () => {
  it('guarda da un lato solo: un impulso isolato si propaga in una direzione sola', () => {
    const valori = new Float64Array(11)
    valori[5] = 100

    const indietro = Array.from(sideMax(valori, 2, -1))
    const avanti = Array.from(sideMax(valori, 2, 1))

    // il massimo su [i-2, i-1] vede l'impulso alle posizioni 6 e 7
    expect(indietro.slice(4, 9)).toEqual([0, 0, 100, 100, 0])
    // il massimo su [i+1, i+2] lo vede alle posizioni 3 e 4
    expect(avanti.slice(2, 7)).toEqual([0, 100, 100, 0, 0])
  })

  it('dichiara -Infinity dove la finestra esce dal profilo, invece di inventare un riferimento', () => {
    const valori = Float64Array.from([7, 8, 9])

    expect(sideMax(valori, 2, -1)[0]).toBe(-Infinity)
    expect(sideMax(valori, 2, 1)[2]).toBe(-Infinity)
  })

  it('non include il valore nella propria finestra', () => {
    const valori = Float64Array.from([1, 100, 1, 1])
    expect(sideMax(valori, 1, -1)[1]).toBe(1)
    expect(sideMax(valori, 1, 1)[1]).toBe(1)
  })

  it('è il criterio che distingue un filetto da un gradino', () => {
    // filetto: carta chiara da entrambi i lati → scuro rispetto a min(prima, dopo)
    const filetto = Float64Array.from([220, 220, 120, 220, 220])
    // gradino (bordo del foglio sullo sfondo): chiaro solo da un lato
    const gradino = Float64Array.from([220, 220, 120, 120, 120])
    const contrastoDiFiletto = (v: Float64Array, i: number): number => {
      const prima = sideMax(v, 2, -1)[i]
      const dopo = sideMax(v, 2, 1)[i]
      return Math.min(prima, dopo) - v[i]
    }

    expect(contrastoDiFiletto(filetto, 2)).toBe(100)
    expect(contrastoDiFiletto(gradino, 2)).toBe(0)
  })
})

describe('findValleys', () => {
  it('trova le zone sotto soglia, con posizione del minimo, profondità e larghezza', () => {
    const p = new Array<number>(100).fill(100)
    p[30] = 20
    p[31] = 5
    p[32] = 30
    p[70] = 40

    const valli = findValleys(p, 50)

    expect(valli.map((v) => v.index)).toEqual([31, 70])
    // la profondità è misurata rispetto alla soglia, non rispetto al massimo
    expect(valli[0].depth).toBe(45)
    expect(valli[0].width).toBe(3)
    expect(valli[1].depth).toBe(10)
  })

  it('scarta le valli troppo larghe per essere un filetto', () => {
    const p = new Array<number>(100).fill(100)
    for (let i = 20; i < 40; i += 1) p[i] = 10
    p[70] = 10

    expect(findValleys(p, 50, 5).map((v) => v.index)).toEqual([70])
  })

  it('chiude una valle aperta a fine profilo', () => {
    const p = [100, 100, 10, 10]
    expect(findValleys(p, 50).map((v) => v.width)).toEqual([2])
  })

  it('non trova nulla sopra soglia', () => {
    expect(findValleys(new Array<number>(50).fill(100), 50)).toEqual([])
  })
})

describe('median e medianGap', () => {
  it('median su lunghezza pari fa la media dei due centrali', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('medianGap misura il passo fra punti consecutivi', () => {
    expect(medianGap([10, 40, 70, 101, 132])).toBe(30.5)
  })

  it('medianGap è 0 con meno di due punti', () => {
    expect(medianGap([7])).toBe(0)
  })
})

const dip = (index: number, depth = 50) => ({ index, depth, width: 2 })

/** Venti filetti con passo che cresce da 30 a 36: una tabella fotografata di sbieco. */
const passoDerivante = (): number[] => {
  const posizioni = [100]
  for (let i = 1; i < 20; i += 1) posizioni.push(posizioni[i - 1] + 30 + i * 0.3)
  return posizioni.map((p) => Math.round(p))
}

describe('fitComb', () => {
  it('misura il passo di una sequenza regolare e ne restituisce le posizioni misurate', () => {
    const posizioni = Array.from({ length: 20 }, (_, i) => 100 + i * 30)
    const comb = fitComb(posizioni.map((p) => dip(p)), 6, 100)

    expect(comb).not.toBeNull()
    expect(comb!.step).toBeCloseTo(30, 0)
    expect(comb!.lines).toEqual(posizioni)
  })

  it('non confonde il passo con la sua metà né con il suo doppio', () => {
    const posizioni = Array.from({ length: 20 }, (_, i) => 100 + i * 30)
    const comb = fitComb(posizioni.map((p) => dip(p)), 6, 100)
    expect(comb!.step).toBeGreaterThan(25)
    expect(comb!.step).toBeLessThan(35)
  })

  it('sopravvive a un filetto mancante in mezzo', () => {
    const posizioni = Array.from({ length: 20 }, (_, i) => 100 + i * 30).filter((_, i) => i !== 9)
    const comb = fitComb(posizioni.map((p) => dip(p)), 6, 100)

    expect(comb!.step).toBeCloseTo(30, 0)
    expect(comb!.lines).toEqual(posizioni)
  })

  it('scarta gli avvallamenti fuori passo (testo dentro le celle)', () => {
    const filetti = Array.from({ length: 20 }, (_, i) => 100 + i * 30)
    const testo = [112, 118, 145, 263, 471]
    const comb = fitComb([...filetti, ...testo].map((p) => dip(p)), 6, 100)

    expect(comb!.lines).toEqual(filetti)
  })

  it('misura un passo plausibile anche quando la prospettiva lo fa derivare', () => {
    // il passo cresce da 30 a 36: è così che si presenta una tabella fotografata
    // di sbieco. Un pettine rigido non può agganciare tutti i filetti (a questo
    // serve traceRules), ma il passo misurato deve stare nell'intervallo vero.
    const comb = fitComb(passoDerivante().map((p) => dip(p)), 6, 100)

    expect(comb!.step).toBeGreaterThanOrEqual(30)
    expect(comb!.step).toBeLessThanOrEqual(36)
    expect(comb!.lines.length).toBeGreaterThanOrEqual(14)
  })

  it('restituisce null quando non c’è nessuna sequenza periodica', () => {
    expect(fitComb([dip(10), dip(11)], 6, 100)).toBeNull()
    expect(fitComb([dip(10), dip(203), dip(517)], 6, 100)).toBeNull()
  })
})

describe('traceRules', () => {
  it('segue tutta la sequenza anche quando il passo deriva', () => {
    const posizioni = passoDerivante()
    const semi = posizioni.slice(4, 12)

    const tracciati = traceRules(posizioni.map((p) => dip(p)), semi, 32)

    expect(tracciati).toEqual(posizioni)
  })

  it('scavalca un filetto mancante senza perdere il resto della sequenza', () => {
    const posizioni = passoDerivante()
    const buco = posizioni.filter((_, i) => i !== 14)

    const tracciati = traceRules(buco.map((p) => dip(p)), posizioni.slice(4, 12), 32)

    expect(tracciati).toEqual(buco)
  })

  it('si ferma dove la tabella finisce, senza inventare filetti', () => {
    const posizioni = passoDerivante()
    const tracciati = traceRules(posizioni.map((p) => dip(p)), posizioni.slice(4, 12), 32)

    expect(tracciati.at(-1)).toBe(posizioni.at(-1))
    expect(tracciati[0]).toBe(posizioni[0])
  })

  it('non aggancia gli avvallamenti del testo dentro le celle', () => {
    const posizioni = passoDerivante()
    const testo = posizioni.flatMap((p) => [p + 12, p + 16])

    const tracciati = traceRules([...posizioni, ...testo].map((p) => dip(p)), posizioni.slice(4, 12), 32)

    expect(tracciati).toEqual(posizioni)
  })
})

describe('findBorderRule', () => {
  /**
   * La riga di intestazione di una tabella è più alta delle righe dei giorni,
   * quindi il suo filetto cade fuori passo e va cercato a parte.
   */
  it('trova un filetto oltre la sequenza, più lontano di un passo', () => {
    const dips = [dip(100), dip(143, 80), dip(180)]

    const trovato = findBorderRule(dips, 143, -1, 30, { minDepth: 20, maxWidth: 5 })

    expect(trovato).toBe(100)
  })

  it('non trova nulla se oltre la sequenza c’è solo carta', () => {
    const dips = [dip(143, 80), dip(180)]
    expect(findBorderRule(dips, 143, -1, 30, { minDepth: 20, maxWidth: 5 })).toBeNull()
  })

  it('ignora gli avvallamenti troppo vicini (mezzo passo: è testo, non un filetto)', () => {
    const dips = [dip(130), dip(143, 80)]
    expect(findBorderRule(dips, 143, -1, 30, { minDepth: 20, maxWidth: 5 })).toBeNull()
  })

  it('ignora gli avvallamenti troppo larghi (il bordo del foglio) e quelli troppo pallidi', () => {
    const largo = [{ index: 100, depth: 80, width: 40 }, dip(143, 80)]
    const pallido = [{ index: 100, depth: 8, width: 2 }, dip(143, 80)]

    expect(findBorderRule(largo, 143, -1, 30, { minDepth: 20, maxWidth: 5 })).toBeNull()
    expect(findBorderRule(pallido, 143, -1, 30, { minDepth: 20, maxWidth: 5 })).toBeNull()
  })

  it('cerca anche in avanti', () => {
    const dips = [dip(100, 80), dip(155)]
    expect(findBorderRule(dips, 100, +1, 30, { minDepth: 20, maxWidth: 5 })).toBe(155)
  })
})

describe('trackBoundaries', () => {
  /**
   * Un filetto verticale vero attraversa tutta la tabella, quindi si ritrova in
   * ogni fascia: è l'unico modo di distinguerlo dall'ombra fra due fogli
   * appoggiati uno accanto all'altro, che nella foto è una linea scura con carta
   * da entrambi i lati esattamente come un filetto, ma esiste solo in cima.
   */
  const fasce = [
    { at: 100, positions: [40, 60, 160, 260] },
    { at: 200, positions: [55, 156, 257] },
    { at: 300, positions: [50, 152, 252, 400] },
  ]

  it('segue ogni filetto attraverso le fasce, tollerando la deriva', () => {
    const chains = trackBoundaries(fasce, 20)
    const complete = chains.filter((c) => c.length === 3)

    expect(complete).toHaveLength(3)
    expect(complete[0].map((p) => p.y)).toEqual([60, 55, 50])
    expect(complete.map((c) => c[0].y)).toEqual([60, 160, 260])
  })

  it('lascia in una catena sua i filetti che compaiono in una fascia sola', () => {
    const chains = trackBoundaries(fasce, 20)
    const isolate = chains.filter((c) => c.length === 1).map((c) => c[0].y)

    expect(isolate).toEqual([40, 400])
  })

  it('porta la posizione della fascia come ascissa, così il lato si può interpolare', () => {
    const chains = trackBoundaries(fasce, 20)
    expect(chains[0][0]).toEqual({ x: 100, y: 40 })
  })

  it('non unisce filetti più distanti della tolleranza', () => {
    const chains = trackBoundaries(
      [
        { at: 0, positions: [100] },
        { at: 10, positions: [140] },
      ],
      20,
    )
    expect(chains.map((c) => c.length)).toEqual([1, 1])
  })
})

describe('fitLine e intersect', () => {
  it('interpola una retta per punti allineati', () => {
    const line = fitLine([
      { x: 0, y: 10 },
      { x: 100, y: 20 },
      { x: 200, y: 30 },
    ])
    expect(line.slope).toBeCloseTo(0.1, 6)
    expect(lineAt(line, 50)).toBeCloseTo(15, 6)
  })

  it('con un solo punto restituisce una retta orizzontale per quel punto', () => {
    const line = fitLine([{ x: 42, y: 7 }])
    expect(line.slope).toBe(0)
    expect(lineAt(line, 1000)).toBe(7)
  })

  it('interseca il lato superiore col lato sinistro', () => {
    // lato superiore: y = 0.02x + 100 ; lato sinistro: x = -0.01y + 50
    const orizzontale = { slope: 0.02, intercept: 100 }
    const verticale = { slope: -0.01, intercept: 50 }

    const p = intersect(orizzontale, verticale)

    expect(p.x).toBeCloseTo(-0.01 * p.y + 50, 6)
    expect(p.y).toBeCloseTo(0.02 * p.x + 100, 6)
  })
})
