import { describe, expect, it, vi } from 'vitest'
import { extractRosterByBands, parseBandExtraction } from '@/modules/extract/bands'
import { buildBandPrompt } from '@/modules/extract/prompt'
import {
  VisionProviderError,
  VisionTruncatedError,
  type VisionProvider,
} from '@/modules/extract/providers/types'
import type { BandImage } from '@/modules/ingest/bands'

function banda(index: number, columnFrom = index): BandImage {
  return {
    index,
    data: Buffer.from(`banda-${index}`),
    width: 300,
    height: 800,
    columnFrom,
    columnTo: columnFrom + 1,
  }
}

function rispostaValida(column: string, codes: string[]): string {
  const cells = codes.map((code, i) => ({
    day: i + 1,
    column,
    code,
    confidence: 0.95,
    handCorrected: false,
  }))
  return JSON.stringify({ columns: [column], cells })
}

function providerFinto(risposte: Array<string | Error>): VisionProvider & {
  chiamate: number
} {
  let chiamate = 0
  return {
    name: 'finto',
    get chiamate() {
      return chiamate
    },
    async extract() {
      const risposta = risposte[chiamate]
      chiamate += 1
      if (risposta === undefined) throw new Error('il test non ha previsto questa chiamata')
      if (risposta instanceof Error) throw risposta
      return { raw: risposta, model: 'modello-finto', provider: 'finto' }
    },
  }
}

const nessunaAttesa = async () => {}

describe('parseBandExtraction — validazione dell output di una banda', () => {
  it('accetta colonne e celle di un ritaglio, senza pretendere anno, mese e reparto', () => {
    const risultato = parseBandExtraction(rispostaValida('CRISTINA', ['M', 'P']), {
      daysInMonth: 31,
    })

    expect(risultato.ok).toBe(true)
    if (!risultato.ok) return
    expect(risultato.value.columns).toEqual(['CRISTINA'])
    expect(risultato.value.cells).toHaveLength(2)
  })

  it('rifiuta un giorno che nel mese non esiste', () => {
    const raw = JSON.stringify({
      columns: ['CRISTINA'],
      cells: [{ day: 31, column: 'CRISTINA', code: 'M', confidence: 0.9, handCorrected: false }],
    })

    const risultato = parseBandExtraction(raw, { daysInMonth: 30 })

    expect(risultato.ok).toBe(false)
    if (risultato.ok) return
    expect(risultato.error).toMatch(/31/)
  })

  it('rifiuta una cella che cita una colonna non dichiarata dalla banda', () => {
    const raw = JSON.stringify({
      columns: ['CRISTINA'],
      cells: [{ day: 1, column: 'SARA', code: 'M', confidence: 0.9, handCorrected: false }],
    })

    const risultato = parseBandExtraction(raw, { daysInMonth: 31 })

    expect(risultato.ok).toBe(false)
    if (risultato.ok) return
    expect(risultato.error).toMatch(/SARA/)
  })

  it('conserva la confidenza dichiarata dal modello, anche alta: non la reinterpreta', () => {
    const raw = JSON.stringify({
      columns: ['CRISTINA'],
      cells: [{ day: 1, column: 'CRISTINA', code: 'M', confidence: 0.42, handCorrected: true }],
    })

    const risultato = parseBandExtraction(raw, { daysInMonth: 31 })

    expect(risultato.ok).toBe(true)
    if (!risultato.ok) return
    expect(risultato.value.cells[0].confidence).toBe(0.42)
    expect(risultato.value.cells[0].handCorrected).toBe(true)
  })
})

describe('buildBandPrompt', () => {
  it('spiega che l immagine è un ritaglio con la colonna dei giorni a sinistra', () => {
    const prompt = buildBandPrompt(['M', 'P'], { daysInMonth: 31 })

    expect(prompt).toMatch(/ritaglio/i)
    expect(prompt).toMatch(/colonna dei giorni/i)
    expect(prompt).toMatch(/"M", "P"/)
    expect(prompt).toMatch(/31/)
    // Anno, mese e reparto non sono nel ritaglio: non vanno chiesti.
    expect(prompt).not.toMatch(/"year"/)
  })
})

