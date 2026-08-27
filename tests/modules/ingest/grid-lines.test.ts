import { describe, expect, it } from 'vitest'
import {
  detectColumnBoundaries,
  detectHorizontalEdges,
  detectRules,
  detectVerticalEdges,
  fitEdge,
} from '@/modules/ingest/grid-lines'
import { GridNotFoundError } from '@/modules/ingest/grid-types'
import { lineAt } from '@/modules/ingest/grid-numeric'

/**
 * `fitEdge` è la difesa contro il difetto che ha fatto respingere la prima
 * versione di questo task: un lato del riquadro che aggancia l'ultimo filetto da
 * un'estremità e il penultimo dall'altra, cioè un riquadro sbagliato di una riga
 * intera senza che nessuna coordinata risulti assurda. Il cancello sull'angolo
 * non intercetta quell'errore (i lati divergono di ~2°), quindi questa funzione
 * è l'unica difesa e va provata da sola: sulle due foto di calibrazione è
 * black-box, e la re-review ha mostrato che in black-box il difetto non si vede.
 */

const PASSO = 32
/** Filetto vero: y = 1100 + 0,03x, campionato su cinque strisce. */
const ascisse = [0, 250, 500, 750, 1000]
const filettoVero = (x: number): number => 1100 + 0.03 * x
const puntiVeri = ascisse.map((x) => ({ x, y: filettoVero(x) }))

/** Sposta di un passo intero i punti indicati: è come si presenta un filetto sbagliato. */
const conFuoriposto = (indici: number[]) =>
  puntiVeri.map((p, i) => (indici.includes(i) ? { ...p, y: p.y - PASSO } : p))

