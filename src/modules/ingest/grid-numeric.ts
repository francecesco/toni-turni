import type { Point } from '@/lib/homography'
import { GridNotFoundError } from './grid-types'

/**
 * Le primitive numeriche del rilevamento della griglia, senza immagini né
 * dipendenze: profili di luminosità in entrata, posizioni di filetti in uscita.
 * Stanno in un file a parte perché sono la parte del rilevamento in cui un
 * errore non si vede a occhio, e vanno testate una per una.
 */

/** Un avvallamento del profilo: dove sta, quanto è profondo, quanto è largo. */
export interface Dip {
  index: number
  depth: number
  /** Larghezza in campioni della zona scura che lo contiene: un filetto stampato è sottile. */
  width: number
}

/** Una sequenza periodica di filetti riconosciuta in un profilo. */
export interface Comb {
  /** Passo misurato fra filetti consecutivi (mediana degli intervalli). */
  step: number
  /** Posizioni misurate dei filetti, in ordine crescente. */
  lines: number[]
  /** Qualità della spiegazione: filetti agganciati meno posizioni rimaste vuote. */
  score: number
}

/** Una retta nella forma `coord = slope * t + intercept`. */
export interface Line {
  slope: number
  intercept: number
}

/** Tolleranza dell'aggancio al pettine, in frazione del passo. */
const COMB_TOL_FRAC = 0.3
/** Sotto tre filetti non si può parlare di sequenza periodica. */
const MIN_COMB_LINES = 3
/** Frazione minima di posizioni del pettine effettivamente occupate da un filetto. */
const MIN_COMB_FILL = 0.6
/** Quante fasi provare per ciascun passo candidato. */
const PHASES_PER_STEP = 3

/**
 * Massimo dei valori che stanno **da un solo lato**: su `[i-radius, i-1]` con
 * `direction = -1`, su `[i+1, i+radius]` con `direction = +1`. La finestra viene
 * troncata dove esce dal profilo, e solo se ne esce del tutto — cioè al primo
 * campione, dove da quel lato non c'è nessun vicino — restituisce `-Infinity`,
 * così chi lo usa sa che quel lato non ha un riferimento invece di credere a un
 * riferimento inventato. Chi ha bisogno di una finestra piena deve scartare i
 * `radius` campioni agli estremi (lo fa `dropMargin` in `grid-lines`).
 *
 * Guardare i due lati separatamente è ciò che distingue un filetto da un
 * gradino: un filetto stampato ha carta più chiara *da entrambe le parti*, il
 * bordo del foglio sullo sfondo ha carta da una parte sola. Con una sola
 * finestra — simmetrica o, peggio, dimezzata per errore — le due cose sono
 * indistinguibili.
 */
export function sideMax(values: Float64Array, radius: number, direction: -1 | 1): Float64Array {
  const n = values.length
  const out = new Float64Array(n).fill(-Infinity)
  const deque: number[] = []

  const from = direction === -1 ? 0 : n - 1
  const to = direction === -1 ? n : -1
  for (let i = from; i !== to; i -= direction) {
    while (deque.length && Math.abs(deque[0] - i) > radius) deque.shift()
    out[i] = deque.length ? values[deque[0]] : -Infinity
    while (deque.length && values[deque[deque.length - 1]] <= values[i]) deque.pop()
    deque.push(i)
  }
  return out
}

/**
 * Trova le zone in cui il profilo scende sotto una soglia assoluta. Serve sui
 * profili di "filettosità" (`ruleProfile` in `grid-lines`), che sono già
 * normalizzati fra 0 e 100 e non hanno bisogno di una base locale: 0 significa
 * "tutti i pixel della striscia sono localmente scuri", cioè un filetto, e la
 * soglia è quindi una grandezza fisica ("un filetto attraversa almeno metà
 * della striscia") invece di un valore tarato su una foto.
 */
