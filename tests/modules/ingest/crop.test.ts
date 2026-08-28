import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  cropRosterBands,
  deskewRoster,
  GridNotFoundError,
  type DeskewedRoster,
  type RosterBand,
} from '@/modules/ingest'
import { detectRules } from '@/modules/ingest/grid-lines'
import { median } from '@/modules/ingest/grid-numeric'

const AGOSTO = join(process.cwd(), 'fixtures', 'roster-2026-08-3piano.jpeg')
const SETTEMBRE = join(process.cwd(), 'fixtures', 'roster-2026-09-3piano.jpeg')

/**
 * `cropRosterBands` e `deskewRoster` rilevano la tabella e la raddrizzano, che è
 * di gran lunga la cosa più costosa della suite: con le opzioni di default il
 * risultato è lo stesso per tutti i test, quindi si calcola una volta per foto.
 * Le bande sono buffer di sola lettura e nessun test le modifica.
 *
 * I test che usano opzioni diverse dal default chiamano direttamente, perché
 * quello che verificano è proprio l'effetto delle opzioni.
 */
const bandeCache = new Map<string, Promise<RosterBand[]>>()
function bandeDi(path: string, daysInMonth: number): Promise<RosterBand[]> {
  const chiave = `${path}:${daysInMonth}`
  const gia = bandeCache.get(chiave)
  if (gia) return gia
  const calcolo = cropRosterBands(readFileSync(path), { daysInMonth })
  bandeCache.set(chiave, calcolo)
  return calcolo
}

const raddrizzateCache = new Map<string, Promise<DeskewedRoster>>()
function raddrizzataDi(path: string): Promise<DeskewedRoster> {
  const gia = raddrizzateCache.get(path)
  if (gia) return gia
  const calcolo = deskewRoster(readFileSync(path))
  raddrizzateCache.set(path, calcolo)
  return calcolo
}

/** Una foto senza tabella: carta bianca, nessun filetto. */
async function foglioBianco(): Promise<Buffer> {
  return sharp({ create: { width: 500, height: 500, channels: 3, background: '#ffffff' } })
    .jpeg()
    .toBuffer()
}

describe('deskewRoster', () => {
  it('produce un JPEG della larghezza richiesta', async () => {
    const out = await deskewRoster(readFileSync(AGOSTO), { width: 1000 })

    expect(out.width).toBe(1000)
    const meta = await sharp(out.data).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(out.width)
    expect(meta.height).toBe(out.height)
  })

  it('raddrizza entrambe le foto nonostante gli orientamenti diversi', async () => {
    for (const path of [AGOSTO, SETTEMBRE]) {
      const out = await raddrizzataDi(path)
      expect(out.width).toBeGreaterThan(0)
      expect(out.height).toBeGreaterThan(0)
    }
  })

  /**
   * Il raddrizzamento non deve schiacciare la tabella: la forma del riquadro
   * nella foto è quella del modulo cartaceo, e le due foto la vedono con
   * proporzioni diverse (agosto taglia il foglio a destra). Se l'uscita avesse
   * proporzioni fisse, su settembre le righe sarebbero alte metà del dovuto.
   */
  it("conserva le proporzioni del riquadro, che sono diverse fra le due foto", async () => {
    const ago = await deskewRoster(readFileSync(AGOSTO), { width: 1600 })
    const set = await deskewRoster(readFileSync(SETTEMBRE), { width: 1600 })

    expect(ago.height / ago.width).toBeCloseTo(0.932, 2)
    expect(set.height / set.width).toBeCloseTo(0.695, 2)
  })

  it('restituisce i confini di colonna già ripuliti, così nessuno raddrizza due volte', async () => {
    const ago = await raddrizzataDi(AGOSTO)
    const set = await raddrizzataDi(SETTEMBRE)

    // 11 colonne su agosto (il foglio è tagliato dal fotogramma), 14 su settembre
    expect(ago.columns).toHaveLength(12)
    expect(set.columns).toHaveLength(15)
    expect(ago.columns[0]).toBeCloseTo(0, 6)
    expect(ago.columns.at(-1)).toBeCloseTo(1, 6)
  })

  it('fallisce con GridNotFoundError se la foto non contiene una tabella', async () => {
    await expect(deskewRoster(await foglioBianco())).rejects.toThrow(GridNotFoundError)
  })
})