describe('fitEdge', () => {
  it('interpola il filetto quando tutte le strisce concordano', () => {
    const line = fitEdge(puntiVeri, PASSO, 'il lato inferiore')

    expect(lineAt(line, 1000)).toBeCloseTo(1130, 1)
    expect(lineAt(line, 0)).toBeCloseTo(1100, 1)
  })

  it('scarta una striscia fuori di un passo, senza spostare il lato', () => {
    const line = fitEdge(conFuoriposto([4]), PASSO, 'il lato inferiore')

    // il lato resta sul filetto vero: il punto fuori non lo tira
    expect(Math.abs(lineAt(line, 1000) - 1130)).toBeLessThan(PASSO * 0.35)
  })

  it('scarta due strisce fuori di un passo alla stessa estremità', () => {
    const line = fitEdge(conFuoriposto([3, 4]), PASSO, 'il lato inferiore')

    expect(Math.abs(lineAt(line, 1000) - 1130)).toBeLessThan(PASSO * 0.35)
  })

  it('con quattro strisce e una fuori posto non sposta il lato di un passo', () => {
    // è il caso reale di agosto: una striscia su cinque si ancora sul bordo del
    // foglio e viene scartata, quindi il lato si interpola su quattro punti
    const quattro = conFuoriposto([4]).slice(1)
    const line = fitEdge(quattro, PASSO, 'il lato inferiore')

    expect(Math.abs(lineAt(line, 1000) - 1130)).toBeLessThan(PASSO * 0.35)
  })

  it('fallisce quando le strisce concordi scendono sotto il minimo, invece di inventare un lato', () => {
    // tre punti, uno fuori di un passo: due concordi non bastano a definire un
    // lato di cui fidarsi, e una retta ai minimi quadrati su tre punti
    // spalmerebbe il passo intero in residui che passano la tolleranza
    const tre = [puntiVeri[0], puntiVeri[2], { ...puntiVeri[4], y: filettoVero(1000) - PASSO }]

    expect(() => fitEdge(tre, PASSO, 'il lato inferiore')).toThrow(GridNotFoundError)
    expect(() => fitEdge(tre, PASSO, 'il lato inferiore')).toThrow(/strisce concordi.*lato inferiore/i)
  })

  it('fallisce quando i punti concordi sono meno del minimo perché sparsi', () => {
    const sparsi = [
      { x: 0, y: 1100 },
      { x: 250, y: 1240 },
      { x: 500, y: 1050 },
      { x: 750, y: 1400 },
    ]

    expect(() => fitEdge(sparsi, PASSO, 'il lato superiore')).toThrow(/strisce concordi/i)
  })

  it('fallisce con meno punti del minimo, qualunque sia il loro accordo', () => {
    expect(() => fitEdge(puntiVeri.slice(0, 2), PASSO, 'il lato sinistro')).toThrow(GridNotFoundError)
  })

  it('la tolleranza è una frazione del passo, non un valore assoluto', () => {
    // uno scarto di 8 px all'estremità sta dentro la tolleranza con passo 32
    // (11,2 px) e fuori con passo 16 (5,6 px)
    const conScarto = puntiVeri.map((p, i) => (i === 4 ? { ...p, y: p.y + 8 } : p))

    // con passo 32 il punto resta compatibile col lato interpolato
    const largo = fitEdge(conScarto, PASSO, 'il lato inferiore')
    expect(Math.abs(lineAt(largo, 1000) - 1138)).toBeLessThanOrEqual(PASSO * 0.35)

    // con passo 16 no: il lato lo scarta e resta sul filetto vero
    const stretto = fitEdge(conScarto, 16, 'il lato inferiore')
    expect(Math.abs(lineAt(stretto, 1000) - 1130)).toBeLessThan(1)
    expect(Math.abs(lineAt(stretto, 1000) - 1138)).toBeGreaterThan(16 * 0.35)
  })

  it('tiene il punto fuori posto fuori dal calcolo anche quando è in mezzo', () => {
    const line = fitEdge(conFuoriposto([2]), PASSO, 'il lato inferiore')

    expect(Math.abs(lineAt(line, 500) - filettoVero(500))).toBeLessThan(4)
  })

  /**
   * La proprietà che regge il contratto di `fitEdge`: o fallisce, o il lato che
   * restituisce ha almeno `MIN_EDGE_POINTS` strisce entro tolleranza. Serve
   * perché nella funzione **non c'è** un ramo d'errore dopo la rifinitura ai
   * minimi quadrati: un ramo lì non potrebbe scattare (con tre punti concordi la
   * retta rifinita resta dentro tolleranza), e un controllo che non può scattare
   * è peggio di un controllo assente, perché il codice sembra difeso. La
   * proprietà si prova quindi qui, su una batteria deterministica di casi, non
   * con un `throw` morto.
   */
  it('o fallisce, o restituisce un lato con almeno tre strisce entro tolleranza', () => {
    // generatore lineare congruenziale: deterministico, nessuna dipendenza
    let seme = 12345
    const rnd = (): number => {
      seme = (seme * 1103515245 + 12345) % 2147483648
      return seme / 2147483648
    }

    let riusciti = 0
    let falliti = 0
    for (let caso = 0; caso < 20000; caso += 1) {
      const quanti = 3 + Math.floor(rnd() * 4)
      const passo = 8 + Math.floor(rnd() * 40)
      const punti = Array.from({ length: quanti }, (_, i) => ({
        // ascisse a volte ravvicinate (leva alta) e a volte distese
        x: rnd() < 0.5 ? i * rnd() * 30 : rnd() * 1000,
        y: 1000 + rnd() * 2 * passo,
      }))

      let line
      try {
        line = fitEdge(punti, passo, 'il lato inferiore')
      } catch (errore) {
        expect(errore).toBeInstanceOf(GridNotFoundError)
        falliti += 1
        continue
      }
      riusciti += 1
      const tol = Math.max(2, passo * 0.35)
      const dentro = punti.filter((p) => Math.abs(p.y - lineAt(line, p.x)) <= tol).length
      expect(dentro, `caso ${caso}: ${JSON.stringify(punti)}`).toBeGreaterThanOrEqual(3)
    }

    // la batteria esercita davvero entrambi gli esiti
    expect(riusciti).toBeGreaterThan(1000)
    expect(falliti).toBeGreaterThan(1000)
  })
})

