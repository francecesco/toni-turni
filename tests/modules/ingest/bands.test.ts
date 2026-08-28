import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  cropRosterBands,
  imageDimensions,
  planBands,
  renderBandPreview,
  type BandPlan,
} from '@/modules/ingest/bands'

function totalWidth(band: BandPlan): number {
  return band.dayStrip.width + band.slice.width
}

async function immagineFinta(width = 1000, height = 800): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer()
}

describe('planBands — quante bande e dove tagliano', () => {
  it('con una colonna per banda produce una banda per colonna dichiarata', () => {
    const bande = planBands({ width: 1000, height: 800, columns: 14 })

    expect(bande).toHaveLength(14)
    expect(bande.map((b) => b.index)).toEqual([...Array(14).keys()])
    expect(bande[0].columnFrom).toBe(0)
    expect(bande[0].columnTo).toBe(1)
    expect(bande[13].columnFrom).toBe(13)
    // I confini nominali (senza sovrapposizione) sono contigui: è la griglia che
    // l anteprima disegna sulla foto.
    expect(bande[0].nominalLeft).toBe(bande[0].dayStrip.left + bande[0].dayStrip.width)
    for (let i = 1; i < bande.length; i += 1) {
      expect(bande[i].nominalLeft).toBe(bande[i - 1].nominalRight)
    }
  })

  it('con due colonne per banda arrotonda per eccesso e l ultima banda può essere più corta', () => {
    const bande = planBands({ width: 1000, height: 800, columns: 7, columnsPerBand: 2 })

    expect(bande).toHaveLength(4)
    expect(bande[3].columnFrom).toBe(6)
    expect(bande[3].columnTo).toBe(7)
  })

  it('ogni banda porta con sé la colonna dei giorni, sempre la stessa striscia a sinistra', () => {
    const bande = planBands({ width: 1000, height: 800, columns: 5, dayColumnFraction: 0.1 })

    for (const banda of bande) {
      expect(banda.dayStrip).toEqual({ left: 0, top: 0, width: 100, height: 800 })
    }
  })

  it('le bande si sovrappongono, così una colonna tagliata a metà da un taglio resta intera nella vicina', () => {
    const bande = planBands({
      width: 1000,
      height: 800,
      columns: 5,
      dayColumnFraction: 0.1,
      overlapFraction: 0.5,
    })

    // Area delle colonne: da 100 a 1000, cinque colonne da 180px.
    // La seconda banda copre la colonna [280, 460) più mezza colonna per lato.
    expect(bande[1].slice.left).toBe(190)
    expect(bande[1].slice.left + bande[1].slice.width).toBe(550)

    for (let i = 1; i < bande.length; i += 1) {
      const precedente = bande[i - 1]
      const corrente = bande[i]
      expect(corrente.slice.left).toBeLessThan(precedente.slice.left + precedente.slice.width)
    }
  })

  it('la sovrapposizione non esce dai bordi dell area della tabella', () => {
    const bande = planBands({
      width: 1000,
      height: 800,
      columns: 4,
      dayColumnFraction: 0.1,
      overlapFraction: 1,
    })

    expect(bande[0].slice.left).toBe(100)
    const ultima = bande[bande.length - 1]
    expect(ultima.slice.left + ultima.slice.width).toBe(1000)
  })

  it('rispetta un area della tabella più piccola della foto', () => {
    const bande = planBands({
      width: 1000,
      height: 800,
      columns: 2,
      dayColumnFraction: 0.1,
      overlapFraction: 0,
      area: { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 },
    })

    // Area: x da 100 a 900 (800px), y da 160 a 640 (480px). Colonna giorni: 80px.
    expect(bande[0].dayStrip).toEqual({ left: 100, top: 160, width: 80, height: 480 })
    expect(bande[0].slice).toEqual({ left: 180, top: 160, width: 360, height: 480 })
    expect(bande[1].slice).toEqual({ left: 540, top: 160, width: 360, height: 480 })
  })

  it('le colonne coperte dalle bande sono tutte quelle dichiarate, senza buchi', () => {
    const bande = planBands({ width: 1200, height: 900, columns: 13, columnsPerBand: 3 })

    const coperte = new Set<number>()
    for (const banda of bande) {
      for (let c = banda.columnFrom; c < banda.columnTo; c += 1) coperte.add(c)
    }
    expect([...coperte].sort((a, b) => a - b)).toEqual([...Array(13).keys()])
  })

  it('rifiuta una geometria impossibile invece di produrre bande larghe zero', () => {
    expect(() => planBands({ width: 1000, height: 800, columns: 0 })).toThrow(/colonne/i)
    expect(() => planBands({ width: 1000, height: 800, columns: 3, dayColumnFraction: 1 })).toThrow(
      /colonna dei giorni/i,
    )
    expect(() =>
      planBands({ width: 1000, height: 800, columns: 3, columnsPerBand: 0 }),
    ).toThrow(/per banda/i)
    expect(() =>
      planBands({
        width: 1000,
        height: 800,
        columns: 3,
        area: { left: 0.6, top: 0, right: 0.5, bottom: 1 },
      }),
    ).toThrow(/area/i)
  })
})

describe('cropRosterBands — i ritagli veri', () => {
  it('produce un JPEG per banda, largo come colonna dei giorni più fetta', async () => {
    const immagine = await immagineFinta()
    const piano = planBands({ width: 1000, height: 800, columns: 4, dayColumnFraction: 0.1 })

    const ritagli = await cropRosterBands(immagine, piano)

    expect(ritagli).toHaveLength(4)
    for (const [i, ritaglio] of ritagli.entries()) {
      expect(ritaglio.index).toBe(i)
      const meta = await sharp(ritaglio.data).metadata()
      expect(meta.format).toBe('jpeg')
      expect(meta.width).toBe(totalWidth(piano[i]))
      expect(meta.height).toBe(800)
    }
  })

  it('ritaglia una sola banda su richiesta, senza rifare tutte le altre', async () => {
    const immagine = await immagineFinta()
    const piano = planBands({ width: 1000, height: 800, columns: 4 })

    const ritagli = await cropRosterBands(immagine, [piano[2]])

    expect(ritagli).toHaveLength(1)
    expect(ritagli[0].index).toBe(2)
  })
})

describe('renderBandPreview — la referente vede dove tagliamo prima di mandare la foto all AI', () => {
  it('restituisce un JPEG delle dimensioni della foto originale', async () => {
    const immagine = await immagineFinta(900, 600)
    const piano = planBands({ width: 900, height: 600, columns: 6 })

    const anteprima = await renderBandPreview(immagine, piano)

    const meta = await sharp(anteprima).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(900)
    expect(meta.height).toBe(600)
  })
})

describe('imageDimensions', () => {
  it('legge larghezza e altezza del JPEG salvato, per pianificare le bande', async () => {
    const immagine = await immagineFinta(640, 480)

    expect(await imageDimensions(immagine)).toEqual({ width: 640, height: 480 })
  })

  it("rifiuta un buffer che non è un'immagine", async () => {
    await expect(imageDimensions(Buffer.from('non una foto'))).rejects.toThrow(/immagine/i)
  })
})