describe('cropRosterBands', () => {
  it('produce due bande per ogni coppia di colonne rilevate', async () => {
    // agosto: 10 colonne di contenuto → 5 coppie × 2 metà di mese
    expect(await bandeDi(AGOSTO, 31)).toHaveLength(10)
    // settembre: 13 colonne di contenuto → 7 gruppi × 2 metà di mese
    expect(await bandeDi(SETTEMBRE, 30)).toHaveLength(14)
  })

  it('ogni banda è un JPEG non vuoto', async () => {
    const bande = await bandeDi(AGOSTO, 31)

    for (const banda of bande) {
      expect(banda.image.byteLength).toBeGreaterThan(1000)
      const meta = await sharp(banda.image).metadata()
      expect(meta.format).toBe('jpeg')
      expect(meta.width).toBe(banda.width)
      expect(meta.height).toBe(banda.height)
    }
  })

  /**
   * Il tetto di token al minuto di Groq è 8000 e conta anche quelli prenotati
   * per l'uscita, quindi la banda più grossa non può crescere a piacere. Il
   * ritaglio misurato al 100% di accuratezza era 700x1313, cioè 0,92 Mpx: si
   * resta in quell'ordine di grandezza.
   */
  it('tiene ogni banda nell’ordine di grandezza del ritaglio misurato al 100%', async () => {
    for (const [path, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      for (const banda of await bandeDi(path, giorni)) {
        expect(banda.width * banda.height, `${path} colonne ${banda.spec.columns}`).toBeLessThanOrEqual(
          1_000_000,
        )
      }
    }
  })

  /**
   * Quello che decide la leggibilità non è la larghezza ma i **pixel per riga**:
   * le righe per banda sono le stesse su entrambe le foto (mezzo mese più
   * l'intestazione), quindi le bande vanno scalate sull'altezza. Il riferimento
   * è il ritaglio letto al 100%, 1313 px per 17 righe circa.
   */
  it('dà alle bande abbastanza pixel per riga da essere leggibili', async () => {
    for (const [path, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      for (const banda of await bandeDi(path, giorni)) {
        const righe = banda.spec.dayTo - banda.spec.dayFrom + 1 + 2 // + le due righe d'intestazione
        expect(banda.height / righe, `${path} colonne ${banda.spec.columns}`).toBeGreaterThan(30)
      }
    }
  })

  it('le bande coprono insieme tutte le colonne di contenuto e tutti i giorni', async () => {
    const bande = await bandeDi(SETTEMBRE, 30)

    const coperte = [...new Set(bande.flatMap((b) => b.spec.columns))].sort((a, b) => a - b)
    expect(coperte).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    for (let giorno = 1; giorno <= 30; giorno += 1) {
      expect(bande.some((b) => giorno >= b.spec.dayFrom && giorno <= b.spec.dayTo)).toBe(true)
    }
  })

  /**
   * La seconda metà del mese non tocca il bordo alto del riquadro, quindi la
   * riga dei nomi le va anteposta: senza il nome in cima la banda non è
   * chiavabile, ed è sul nome che il Task 5 aggancia le celle. Si vede
   * dall'altezza: la banda della seconda metà è più alta del suo solo ritaglio.
   */
  it("anteponendo l'intestazione, ogni banda della seconda metà porta i nomi", async () => {
    const raddrizzata = await raddrizzataDi(AGOSTO)
    const aspettoRiquadro = raddrizzata.height / raddrizzata.width
    const bande = await bandeDi(AGOSTO, 31)

    expect(bande.filter((b) => b.spec.header !== null)).toHaveLength(5)

    for (const banda of bande) {
      const larghezza = banda.spec.days.width + banda.spec.crop.width
      const senzaIntestazione = (banda.spec.crop.height * aspettoRiquadro) / larghezza
      const conIntestazione = banda.height / banda.width

      if (banda.spec.header === null) {
        // prima metà: l'intestazione è già dentro il ritaglio
        expect(conIntestazione).toBeCloseTo(senzaIntestazione, 1)
      } else {
        // seconda metà: la striscia dei nomi aggiunge altezza a pari larghezza
        const atteso =
          ((banda.spec.crop.height + banda.spec.header.height) * aspettoRiquadro) / larghezza
        expect(conIntestazione).toBeGreaterThan(senzaIntestazione)
        expect(conIntestazione).toBeCloseTo(atteso, 1)
      }
    }
  })

  /**
   * La banda è composta: la striscia dei giorni a sinistra, il ritaglio del
   * gruppo di colonne a destra. Le proporzioni dell'immagine devono quindi
   * corrispondere alla **somma** delle due larghezze, non alla sola larghezza
   * del ritaglio. Se non corrispondessero, una delle due strisce sarebbe stata
   * scalata o tagliata, e le celle non starebbero più sulla riga del giorno che
   * gli sta accanto.
   */
  it('affianca la striscia dei giorni al ritaglio, con le proporzioni della somma', async () => {
    for (const [path, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      const raddrizzata = await raddrizzataDi(path)
      const aspettoRiquadro = raddrizzata.height / raddrizzata.width

      for (const banda of await bandeDi(path, giorni)) {
        const larghezza = banda.spec.days.width + banda.spec.crop.width
        const altezza =
          banda.spec.crop.height + (banda.spec.header?.height ?? 0)
        const atteso = (altezza * aspettoRiquadro) / larghezza

        expect(
          banda.height / banda.width,
          `${path} colonne ${banda.spec.columns}`,
        ).toBeCloseTo(atteso, 1)
      }
    }
  })

  /**
   * Il difetto che la composizione rimuove: con ogni ritaglio che parte dal lato
   * sinistro del riquadro, l'ultima banda mostrava mezza tabella intera — la
   * configurazione misurata al 18,5% di celle corrette. Le bande vanno invece
   * tutte della stessa dimensione, quella del ritaglio misurato al 100%.
   */
  it('tiene tutte le bande della dimensione del ritaglio misurato al 100%', async () => {
    for (const [path, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      const bande = await bandeDi(path, giorni)
      const larghezze = bande.map((b) => b.width)

      // il ritaglio letto al 100% era 700 px di larghezza: nessuna banda
      // arriva al doppio, e la più larga non è il doppio della più stretta
      for (const banda of bande) {
        expect(banda.width, `${path} colonne ${banda.spec.columns}`).toBeLessThan(1400)
      }
      expect(Math.max(...larghezze) / Math.min(...larghezze)).toBeLessThan(2)
    }
  })

  it('rispetta columnsPerBand', async () => {
    const bande = await cropRosterBands(readFileSync(AGOSTO), {
      daysInMonth: 31,
      columnsPerBand: 5,
    })

    expect(bande).toHaveLength(4)
    for (const banda of bande) expect(banda.spec.columns.length).toBeLessThanOrEqual(5)
  })

  it('fallisce con GridNotFoundError se la foto non contiene una tabella', async () => {
    await expect(cropRosterBands(await foglioBianco(), { daysInMonth: 31 })).rejects.toThrow(
      GridNotFoundError,
    )
  })
})

/**
 * Il legame fra la riga del giorno e la cella che le sta accanto, verificato sul
 * **contenuto** e non sulle proporzioni.
 *
 * È la proprietà su cui poggia tutta la strategia a bande, e i test sulle
 * proporzioni non la vedono: una composizione ruotata, invertita o tagliata alla
 * ordinata sbagliata ha le stesse proporzioni di quella giusta. Tre mutazioni
 * sopravvivevano alla suite intera — la striscia dei giorni tagliata a `top: 0`
 * invece che a `spec.crop.top` (che sulla seconda metà del mese vale un
 * disallineamento di **17 righe**), la striscia composta a destra invece che a
 * sinistra, l'intestazione impilata in fondo invece che in cima — e ognuna
 * metterebbe i turni di una persona sui giorni di un'altra riga.
 *
 * Il metodo: si confronta ogni pezzo della banda composta con i pixel da cui
 * **deve** venire, ritagliati dallo stesso riquadro raddrizzato, ridotti a una
 * impronta piccola e correlati. Non un confronto esatto — la banda passa da un
 * ricampionamento e da una compressione JPEG in più — ma la separazione misurata
 * è larghissima: gli accoppiamenti giusti stanno fra 0,976 e 1,000 su 156
 * confronti, quelli sbagliati non superano 0,309.
 */
describe('cropRosterBands, il legame giorno-cella', () => {
  /** Correlazione minima fra un pezzo della banda e i pixel da cui deve venire. */
  const SOMIGLIANZA_MINIMA = 0.9
  /** Correlazione massima ammessa fra un pezzo e i pixel da cui **non** viene. */
  const SOMIGLIANZA_MASSIMA_SBAGLIATA = 0.6
  /** Lato dell'impronta con cui si confrontano due pezzi. */
  const IMPRONTA = { width: 40, height: 200 }

  /** I pixel di un pezzo in scala di grigi, riportati alla dimensione dell'impronta. */
  async function impronta(
    image: Buffer,
    box?: { left: number; top: number; width: number; height: number },
  ): Promise<Float64Array> {
    let pipeline = sharp(image)
    if (box) pipeline = pipeline.extract(box)
    const { data } = await pipeline
      .greyscale()
      .resize(IMPRONTA.width, IMPRONTA.height, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    const valori = new Float64Array(IMPRONTA.width * IMPRONTA.height)
    for (let i = 0; i < valori.length; i += 1) valori[i] = data[i]
    return valori
  }

  /** Coefficiente di correlazione fra due impronte: 1 se sono la stessa immagine. */
  function somiglianza(a: Float64Array, b: Float64Array): number {
    let mediaA = 0
    let mediaB = 0
    for (let i = 0; i < a.length; i += 1) {
      mediaA += a[i]
      mediaB += b[i]
    }
    mediaA /= a.length
    mediaB /= b.length

    let prodotto = 0
    let varA = 0
    let varB = 0
    for (let i = 0; i < a.length; i += 1) {
      const x = a[i] - mediaA
      const y = b[i] - mediaB
      prodotto += x * y
      varA += x * x
      varB += y * y
    }
    return prodotto / Math.sqrt(varA * varB)
  }

  /** Lo stesso arrotondamento in pixel che usa il ritaglio delle bande. */
  function riquadro(
    raddrizzata: DeskewedRoster,
    frazioni: { left: number; top: number; width: number; height: number },
  ) {
    const left = Math.min(raddrizzata.width - 1, Math.round(frazioni.left * raddrizzata.width))
    const top = Math.min(raddrizzata.height - 1, Math.round(frazioni.top * raddrizzata.height))
    return {
      left,
      top,
      width: Math.max(1, Math.min(raddrizzata.width - left, Math.round(frazioni.width * raddrizzata.width))),
      height: Math.max(1, Math.min(raddrizzata.height - top, Math.round(frazioni.height * raddrizzata.height))),
    }
  }

  /** Dove stanno, in pixel della banda composta, i quattro pezzi che la formano. */
  function pezzi(banda: RosterBand) {
    const { spec } = banda
    const larghezzaTotale = spec.days.width + spec.crop.width
    const altezzaTotale = spec.crop.height + (spec.header?.height ?? 0)
    const larghezzaGiorni = Math.round(banda.width * (spec.days.width / larghezzaTotale))
    const altezzaTesta = spec.header
      ? Math.round(banda.height * (spec.header.height / altezzaTotale))
      : 0

    return {
      larghezzaGiorni,
      altezzaTesta,
      righeSinistra: {
        left: 0,
        top: altezzaTesta,
        width: larghezzaGiorni,
        height: banda.height - altezzaTesta,
      },
      righeDestra: {
        left: larghezzaGiorni,
        top: altezzaTesta,
        width: banda.width - larghezzaGiorni,
        height: banda.height - altezzaTesta,
      },
    }
  }

  it('taglia la striscia dei giorni alla stessa ordinata del ritaglio, e la mette a sinistra', async () => {
    for (const [path, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      const raddrizzata = await raddrizzataDi(path)

      for (const banda of await bandeDi(path, giorni)) {
        const { spec } = banda
        const p = pezzi(banda)
        const dove = `${path} giorni ${spec.dayFrom}-${spec.dayTo} colonne ${spec.columns}`

        const sinistra = await impronta(banda.image, p.righeSinistra)
        const destra = await impronta(banda.image, p.righeDestra)

        // i pixel da cui i due pezzi DEVONO venire: la stessa ordinata e la
        // stessa altezza, che è ciò che rende esatta la composizione
        const strisciaDeiGiorni = await impronta(
          await sharp(raddrizzata.data)
            .extract(
              riquadro(raddrizzata, {
                left: spec.days.left,
                top: spec.crop.top,
                width: spec.days.width,
                height: spec.crop.height,
              }),
            )
            .png()
            .toBuffer(),
        )
        const colonneDelGruppo = await impronta(
          await sharp(raddrizzata.data).extract(riquadro(raddrizzata, spec.crop)).png().toBuffer(),
        )

        expect(somiglianza(sinistra, strisciaDeiGiorni), `sinistra ${dove}`).toBeGreaterThan(
          SOMIGLIANZA_MINIMA,
        )
        expect(somiglianza(destra, colonneDelGruppo), `destra ${dove}`).toBeGreaterThan(
          SOMIGLIANZA_MINIMA,
        )
        // e non sono scambiate: la striscia dei giorni sta a sinistra
        expect(somiglianza(sinistra, colonneDelGruppo), `scambio ${dove}`).toBeLessThan(
          SOMIGLIANZA_MASSIMA_SBAGLIATA,
        )
        expect(somiglianza(destra, strisciaDeiGiorni), `scambio ${dove}`).toBeLessThan(
          SOMIGLIANZA_MASSIMA_SBAGLIATA,
        )
      }
    }
  })

  it("impila la riga d'intestazione in cima alla banda, non in fondo", async () => {
    for (const [path, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      const raddrizzata = await raddrizzataDi(path)
      const conIntestazione = (await bandeDi(path, giorni)).filter((b) => b.spec.header !== null)
      expect(conIntestazione.length).toBeGreaterThan(0)

      for (const banda of conIntestazione) {
        const spec = banda.spec
        const header = spec.header
        if (header === null) throw new Error('filtrata sopra')
        const p = pezzi(banda)
        const dove = `${path} giorni ${spec.dayFrom}-${spec.dayTo} colonne ${spec.columns}`

        const testaSinistra = await impronta(banda.image, {
          left: 0,
          top: 0,
          width: p.larghezzaGiorni,
          height: p.altezzaTesta,
        })
        const testaDestra = await impronta(banda.image, {
          left: p.larghezzaGiorni,
          top: 0,
          width: banda.width - p.larghezzaGiorni,
          height: p.altezzaTesta,
        })
        const fondoSinistra = await impronta(banda.image, {
          left: 0,
          top: banda.height - p.altezzaTesta,
          width: p.larghezzaGiorni,
          height: p.altezzaTesta,
        })

        const intestazioneGiorni = await impronta(
          await sharp(raddrizzata.data)
            .extract(
              riquadro(raddrizzata, {
                left: spec.days.left,
                top: header.top,
                width: spec.days.width,
                height: header.height,
              }),
            )
            .png()
            .toBuffer(),
        )
        const intestazioneColonne = await impronta(
          await sharp(raddrizzata.data)
            .extract(
              riquadro(raddrizzata, {
                left: spec.crop.left,
                top: header.top,
                width: spec.crop.width,
                height: header.height,
              }),
            )
            .png()
            .toBuffer(),
        )

        expect(somiglianza(testaSinistra, intestazioneGiorni), `testa ${dove}`).toBeGreaterThan(
          SOMIGLIANZA_MINIMA,
        )
        expect(somiglianza(testaDestra, intestazioneColonne), `testa ${dove}`).toBeGreaterThan(
          SOMIGLIANZA_MINIMA,
        )
        // e non è in fondo: là ci sono le ultime righe di giorni
        expect(somiglianza(fondoSinistra, intestazioneGiorni), `fondo ${dove}`).toBeLessThan(
          SOMIGLIANZA_MASSIMA_SBAGLIATA,
        )
      }
    }
  })

  /**
   * La stessa proprietà detta nell'unità che conta, la riga: i filetti
   * orizzontali che si vedono dentro la striscia dei giorni e quelli che si
   * vedono dentro le colonne del gruppo devono cadere sulle **stesse** righe
   * della banda composta.
   *
   * Mezza riga di sfasamento è il punto in cui una cella comincia a leggersi
   * accanto al giorno sbagliato. Misurato sulle 24 bande delle due foto: al
   * massimo **0,153 righe** (settembre, gruppo 11-12), cioè un terzo di quel
   * limite; il residuo è la deriva del raddrizzamento, non la composizione.
   */
  it('allinea i filetti della striscia dei giorni con quelli delle celle', async () => {
    /** Frazione di riga di sfasamento ammessa: 0,5 sarebbe un errore da una riga. */
    const SFASAMENTO_MASSIMO = 0.25

    for (const [path, giorni] of [
      [AGOSTO, 31],
      [SETTEMBRE, 30],
    ] as const) {
      for (const banda of await bandeDi(path, giorni)) {
        const dove = `${path} giorni ${banda.spec.dayFrom}-${banda.spec.dayTo}`
        const p = pezzi(banda)

        const { data, info } = await sharp(banda.image)
          .greyscale()
          .raw()
          .toBuffer({ resolveWithObject: true })
        const grigi = new Float64Array(info.width * info.height)
        for (let i = 0; i < grigi.length; i += 1) grigi[i] = data[i]

        const dentro = { y0: 0, y1: info.height }
        const filettiGiorni = detectRules(grigi, info.width, 'row', {
          ...dentro,
          x0: 2,
          x1: p.larghezzaGiorni - 2,
        })
        const filettiCelle = detectRules(grigi, info.width, 'row', {
          ...dentro,
          x0: p.larghezzaGiorni + 2,
          x1: info.width - 2,
        })

        expect(filettiGiorni, `filetti dei giorni ${dove}`).not.toBeNull()
        expect(filettiCelle, `filetti delle celle ${dove}`).not.toBeNull()
        if (filettiGiorni === null || filettiCelle === null) continue

        const passo = (filettiGiorni.step + filettiCelle.step) / 2
        const scarti: number[] = []
        for (const riga of filettiGiorni.lines) {
          let vicino: number | null = null
          for (const altra of filettiCelle.lines) {
            if (vicino === null || Math.abs(altra - riga) < Math.abs(vicino - riga)) vicino = altra
          }
          if (vicino !== null && Math.abs(vicino - riga) < passo / 2) scarti.push(vicino - riga)
        }

        expect(scarti.length, `filetti agganciati ${dove}`).toBeGreaterThan(10)
        expect(Math.abs(median(scarti)) / passo, `sfasamento ${dove}`).toBeLessThan(
          SFASAMENTO_MASSIMO,
        )
      }
    }
  })
})