/**
 * Immagine in scala di grigi costruita a mano: carta chiara con filetti
 * orizzontali scuri larghi 2 px, e — se richiesto — il **bordo del foglio** sulla
 * scrivania: una riga d'ombra più scura sia della carta sopra sia della scrivania
 * sotto, che è la forma che un bordo di foglio ha in ogni foto reale.
 */
function grigiaConFilettiOrizzontali(
  width: number,
  height: number,
  opzioni: {
    carta: number
    filetti: { y: number; valore: number }[]
    bordoFoglio?: { y: number; ombra: number; scrivania: number }
  },
): Float64Array {
  const grey = new Float64Array(width * height).fill(opzioni.carta)
  const bordo = opzioni.bordoFoglio
  if (bordo) {
    for (let y = bordo.y; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        grey[y * width + x] = y < bordo.y + 2 ? bordo.ombra : bordo.scrivania
      }
    }
  }
  for (const filetto of opzioni.filetti) {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let x = 0; x < width; x += 1) grey[(filetto.y + dy) * width + x] = filetto.valore
    }
  }
  return grey
}

describe('detectRules e il bordo del foglio', () => {
  const width = 200
  const height = 1500
  const PASSO_RIGHE = 32
  const PRIMO = 200
  const QUANTE = 31
  /** L'ultimo filetto vero della tabella. */
  const ULTIMO = PRIMO + PASSO_RIGHE * (QUANTE - 1)

  const filetti = Array.from({ length: QUANTE }, (_, k) => ({
    y: PRIMO + k * PASSO_RIGHE,
    // un filetto sbiadito in mezzo: la difesa contro il bordo del foglio non
    // deve costare la sensibilità ai filetti pallidi, che nelle foto reali ci
    // sono (carta incurvata, stampa consumata)
    valore: k === 15 ? 188 : 60,
  }))

  /**
   * Il caso reale di agosto, in laboratorio: il bordo del foglio cade **dentro**
   * la finestra di ricerca (la bbox della pagina la oltrepassa: misurato
   * 212..1424 contro un bordo a 1403) ed è esattamente due passi oltre l'ultimo
   * filetto, dove l'inseguimento cerca il filetto successivo scavalcando uno
   * mancante. La sua riga d'ombra è più scura sia della carta sopra sia della
   * scrivania sotto, quindi il criterio «più scuro dei vicini da entrambi i
   * lati» la accetta: quello che la distingue da un filetto è che di là dal
   * bordo non c'è più carta, cioè che i due lati **non sono lo stesso tono**.
   */
  it('non prende per filetto il bordo del foglio che porta la propria riga d’ombra', () => {
    const grey = grigiaConFilettiOrizzontali(width, height, {
      carta: 220,
      filetti,
      bordoFoglio: { y: ULTIMO + 2 * PASSO_RIGHE, ombra: 60, scrivania: 115 },
    })

    const sequenza = detectRules(grey, width, 'row', { x0: 50, x1: 150, y0: 100, y1: height })

    expect(sequenza).not.toBeNull()
    expect(sequenza!.lines[sequenza!.lines.length - 1]).toBe(ULTIMO)
    expect(sequenza!.lines).toHaveLength(QUANTE)
  })

  it('e non lo prende nemmeno cercando il filetto di bordo oltre la sequenza', () => {
    // `detectHorizontalEdges` estende la sequenza al filetto di bordo della
    // griglia stampata, perché la riga del titolo è più alta delle righe dei
    // giorni e il suo filetto cade fuori passo. È il passaggio che rischia di
    // riprendere il bordo del foglio dalla porta di servizio: va provato il
    // percorso vero, non solo `detectRules`.
    const grey = grigiaConFilettiOrizzontali(width, height, {
      carta: 220,
      filetti,
      bordoFoglio: { y: ULTIMO + 2 * PASSO_RIGHE, ombra: 60, scrivania: 115 },
    })

    const edges = detectHorizontalEdges(grey, width, { start: 40, end: 160 }, { start: 100, end: height })

    expect(Math.abs(lineAt(edges.bottom, 100) - ULTIMO)).toBeLessThan(2)
    expect(Math.abs(lineAt(edges.top, 100) - PRIMO)).toBeLessThan(2)
  })

  it('trova comunque il filetto sbiadito in mezzo alla sequenza', () => {
    const grey = grigiaConFilettiOrizzontali(width, height, { carta: 220, filetti })

    const sequenza = detectRules(grey, width, 'row', { x0: 50, x1: 150, y0: 100, y1: height })

    expect(sequenza!.lines).toContain(filetti[15].y)
    expect(sequenza!.lines).toHaveLength(QUANTE)
  })

  it('non prende per filetto una riga d’ombra a filo della finestra di ricerca', () => {
    // agli estremi del profilo `ruleProfile` non ha carta da entrambi i lati e
    // non può giudicare: quelle posizioni vanno scartate, altrimenti il bordo
    // del foglio diventa il primo o l'ultimo filetto della tabella
    const grey = grigiaConFilettiOrizzontali(width, height, {
      carta: 220,
      filetti,
      bordoFoglio: { y: ULTIMO + 3 * PASSO_RIGHE, ombra: 60, scrivania: 115 },
    })

    const y1 = ULTIMO + 3 * PASSO_RIGHE + 3
    const sequenza = detectRules(grey, width, 'row', { x0: 50, x1: 150, y0: 100, y1 })

    expect(sequenza!.lines[sequenza!.lines.length - 1]).toBe(ULTIMO)
  })
})

