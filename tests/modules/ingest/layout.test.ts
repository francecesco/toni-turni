import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROSTER_LAYOUT,
  planBands,
  planWholeTable,
  pruneColumnBoundaries,
} from '@/modules/ingest/layout'

/**
 * I confini di colonna **così come `detectTableQuad` li restituisce** sulle due
 * foto reali, in coordinate del riquadro raddrizzato. Non sono inventati: sono
 * la stampa di `detectTableQuad` su `fixtures/`, arrotondata a quattro cifre.
 * Stanno qui come costanti perché `planBands` è logica pura e non deve aprire
 * immagini: il legame con le foto lo verifica `crop.test.ts`.
 *
 * Fra i confini rilevati ce ne sono di **troppo ravvicinati** per essere due
 * colonne del modulo cartaceo, e sono di due specie diverse:
 *
 * - **artefatti**: su agosto 0,5442 cade in mezzo alla colonna di CRISTINA, sul
 *   bordo destro delle toppe di correttore delle righe 8-13; su settembre
 *   0,0902 cade in mezzo alla colonna di RENATA. Questi vanno scartati o la
 *   banda slitta e un turno finisce alla collega sbagliata.
 * - **sotto-colonne vere**: 0,0289 (agosto) e 0,0217 (settembre) sono il filetto
 *   fra il numero del giorno e il giorno della settimana; 0,9684 (settembre) è
 *   quello fra `TOT M` e `TOT P`. Sono stampati, ma scartarli non costa niente:
 *   il blocco dei giorni entra intero in ogni banda e le colonne di servizio si
 *   buttano per nome.
 */
const AGOSTO = [
  0, 0.0289, 0.0718, 0.1643, 0.255, 0.3433, 0.4314, 0.5053, 0.5442, 0.5921, 0.6735, 0.7688,
  0.8867, 1,
]
const SETTEMBRE = [
  0, 0.0217, 0.0532, 0.0902, 0.1244, 0.1951, 0.2657, 0.3371, 0.3967, 0.4661, 0.5311, 0.6065,
  0.6894, 0.7692, 0.8578, 0.9351, 0.9684, 1,
]

/** I confini che restano dopo la ripulitura: le colonne che il taglio deve vedere. */
const AGOSTO_PULITI = [
  0, 0.0718, 0.1643, 0.255, 0.3433, 0.4314, 0.5053, 0.5921, 0.6735, 0.7688, 0.8867, 1,
]
const SETTEMBRE_PULITI = [
  0, 0.0532, 0.1244, 0.1951, 0.2657, 0.3371, 0.3967, 0.4661, 0.5311, 0.6065, 0.6894, 0.7692,
  0.8578, 0.9351, 1,
]

describe('DEFAULT_ROSTER_LAYOUT', () => {
  it("lascia spazio all'intestazione senza mangiarsi le righe dei giorni", () => {
    expect(DEFAULT_ROSTER_LAYOUT.headerHeight).toBeGreaterThan(0)
    expect(DEFAULT_ROSTER_LAYOUT.headerHeight).toBeLessThan(0.2)
  })

  it("anteponendo l'intestazione ne prende un filo di più, per non rasare la riga dei nomi", () => {
    expect(DEFAULT_ROSTER_LAYOUT.headerStrip).toBeGreaterThanOrEqual(
      DEFAULT_ROSTER_LAYOUT.headerHeight,
    )
    expect(DEFAULT_ROSTER_LAYOUT.headerStrip).toBeLessThan(0.2)
  })

  it('sovrappone le due metà del mese di una frazione piccola ma non nulla', () => {
    expect(DEFAULT_ROSTER_LAYOUT.monthOverlap).toBeGreaterThan(0)
    expect(DEFAULT_ROSTER_LAYOUT.monthOverlap).toBeLessThan(0.05)
  })

  it('scarta i confini sotto una frazione della distanza mediana, fra 0 e 1', () => {
    expect(DEFAULT_ROSTER_LAYOUT.boundaryMinRatio).toBeGreaterThan(0)
    expect(DEFAULT_ROSTER_LAYOUT.boundaryMinRatio).toBeLessThan(1)
  })
})