describe('extractRosterByBands — una chiamata per banda', () => {
  it('legge tutte le bande e unisce le colonne trovate', async () => {
    const provider = providerFinto([
      rispostaValida('CRISTINA', ['M', 'P']),
      rispostaValida('SARA DP.', ['NOTTE', 'SN']),
    ])

    const esito = await extractRosterByBands({
      bands: [banda(0), banda(1)],
      knownCodes: ['M', 'P'],
      daysInMonth: 31,
      provider,
      sleep: nessunaAttesa,
    })

    expect(esito.failures).toEqual([])
    expect(esito.columns).toEqual(['CRISTINA', 'SARA DP.'])
    expect(esito.bands.flatMap((b) => b.extraction?.cells ?? [])).toHaveLength(4)
    expect(esito.provider).toBe('finto')
    expect(esito.model).toBe('modello-finto')
  })

  it('chiama onBand dopo ogni banda, così il salvataggio è incrementale e un riavvio non perde nulla', async () => {
    const provider = providerFinto([
      rispostaValida('CRISTINA', ['M']),
      rispostaValida('SARA', ['P']),
    ])
    const salvate: number[] = []

    await extractRosterByBands({
      bands: [banda(0), banda(1)],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      sleep: nessunaAttesa,
      onBand: async (risultato) => {
        salvate.push(risultato.index)
      },
    })

    expect(salvate).toEqual([0, 1])
  })

  it('una banda illeggibile non ferma le altre e finisce dichiarata fra le failures', async () => {
    const provider = providerFinto([
      'non è json',
      'ancora non è json',
      rispostaValida('SARA', ['P']),
    ])

    const esito = await extractRosterByBands({
      bands: [banda(0), banda(1)],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      sleep: nessunaAttesa,
    })

    expect(esito.failures.map((f) => f.index)).toEqual([0])
    expect(esito.failures[0].rawOutput).toBe('ancora non è json')
    expect(esito.failures[0].error).toBeTruthy()
    expect(esito.bands[1].ok).toBe(true)
    expect(esito.columns).toEqual(['SARA'])
  })

  it('aspetta la pausa fra le bande e non dopo l ultima: il piano gratuito ha un tetto al minuto', async () => {
    const provider = providerFinto([
      rispostaValida('A', ['M']),
      rispostaValida('B', ['M']),
      rispostaValida('C', ['M']),
    ])
    const attese: number[] = []

    await extractRosterByBands({
      bands: [banda(0), banda(1), banda(2)],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      pauseMs: 50_000,
      sleep: async (ms) => void attese.push(ms),
    })

    expect(attese).toEqual([50_000, 50_000])
  })

  it('su un rate limit con retry-after aspetta quel tempo e riprova la stessa banda', async () => {
    const provider = providerFinto([
      new VisionProviderError('Groq ha risposto con stato 429', {
        status: 429,
        retryAfterSeconds: 12,
      }),
      rispostaValida('CRISTINA', ['M']),
    ])
    const attese: number[] = []

    const esito = await extractRosterByBands({
      bands: [banda(0)],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      sleep: async (ms) => void attese.push(ms),
    })

    expect(attese).toEqual([12_000])
    expect(esito.failures).toEqual([])
    expect(esito.bands[0].ok).toBe(true)
  })

  it('una risposta troncata non viene riprovata sulla stessa banda: si troncherebbe di nuovo', async () => {
    const provider = providerFinto([new VisionTruncatedError('risposta troncata')])

    const esito = await extractRosterByBands({
      bands: [banda(0)],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      sleep: nessunaAttesa,
    })

    expect(provider.chiamate).toBe(1)
    expect(esito.failures.map((f) => f.index)).toEqual([0])
    expect(esito.failures[0].error).toMatch(/tronc/i)
  })

  it('passa al provider di riserva la banda che il principale non riesce a leggere', async () => {
    const primario = providerFinto(['non è json', 'nemmeno adesso'])
    const riserva = providerFinto([rispostaValida('CRISTINA', ['M'])])

    const esito = await extractRosterByBands({
      bands: [banda(0)],
      knownCodes: [],
      daysInMonth: 31,
      provider: primario,
      fallback: riserva,
      sleep: nessunaAttesa,
    })

    expect(esito.failures).toEqual([])
    expect(esito.bands[0].ok).toBe(true)
    expect(riserva.chiamate).toBe(1)
  })

  it('conserva il raw output di ogni banda, anche di quelle riuscite, per il debug', async () => {
    const provider = providerFinto([rispostaValida('CRISTINA', ['M']), 'no', 'no'])

    const esito = await extractRosterByBands({
      bands: [banda(0), banda(1)],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      sleep: nessunaAttesa,
    })

    expect(esito.rawOutputs).toHaveLength(2)
    expect(esito.rawOutputs[0].raw).toContain('CRISTINA')
    expect(esito.rawOutputs[1].raw).toBe('no')
  })

  it('manda al provider il ritaglio della banda, non la foto intera', async () => {
    const extract = vi.fn().mockResolvedValue({
      raw: rispostaValida('CRISTINA', ['M']),
      model: 'm',
      provider: 'finto',
    })
    const provider: VisionProvider = { name: 'finto', extract }

    await extractRosterByBands({
      bands: [banda(3)],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      sleep: nessunaAttesa,
    })

    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract.mock.calls[0][0].image.toString()).toBe('banda-3')
  })

  it('senza bande non chiama il provider e non dichiara errori', async () => {
    const provider = providerFinto([])

    const esito = await extractRosterByBands({
      bands: [],
      knownCodes: [],
      daysInMonth: 31,
      provider,
      sleep: nessunaAttesa,
    })

    expect(provider.chiamate).toBe(0)
    expect(esito.bands).toEqual([])
    expect(esito.failures).toEqual([])
  })
})