/**
 * Immagine in scala di grigi costruita a mano: carta chiara, filetti verticali
 * scuri larghi 2 px nelle posizioni indicate per ciascuna fascia di righe.
 */
function grigiaConFilettiVerticali(
  width: number,
  height: number,
  fasce: { da: number; a: number; x: number[] }[],
): Float64Array {
  const grey = new Float64Array(width * height).fill(220)
  for (const fascia of fasce) {
    for (let y = fascia.da; y < fascia.a; y += 1) {
      for (const x of fascia.x) {
        grey[y * width + x] = 60
        grey[y * width + x + 1] = 60
      }
    }
  }
  return grey
}

describe('detectVerticalEdges', () => {
  const width = 600
  const height = 500
  const passo = 30
  const raggio = 4

  it('interpola i lati sui filetti che attraversano la tabella', () => {
    // filetti verticali continui, con una lieve deriva prospettica
    const fasce = [0, 1, 2, 3, 4].map((k) => ({
      da: k * 100,
      a: (k + 1) * 100,
      x: [60, 200, 340, 480].map((x) => x + k * 3),
    }))
    const grey = grigiaConFilettiVerticali(width, height, fasce)

    const edges = detectVerticalEdges(grey, width, { start: 0, end: width }, { start: 0, end: height }, passo, raggio)

    expect(edges.left.slope).toBeGreaterThan(0)
    expect(Math.abs(lineAt(edges.left, 50) - 61)).toBeLessThan(4)
    expect(Math.abs(lineAt(edges.right, 450) - 493)).toBeLessThan(4)
  })

  it('fallisce se nessun filetto verticale attraversa la tabella', () => {
    // in ogni fascia ci sono quattro filetti, ma in posizioni sempre diverse:
    // sono linee di qualcos'altro, non le colonne di una tabella
    const fasce = [0, 1, 2, 3, 4].map((k) => ({
      da: k * 100,
      a: (k + 1) * 100,
      x: [60, 200, 340, 480].map((x) => x + k * 60),
    }))
    const grey = grigiaConFilettiVerticali(width, height, fasce)

    expect(() =>
      detectVerticalEdges(grey, width, { start: 0, end: width }, { start: 0, end: height }, passo, raggio),
    ).toThrow(/filetti verticali attraversano/i)
  })

  it('fallisce se in una fascia non ci sono abbastanza confini di colonna', () => {
    const grey = grigiaConFilettiVerticali(width, height, [{ da: 0, a: height, x: [60, 200] }])

    expect(() => detectColumnBoundaries(grey, width, { start: 0, end: width }, 100, 140, passo, raggio)).toThrow(
      /confine di colonna/i,
    )
  })
})
