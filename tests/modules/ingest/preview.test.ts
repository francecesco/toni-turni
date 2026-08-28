import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { previewOverlaySvg, renderRosterPreview } from '@/modules/ingest/preview'

/**
 * L'anteprima è il controllo umano che sta fra il rilevamento della griglia e
 * venti minuti di chiamate al provider: se il riquadro o i confini di colonna
 * sono sbagliati, è qui che si vede prima di spendere token e di attribuire
 * turni alla persona sbagliata. Quindi si verifica che disegni **i confini
 * rilevati**, non delle frazioni fisse.
 */
describe("previewOverlaySvg — i tagli disegnati sul riquadro raddrizzato", () => {
  // blocco dei giorni largo come una colonna, poi quattro colonne di contenuto
  const colonne = [0, 0.2, 0.4, 0.6, 0.8, 1]

  it('dichiara le dimensioni del riquadro raddrizzato', () => {
    const svg = previewOverlaySvg({ width: 1000, height: 800, columns: colonne, daysInMonth: 31 })
    expect(svg).toContain('width="1000"')
    expect(svg).toContain('height="800"')
  })

  it('traccia una linea verticale su ogni confine di colonna rilevato', () => {
    const svg = previewOverlaySvg({ width: 1000, height: 800, columns: colonne, daysInMonth: 31 })
    for (const x of [0, 200, 400, 600, 800, 1000]) {
      expect(svg).toContain(`x1="${x}"`)
    }
  })

  it('distingue la fine del blocco dei giorni dagli altri confini', () => {
    const svg = previewOverlaySvg({ width: 1000, height: 800, columns: colonne, daysInMonth: 31 })
    const giorni = svg
      .split('\n')
      .filter((riga) => riga.includes('data-ruolo="giorni"'))
    expect(giorni).toHaveLength(1)
    expect(giorni[0]).toContain('x1="200"')
  })

  it('mostra la cucitura fra le due metà del mese come una fascia, non come una riga', () => {
    const svg = previewOverlaySvg({ width: 1000, height: 800, columns: colonne, daysInMonth: 31 })
    const cuciture = svg
      .split('\n')
      .filter((riga) => riga.includes('data-ruolo="cucitura"'))
    // due linee: il bordo basso della prima metà e il bordo alto della seconda,
    // che si sovrappongono di proposito
    expect(cuciture).toHaveLength(2)
    const y = cuciture.map((riga) => Number(/y1="([\d.]+)"/.exec(riga)?.[1]))
    expect(y.every((valore) => valore > 0 && valore < 800)).toBe(true)
    expect(y[0]).not.toBe(y[1])
  })

  it('numera i gruppi di colonne che finiranno in una lettura', () => {
    // quattro colonne di contenuto oltre il blocco dei giorni, due per lettura
    const svg = previewOverlaySvg({ width: 1000, height: 800, columns: colonne, daysInMonth: 31 })
    const etichette = svg.split('\n').filter((riga) => riga.includes('data-ruolo="gruppo"'))
    expect(etichette).toHaveLength(2)
    expect(etichette[0]).toContain('>1<')
    expect(etichette[1]).toContain('>2<')
  })

  it('non disegna un confine spurio: si taglia sui confini ripuliti', () => {
    // 0,205 è a un quarto della distanza mediana dal confine precedente: non può
    // delimitare una colonna del modulo, e lì non si taglierà.
    const svg = previewOverlaySvg({
      width: 1000,
      height: 800,
      columns: [0, 0.2, 0.205, 0.4, 0.6, 0.8, 1],
      daysInMonth: 31,
    })
    expect(svg).not.toContain('x1="205"')
    expect(svg).toContain('x1="200"')
  })

  it('non nasconde un riquadro senza colonne di contenuto: lo dichiara', () => {
    expect(() =>
      previewOverlaySvg({ width: 1000, height: 800, columns: [0, 1], daysInMonth: 31 }),
    ).toThrow(/colonne/)
  })
})

describe('renderRosterPreview — il JPEG che la referente guarda', () => {
  it('compone i tagli sopra il riquadro raddrizzato, alle sue dimensioni', async () => {
    const raddrizzato = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer()

    const anteprima = await renderRosterPreview(Buffer.from('foto finta'), {
      daysInMonth: 30,
      deskew: async () => ({
        data: raddrizzato,
        width: 400,
        height: 300,
        columns: [0, 0.2, 0.4, 0.6, 0.8, 1],
      }),
    })

    const meta = await sharp(anteprima).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(400)
    expect(meta.height).toBe(300)
  })
})