describe('pruneColumnBoundaries', () => {
  it("scarta i confini troppo ravvicinati di agosto e lascia intatti gli altri", () => {
    expect(pruneColumnBoundaries(AGOSTO)).toEqual(AGOSTO_PULITI)
  })

  it("scarta i confini troppo ravvicinati di settembre e lascia intatti gli altri", () => {
    expect(pruneColumnBoundaries(SETTEMBRE)).toEqual(SETTEMBRE_PULITI)
  })

  it('non sposta nessun confine: quelli che tiene sono quelli rilevati', () => {
    for (const rilevati of [AGOSTO, SETTEMBRE]) {
      for (const tenuto of pruneColumnBoundaries(rilevati)) {
        expect(rilevati).toContain(tenuto)
      }
    }
  })

  it('tiene sempre i due lati del riquadro, che sono confini per costruzione', () => {
    for (const rilevati of [AGOSTO, SETTEMBRE]) {
      const puliti = pruneColumnBoundaries(rilevati)
      expect(puliti[0]).toBe(rilevati[0])
      expect(puliti.at(-1)).toBe(rilevati.at(-1))
    }
  })

  it('preferisce buttare il penultimo confine che perdere il lato destro', () => {
    // passo 0,1 e un intruso a 0,98: il lato destro resta, l'intruso no
    const puliti = pruneColumnBoundaries([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98, 1])
    expect(puliti.at(-1)).toBe(1)
    expect(puliti).not.toContain(0.98)
  })

  it('lascia in pace un elenco già regolare', () => {
    const regolare = [0, 0.2, 0.4, 0.6, 0.8, 1]
    expect(pruneColumnBoundaries(regolare)).toEqual(regolare)
  })

  it('rifiuta un elenco che non descrive nemmeno una colonna', () => {
    expect(() => pruneColumnBoundaries([0.4])).toThrow(/confini/i)
  })
})

