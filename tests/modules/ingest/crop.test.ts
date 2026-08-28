import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { cropRosterBands, deskewRoster, GridNotFoundError } from '@/modules/ingest'

const AGOSTO = join(process.cwd(), 'fixtures', 'roster-2026-08-3piano.jpeg')
const SETTEMBRE = join(process.cwd(), 'fixtures', 'roster-2026-09-3piano.jpeg')

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
      const out = await deskewRoster(readFileSync(path))
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
    const ago = await deskewRoster(readFileSync(AGOSTO))
    const set = await deskewRoster(readFileSync(SETTEMBRE))

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
    expect(await cropRosterBands(readFileSync(AGOSTO), { daysInMonth: 31 })).toHaveLength(10)
    // settembre: 13 colonne di contenuto → 7 gruppi × 2 metà di mese
    expect(await cropRosterBands(readFileSync(SETTEMBRE), { daysInMonth: 30 })).toHaveLength(14)
  })

  it('ogni banda è un JPEG non vuoto', async () => {
    const bande = await cropRosterBands(readFileSync(AGOSTO), { daysInMonth: 31 })

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
      for (const banda of await cropRosterBands(readFileSync(path), { daysInMonth: giorni })) {
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
      for (const banda of await cropRosterBands(readFileSync(path), { daysInMonth: giorni })) {
        const righe = banda.spec.dayTo - banda.spec.dayFrom + 1 + 2 // + le due righe d'intestazione
        expect(banda.height / righe, `${path} colonne ${banda.spec.columns}`).toBeGreaterThan(30)
      }
    }
  })

  it('le bande coprono insieme tutte le colonne di contenuto e tutti i giorni', async () => {
    const bande = await cropRosterBands(readFileSync(SETTEMBRE), { daysInMonth: 30 })

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
    const foto = readFileSync(AGOSTO)
    const raddrizzata = await deskewRoster(foto)
    const aspettoRiquadro = raddrizzata.height / raddrizzata.width
    const bande = await cropRosterBands(foto, { daysInMonth: 31 })

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
      const foto = readFileSync(path)
      const raddrizzata = await deskewRoster(foto)
      const aspettoRiquadro = raddrizzata.height / raddrizzata.width

      for (const banda of await cropRosterBands(foto, { daysInMonth: giorni })) {
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
      const bande = await cropRosterBands(readFileSync(path), { daysInMonth: giorni })
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