export function findValleys(profile: readonly number[], threshold: number, maxWidth?: number): Dip[] {
  const valleys: Dip[] = []
  let runStart = -1

  const closeRun = (end: number): void => {
    let bestIndex = runStart
    let bestValue = Infinity
    for (let k = runStart; k < end; k += 1) {
      if (profile[k] < bestValue) {
        bestValue = profile[k]
        bestIndex = k
      }
    }
    valleys.push({ index: bestIndex, depth: threshold - bestValue, width: end - runStart })
  }

  for (let i = 0; i < profile.length; i += 1) {
    const below = profile[i] < threshold
    if (below && runStart === -1) runStart = i
    if (!below && runStart !== -1) {
      closeRun(i)
      runStart = -1
    }
  }
  if (runStart !== -1) closeRun(profile.length)

  return maxWidth === undefined ? valleys : valleys.filter((v) => v.width <= maxWidth)
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Passo mediano fra punti consecutivi; 0 se i punti sono meno di due. */
export function medianGap(points: readonly number[]): number {
  if (points.length < 2) return 0
  const gaps: number[] = []
  for (let i = 1; i < points.length; i += 1) gaps.push(points[i] - points[i - 1])
  return median(gaps)
}

/** Le fasi più promettenti per un dato passo: i centri delle finestre di residui più popolate. */
function bestPhases(residues: Int32Array, tol: number): number[] {
  const step = residues.length
  const half = Math.min(Math.floor(tol), Math.floor((step - 1) / 2))
  const scores = new Int32Array(step)
  for (let phase = 0; phase < step; phase += 1) {
    let sum = 0
    for (let d = -half; d <= half; d += 1) sum += residues[(phase + d + step) % step]
    scores[phase] = sum
  }

  const chosen: number[] = []
  const taken = new Int8Array(step)
  for (let n = 0; n < PHASES_PER_STEP; n += 1) {
    let best = -1
    let bestScore = 0
    for (let phase = 0; phase < step; phase += 1) {
      if (taken[phase] || scores[phase] <= bestScore) continue
      bestScore = scores[phase]
      best = phase
    }
    if (best === -1) break
    chosen.push(best)
    for (let d = -half; d <= half; d += 1) taken[(best + d + step) % step] = 1
  }
  return chosen
}

/**
 * Toglie dalle due estremità le posizioni separate dal resto della sequenza da
 * una posizione vuota. Un buco è credibile **dentro** una sequenza — un filetto
 * sbiadito, una cella evidenziata — ma alle estremità no: non c'è niente da
 * scavalcare, e quello che sta oltre il buco appartiene a qualcos'altro. Sulla
 * foto di agosto quel qualcos'altro è il bordo del foglio con la propria riga
 * d'ombra, che il profilo a due lati non sa distinguere da un filetto: senza
 * questa potatura il pettine si allunga fino al bordo del foglio con lo stesso
 * punteggio del pettine giusto, e vince per numero di filetti.
 */
function trimIsolatedEnds(hooked: readonly { k: number; index: number }[]): { k: number; index: number }[] {
  const work = [...hooked]
  while (work.length >= 2 && work[1].k - work[0].k > 1) work.shift()
  while (work.length >= 2 && work[work.length - 1].k - work[work.length - 2].k > 1) work.pop()
  return work
}

/** Aggancia i dip alle posizioni del pettine (step, phase); null se la spiegazione è troppo lacunosa. */
function assignToComb(
  sorted: readonly Dip[],
  step: number,
  phase: number,
  tol: number,
): { lines: number[]; score: number } | null {
  const hooked: { k: number; index: number }[] = []
  let currentK: number | null = null
  let currentBest: Dip | null = null

  const flush = (): void => {
    if (currentBest && currentK !== null) hooked.push({ k: currentK, index: currentBest.index })
  }

  for (const dip of sorted) {
    const k = Math.round((dip.index - phase) / step)
    if (Math.abs(dip.index - (phase + k * step)) > tol) continue
    if (currentK === null) {
      currentK = k
      currentBest = dip
    } else if (k !== currentK) {
      flush()
      currentK = k
      currentBest = dip
    } else if (dip.depth > currentBest!.depth) {
      currentBest = dip
    }
  }
  flush()

  const kept = trimIsolatedEnds(hooked)
  if (kept.length < MIN_COMB_LINES) return null
  const positions = kept[kept.length - 1].k - kept[0].k + 1
  if (kept.length < MIN_COMB_FILL * positions) return null
  return { lines: kept.map((h) => h.index), score: 2 * kept.length - positions }
}

/**
 * Cerca la sequenza periodica di filetti che spiega meglio gli avvallamenti
 * trovati: per ogni passo plausibile prova le fasi più promettenti, premia gli
 * avvallamenti agganciati e penalizza le posizioni del pettine rimaste vuote.
 *
 * È il punto in cui il passo della griglia viene *misurato* invece che dedotto
 * dalle dimensioni della foto: tutti i raggi di ricerca a valle derivano da qui.
 * Penalizzare le posizioni vuote è ciò che impedisce di confondere il passo con
 * la sua metà (che aggancerebbe gli stessi filetti lasciando vuota una posizione
 * su due) o col suo doppio (che ne aggancerebbe la metà).
 */
export function fitComb(dips: readonly Dip[], minStep: number, maxStep: number): Comb | null {
  if (dips.length < MIN_COMB_LINES) return null
  const sorted = [...dips].sort((a, b) => a.index - b.index)

  let best: { step: number; lines: number[]; score: number } | null = null
  const from = Math.max(2, Math.floor(minStep))
  const to = Math.floor(maxStep)

  for (let step = from; step <= to; step += 1) {
    const tol = Math.max(1, step * COMB_TOL_FRAC)
    const residues = new Int32Array(step)
    for (const dip of sorted) residues[((dip.index % step) + step) % step] += 1

    for (const phase of bestPhases(residues, tol)) {
      const fit = assignToComb(sorted, step, phase, tol)
      if (!fit) continue
      const better =
        best === null || fit.score > best.score || (fit.score === best.score && fit.lines.length > best.lines.length)
      if (better) best = { step, lines: fit.lines, score: fit.score }
    }
  }

  if (!best) return null
  return { step: medianGap(best.lines), lines: best.lines, score: best.score }
}

/** Tolleranza dell'aggancio durante l'inseguimento, in frazione del passo locale. */
const TRACE_TOL_FRAC = 0.3
/**
 * Tolleranza per l'aggancio *scavalcando* una posizione, in frazione del passo.
 * È molto più stretta di quella normale perché la spiegazione alternativa — «non
 * è un filetto di questa tabella» — è molto più probabile: a due passi oltre
 * l'ultimo filetto, sulla foto di agosto, c'è il bordo del foglio con la sua
 * riga d'ombra, e con la tolleranza normale veniva agganciato (2,28 passi
 * invece di 2, cioè 9 px su una tolleranza di 9,6).
 */
const TRACE_SKIP_TOL_FRAC = 0.15
/** Peso del passo appena misurato nell'aggiornamento del passo locale. */
const TRACE_STEP_MEMORY = 0.6
/**
 * Profondità minima di un filetto agganciato, in frazione della profondità
 * mediana dei semi: un filetto della griglia è marcato come i suoi vicini,
 * una linea tre volte più pallida è un'ombra o una piega della carta.
 */
const TRACE_DEPTH_FRAC = 0.35

/**
 * L'avvallamento più vicino al bersaglio, fra quelli che stanno **oltre** `from`
 * nel verso della ricerca.
 *
 * Il vincolo di avanzamento non è un dettaglio: è ciò che fa terminare
 * l'inseguimento. Senza di esso, con avvallamenti distanti 1 il passo locale
 * parte da 1, la tolleranza vale 1 per il pavimento, e il bersaglio `from + 1`
 * aggancia l'avvallamento in `from` stesso; il passo locale scende a 0,6 e poi a
 * 0,36, il bersaglio non si sposta più e il ciclo non finisce. Con il vincolo,
 * `from` cresce di almeno un indice intero a ogni aggancio ed è limitato dagli
 * avvallamenti disponibili, quindi l'inseguimento termina per costruzione.
 */
function nearestDip(
  dips: readonly Dip[],
  from: number,
  direction: 1 | -1,
  target: number,
  tol: number,
  minDepth: number,
): Dip | null {
  let best: Dip | null = null
  let bestErr = Infinity
  for (const dip of dips) {
    if (dip.depth < minDepth) continue
    if ((dip.index - from) * direction <= 0) continue
    const err = Math.abs(dip.index - target)
    if (err > tol) continue
    if (err < bestErr) {
      bestErr = err
      best = dip
    }
  }
  return best
}

/**
 * Insegue la sequenza di filetti a partire dai semi, adattando il passo a ogni
 * aggancio. La prospettiva fa crescere il passo da un capo all'altro della
 * tabella (misurato: da 29 a 36 px sulla foto di agosto): un pettine rigido
 * perde i filetti alle estremità, che sono esattamente quelli che servono per
 * gli angoli del riquadro. Se al passo successivo non c'è nulla prova a
 * scavalcare una posizione, così un filetto sbiadito non tronca la sequenza.
 *
 * Uno scavalco vale però **solo se dall'altra parte la sequenza continua**: un
 * buco è qualcosa che sta *dentro* la sequenza, e in coda non c'è niente da
 * scavalcare. Senza questa condizione la sequenza si chiude su ciò che sta due
 * passi oltre l'ultimo filetto, e sulla foto di agosto quel qualcosa è il bordo
 * del foglio con la propria riga d'ombra — che il profilo a due lati non sa
 * distinguere da un filetto, perché è più scura sia della carta sopra sia della
 * scrivania sotto (misurato: carta 215, ombra 122, scrivania 142).
 *
 * L'inseguimento **termina per costruzione**: ogni aggancio, normale o
 * scavalcato, deve stare oltre la posizione corrente nel verso della ricerca
 * (vedi `nearestDip`), quindi `current` è strettamente monotona su indici interi
 * e limitata dagli avvallamenti disponibili. Prima la terminazione dipendeva da
 * un'invariante di `findValleys` — avvallamenti distanti almeno 2 — che stava
 * due funzioni più in là e non era scritta da nessuna parte.
 */
export function traceRules(dips: readonly Dip[], seed: readonly number[], step: number): number[] {
  if (seed.length === 0) return []
  const sorted = [...seed].sort((a, b) => a - b)
  const found = new Set<number>(sorted)
  const seedDepths = dips.filter((d) => found.has(d.index)).map((d) => d.depth)
  const minDepth = median(seedDepths) * TRACE_DEPTH_FRAC

  for (const direction of [1, -1] as const) {
    let current = direction === 1 ? sorted[sorted.length - 1] : sorted[0]
    let localStep = medianGap(sorted) || step
    // gli agganci ottenuti scavalcando un buco e non ancora confermati da un
    // aggancio al passo normale: se la sequenza si ferma qui, escono
    let daConfermare: number[] = []
    for (;;) {
      const tol = Math.max(1, localStep * TRACE_TOL_FRAC)
      const next = nearestDip(dips, current, direction, current + direction * localStep, tol, minDepth)
      if (next) {
        const gap = Math.abs(next.index - current)
        localStep = TRACE_STEP_MEMORY * localStep + (1 - TRACE_STEP_MEMORY) * gap
        current = next.index
        found.add(current)
        daConfermare = []
        continue
      }
      // un filetto sbiadito o coperto: si prova la posizione successiva, ma con
      // una tolleranza molto più stretta (vedi TRACE_SKIP_TOL_FRAC)
      const skipTol = Math.max(1, localStep * TRACE_SKIP_TOL_FRAC)
      const skipped = nearestDip(dips, current, direction, current + direction * 2 * localStep, skipTol, minDepth)
      if (!skipped) break
      current = skipped.index
      found.add(current)
      daConfermare.push(current)
    }
    for (const provvisorio of daConfermare) found.delete(provvisorio)
  }

  return [...found].sort((a, b) => a - b)
}

/**
 * Distanza minima e massima, in passi, a cui si cerca il filetto di bordo oltre
 * l'estremità della sequenza. Il minimo esclude il testo dentro l'ultima cella;
 * il massimo dice quanto può essere alta la riga del titolo, che è la ragione
 * per cui questa ricerca esiste (misurata: 1,0-1,3 righe normali).
 *
 * Il massimo deve stare **sotto i due passi**, ed è il punto importante: due
 * passi oltre l'ultimo filetto c'è la posizione di un filetto *mancante*, e
 * quella è competenza dell'inseguimento (`traceRules`), che la aggancia solo se
 * la sequenza continua dall'altra parte. Lasciando arrivare fin lì anche questa
 * ricerca, il bordo del foglio con la propria riga d'ombra rientrerebbe dalla
 * porta di servizio: è più scuro della carta e della scrivania, sta esattamente
 * dove finisce il foglio, e nessun criterio sul profilo lo distingue da un
 * filetto.
 */
const BORDER_NEAR_FRAC = 0.5
const BORDER_FAR_FRAC = 1.5

/**
 * Cerca un ulteriore filetto oltre l'estremità della sequenza, fra mezzo passo e
 * un passo e mezzo di distanza. La riga di intestazione di una tabella è più
 * alta delle righe dei giorni, quindi il suo filetto cade fuori passo e la
 * sequenza regolare non lo contiene: senza questa ricerca il riquadro taglia a
 * metà l'intestazione. I limiti su profondità e larghezza servono a non prendere
 * per filetto il testo dentro le celle né il bordo del foglio sullo sfondo.
 */
export function findBorderRule(
  dips: readonly Dip[],
  from: number,
  direction: 1 | -1,
  step: number,
  limits: { minDepth: number; maxWidth: number },
): number | null {
  const near = from + direction * step * BORDER_NEAR_FRAC
  const far = from + direction * step * BORDER_FAR_FRAC
  const lo = Math.min(near, far)
  const hi = Math.max(near, far)

  let best: Dip | null = null
  for (const dip of dips) {
    if (dip.index < lo || dip.index > hi) continue
    if (dip.depth < limits.minDepth || dip.width > limits.maxWidth) continue
    const better =
      best === null ||
      dip.depth > best.depth ||
      (dip.depth === best.depth && Math.abs(dip.index - from) > Math.abs(best.index - from))
    if (better) best = dip
  }
  return best?.index ?? null
}

/**
 * Segue ogni filetto attraverso una serie di fasce parallele, agganciando in
 * ciascuna la posizione più vicina a quella della fascia precedente.
 *
 * Serve a distinguere un filetto della griglia da qualunque altra linea scura
 * nella foto: un filetto attraversa tutta la tabella, quindi si ritrova in ogni
 * fascia. L'ombra fra due fogli appoggiati uno accanto all'altro — che sulla
 * foto di settembre esiste davvero, ed è scura con carta chiara da entrambi i
 * lati esattamente come un filetto — compare invece in una fascia sola.
 *
 * Le catene tornano ordinate per posizione nella prima fascia in cui compaiono.
 */
export function trackBoundaries(
  bands: readonly { at: number; positions: readonly number[] }[],
  tol: number,
): Point[][] {
  const chains: Point[][] = []

  for (const band of bands) {
    const used = new Set<Point[]>()
    for (const position of band.positions) {
      let best: Point[] | null = null
      let bestErr = Infinity
      for (const chain of chains) {
        if (used.has(chain)) continue
        const err = Math.abs(chain[chain.length - 1].y - position)
        if (err <= tol && err < bestErr) {
          bestErr = err
          best = chain
        }
      }
      if (best) {
        best.push({ x: band.at, y: position })
        used.add(best)
      } else {
        const fresh = [{ x: band.at, y: position }]
        chains.push(fresh)
        used.add(fresh)
      }
    }
  }

  return chains
}

/** Retta ai minimi quadrati per i punti dati; con un solo punto, la retta costante che lo contiene. */
export function fitLine(points: readonly Point[]): Line {
  if (points.length === 0) return { slope: 0, intercept: 0 }
  if (points.length === 1) return { slope: 0, intercept: points[0].y }

  const n = points.length
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
    sxx += p.x * p.x
    sxy += p.x * p.y
  }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sy / n }
  const slope = (n * sxy - sx * sy) / denom
  return { slope, intercept: (sy - slope * sx) / n }
}

export function lineAt(line: Line, t: number): number {
  return line.slope * t + line.intercept
}

/**
 * Intersezione fra un lato orizzontale (`y = slope*x + intercept`) e un lato
 * verticale (`x = slope*y + intercept`): è così che si ottiene un angolo del
 * riquadro dai due filetti che lo formano, invece di accoppiare una x e una y
 * misurate in punti diversi della tabella.
 */
export function intersect(horizontal: Line, vertical: Line): Point {
  const denom = 1 - horizontal.slope * vertical.slope
  if (Math.abs(denom) < 1e-9) {
    // praticamente irraggiungibile (serve prodotto delle pendenze = 1), ma
    // `detectTableQuad` promette di fallire solo con GridNotFoundError
    throw new GridNotFoundError('I lati trovati non si incontrano: non definiscono un angolo del riquadro')
  }
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / denom
  return { x, y: horizontal.slope * x + horizontal.intercept }
}