describe('planBands', () => {
  it('copre tutte le colonne rilevate tranne quella dei giorni, e tutti i giorni', () => {
    const bande = planBands(AGOSTO, { daysInMonth: 31 })

    // 12 confini puliti = 11 colonne; la 0 è il blocco dei giorni, entra in ogni banda
    const coperte = [...new Set(bande.flatMap((b) => b.columns))].sort((a, b) => a - b)
    expect(coperte).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    for (let giorno = 1; giorno <= 31; giorno += 1) {
      expect(
        bande.some((b) => giorno >= b.dayFrom && giorno <= b.dayTo),
        `giorno ${giorno}`,
      ).toBe(true)
    }
  })

  it('taglia il mese in due metà: due bande per ogni coppia di colonne', () => {
    expect(planBands(AGOSTO, { daysInMonth: 31 })).toHaveLength(10)
    expect(planBands(SETTEMBRE, { daysInMonth: 30 })).toHaveLength(14)
  })

  it('affianca la striscia dei giorni a un ritaglio strettato, invece di partire dal lato sinistro', () => {
    const puliti = SETTEMBRE_PULITI
    for (const banda of planBands(SETTEMBRE, { daysInMonth: 30 })) {
      // la striscia dei giorni è il blocco dei giorni intero: la colonna 0
      expect(banda.days.left).toBeCloseTo(puliti[0], 6)
      expect(banda.days.width).toBeCloseTo(puliti[1] - puliti[0], 6)
      // e il ritaglio comincia dal confine sinistro del *suo* gruppo, non da 0
      expect(banda.crop.left).toBeCloseTo(puliti[banda.columns[0]], 6)
      expect(banda.crop.left).toBeGreaterThanOrEqual(banda.days.left + banda.days.width)
    }
  })

  /**
   * Il difetto che questa composizione esiste per rimuovere: con ogni ritaglio
   * che parte da `left = 0` la larghezza cresce di gruppo in gruppo e l'ultima
   * banda mostra mezza tabella intera, cioè la configurazione che ha dato il
   * 18,5% di celle corrette. Comporre la striscia dei giorni *di fianco* al
   * gruppo toglie la crescita: la larghezza di una banda dipende solo dalle
   * **sue** colonne, quindi nessuna banda arriva vicino a mezza tabella e la
   * dispersione fra le bande è quella delle larghezze di colonna.
   *
   * Le due misure, sotto `left = 0` e composte:
   *
   * | | banda più larga | più larga / più stretta |
   * |---|---|---|
   * | agosto, `left = 0` | 1,000 (mezza tabella intera) | 3,92 |
   * | agosto, composta | 0,303 | 1,30 |
   * | settembre, `left = 0` | 1,000 | 5,13 |
   * | settembre, composta | 0,219 | 1,86 |
   *
   * L'1,86 di settembre non è dispersione della composizione: settembre ha 13 colonne di
   * contenuto, quindi l'ultimo gruppo ne ha una sola e la sua banda è la più
   * stretta. Una banda più stretta non è il difetto — il difetto è una banda più
   * larga.
   */
  it('tiene la larghezza composta lontana da mezza tabella, invece di farla crescere di gruppo in gruppo', () => {
    for (const [rilevati, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      const larghezze = planBands(rilevati, { daysInMonth: giorni }).map(
        (b) => b.days.width + b.crop.width,
      )

      expect(Math.max(...larghezze)).toBeLessThan(0.4)
      expect(Math.max(...larghezze) / Math.min(...larghezze)).toBeLessThan(2)
    }
  })

  it("mostra l'intestazione con i nomi in ogni banda", () => {
    for (const banda of planBands(AGOSTO, { daysInMonth: 31 })) {
      if (banda.dayFrom === 1) {
        // la prima metà comincia dal bordo alto: l'intestazione è già dentro
        expect(banda.crop.top).toBe(0)
        expect(banda.header).toBeNull()
      } else {
        // la seconda no, quindi la striscia dei nomi va anteposta
        expect(banda.crop.top).toBeGreaterThan(0)
        expect(banda.header).toEqual({ top: 0, height: DEFAULT_ROSTER_LAYOUT.headerStrip })
      }
    }
  })

  it("il ritaglio copre esattamente le colonne della banda, dal primo confine all'ultimo", () => {
    const puliti = AGOSTO_PULITI
    for (const banda of planBands(AGOSTO, { daysInMonth: 31 })) {
      expect(banda.crop.left).toBeCloseTo(puliti[banda.columns[0]], 6)
      expect(banda.crop.left + banda.crop.width).toBeCloseTo(
        puliti[banda.columns.at(-1)! + 1],
        6,
      )
    }
  })

  it("produce ritagli dentro i limiti dell'immagine", () => {
    for (const banda of planBands(SETTEMBRE, { daysInMonth: 30 })) {
      expect(banda.crop.left).toBeGreaterThanOrEqual(0)
      expect(banda.crop.top).toBeGreaterThanOrEqual(0)
      expect(banda.crop.width).toBeGreaterThan(0)
      expect(banda.crop.height).toBeGreaterThan(0)
      expect(banda.crop.left + banda.crop.width).toBeLessThanOrEqual(1.0001)
      expect(banda.crop.top + banda.crop.height).toBeLessThanOrEqual(1.0001)
      expect(banda.days.left).toBeGreaterThanOrEqual(0)
      expect(banda.days.width).toBeGreaterThan(0)
      expect(banda.days.left + banda.days.width).toBeLessThanOrEqual(1.0001)
    }
  })

  /**
   * Il nome promette che nessun giorno cade nella cucitura, quindi la
   * sovrapposizione va misurata in **righe di giorno**: un `>` la soddisfarebbe
   * con 1e-9. La cucitura è calcolata e il filetto vero sta altrove — misurato,
   * fino a 0,166 righe di scarto — quindi ogni metà deve oltrepassarla di più di
   * mezza riga. Con `monthOverlap` = 0,022 la sovrapposizione totale è 1,46
   * righe su agosto; il legame col filetto misurato lo verifica `crop.test.ts`.
   */
  it('sovrappone le due metà del mese di più di una riga di giorno', () => {
    const giorni = 31
    const bande = planBands(AGOSTO, { daysInMonth: giorni })
    const prima = bande.find((b) => b.dayFrom === 1)!
    const seconda = bande.find((b) => b.dayFrom > 1 && b.columns[0] === prima.columns[0])!

    expect(prima.dayTo + 1).toBe(seconda.dayFrom)

    const riga = (1 - DEFAULT_ROSTER_LAYOUT.headerHeight) / giorni
    const sovrapposizione = prima.crop.top + prima.crop.height - seconda.crop.top
    expect(sovrapposizione / riga).toBeGreaterThan(1)
  })

  it('rispetta columnsPerBand', () => {
    const bande = planBands(AGOSTO, { daysInMonth: 30, columnsPerBand: 5 })
    expect(bande).toHaveLength(4) // 10 colonne di contenuto in gruppi da 5, per due metà
    for (const banda of bande) expect(banda.columns.length).toBeLessThanOrEqual(5)
  })

  it('rifiuta un mese impossibile', () => {
    expect(() => planBands(AGOSTO, { daysInMonth: 0 })).toThrow(/giorni/i)
    expect(() => planBands(AGOSTO, { daysInMonth: 31.5 })).toThrow(/giorni/i)
  })

  it('rifiuta una tabella senza colonne di contenuto oltre a quella dei giorni', () => {
    expect(() => planBands([0, 1], { daysInMonth: 31 })).toThrow(/colonne/i)
  })
})

/**
 * La tabella intera in **una banda sola**: e la strategia a chiamata singola.
 *
 * Non e un secondo percorso nel codice, e una configurazione della stessa
 * macchina: una banda che tiene tutte le colonne e tutti i giorni. Da questo
 * dipende che tutto quello che sta a valle — rilevamento dei buchi per colonna,
 * scarto delle colonne di servizio per nome, persistenza che protegge le
 * correzioni a mano — resti quello gia misurato, invece di essere riscritto.
 */
describe('planWholeTable', () => {
  it('restituisce una banda sola', () => {
    expect(planWholeTable(AGOSTO, { daysInMonth: 31 })).toHaveLength(1)
    expect(planWholeTable(SETTEMBRE, { daysInMonth: 30 })).toHaveLength(1)
  })

  it('copre tutti i giorni del mese, senza cucitura di meta mese', () => {
    const [banda] = planWholeTable(AGOSTO, { daysInMonth: 31 })

    expect(banda.dayFrom).toBe(1)
    expect(banda.dayTo).toBe(31)
    // l intestazione con i nomi e dentro il ritaglio, non da anteporre
    expect(banda.header).toBeNull()
    expect(banda.crop.top).toBe(0)
    expect(banda.crop.top + banda.crop.height).toBe(1)
  })

  it('tiene tutte le colonne di contenuto, e solo quelle', () => {
    const [banda] = planWholeTable(AGOSTO, { daysInMonth: 31 })
    // AGOSTO_PULITI ha 12 confini = 11 colonne, di cui la 0 e il blocco dei giorni
    expect(banda.columns).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('affianca comunque il blocco dei giorni, che e l unica cosa che dice il giorno', () => {
    const [banda] = planWholeTable(SETTEMBRE, { daysInMonth: 30 })

    expect(banda.days.left).toBe(SETTEMBRE_PULITI[0])
    expect(banda.days.width).toBeCloseTo(SETTEMBRE_PULITI[1] - SETTEMBRE_PULITI[0], 6)
    // il ritaglio delle colonne parte **dopo** il blocco dei giorni: senza questo
    // il blocco comparirebbe due volte, e il modello leggerebbe due colonne di
    // giorni affiancate
    expect(banda.crop.left).toBe(SETTEMBRE_PULITI[1])
    expect(banda.crop.left + banda.crop.width).toBe(1)
  })

  it('rifiuta un mese non plausibile come planBands', () => {
    expect(() => planWholeTable(AGOSTO, { daysInMonth: 40 })).toThrow(/40/)
  })

  it('rifiuta una tabella senza colonne di contenuto', () => {
    expect(() => planWholeTable([0, 1], { daysInMonth: 31 })).toThrow(/colonne/)
  })
})
