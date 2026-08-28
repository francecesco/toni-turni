import { describe, expect, it, vi } from 'vitest'
import type { BandSpec } from '@/modules/ingest/layout'
import type { RosterBand } from '@/modules/ingest/crop'
import {
  createTokenPacer,
  extractRosterByBands,
  GROQ_FREE_TOKENS_PER_MINUTE,
} from '@/modules/extract/extract-bands'
import {
  VisionProviderError,
  VisionTruncatedError,
  type VisionProvider,
} from '@/modules/extract/providers/types'

const HEADER = { year: 2026, month: 8, ward: '3°PIANO' }

function spec(colonne: number[], dayFrom: number, dayTo: number): BandSpec {
  return {
    columns: colonne,
    dayFrom,
    dayTo,
    days: { left: 0, width: 0.1 },
    crop: { left: 0.1, top: 0, width: 0.2, height: 0.5 },
    header: null,
  }
}

/** Una banda finta, riconoscibile dal primo byte dell immagine. */
function band(marker: number, colonne: number[], dayFrom: number, dayTo: number): RosterBand {
  return {
    spec: spec(colonne, dayFrom, dayTo),
    image: Buffer.from([marker]),
    width: 600,
    height: 1300,
  }
}

function risposta(cells: Array<[number, string, string]>, columns?: string[]): string {
  return JSON.stringify({
    columns: columns ?? [...new Set(cells.map(([, colonna]) => colonna))],
    cells: cells.map(([day, column, code]) => ({
      day,
      column,
      code,
      confidence: 0.9,
      handCorrected: false,
    })),
  })
}

function provider(name: string, ...risposte: Array<string | Error>): VisionProvider {
  const extract = vi.fn()
  for (const r of risposte) {
    if (r instanceof Error) extract.mockRejectedValueOnce(r)
    else extract.mockResolvedValueOnce({ raw: r, model: `${name}-model`, provider: name })
  }
  return { name, extract }
}

/** Un pacer che non attende: nessun test deve dormire. */
function pacerFinto() {
  const chiamate: Array<{ index: number; retryAfterSeconds?: number }> = []
  const pace = async (index: number, retryAfterSeconds?: number) => {
    chiamate.push({ index, retryAfterSeconds })
  }
  return { pace, chiamate }
}

describe('extractRosterByBands', () => {
  it('fonde due bande riuscite in un unica estrazione', async () => {
    const p = provider(
      'groq',
      risposta([[1, 'RENATA', 'M']]),
      risposta([[1, 'ALEX', 'P']]),
    )
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1, 2], 1, 16), band(2, [3, 4], 1, 16)],
      knownCodes: ['M', 'P'],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(2)
    expect(outcome.extraction.columns).toEqual(['RENATA', 'ALEX'])
    expect(outcome.extraction.year).toBe(2026)
    expect(outcome.rawOutputs).toHaveLength(2)
    expect(outcome.provider).toBe('groq')
    expect(outcome.attempts).toBe(2)
    expect(outcome.conflicts).toBe(0)
  })

  it('una banda fallita finisce in failures, le altre restano', async () => {
    const p = provider(
      'groq',
      risposta([[1, 'RENATA', 'M']]),
      new VisionProviderError('quota esaurita'),
      risposta([[1, 'ALEX', 'P']]),
    )
    const bande = [band(1, [1], 1, 16), band(2, [2], 1, 16), band(3, [3], 1, 16)]
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: bande,
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].spec).toBe(bande[1].spec)
    expect(outcome.failures[0].error).toContain('quota esaurita')
    expect(outcome.extraction.cells.map((c) => c.column)).toEqual(['RENATA', 'ALEX'])
  })

  it('elabora le bande in sequenza, una chiamata alla volta', async () => {
    const ordine: number[] = []
    let inVolo = 0
    let massimoInVolo = 0
    const p: VisionProvider = {
      name: 'groq',
      extract: vi.fn(async (request) => {
        inVolo += 1
        massimoInVolo = Math.max(massimoInVolo, inVolo)
        ordine.push(request.image[0])
        await Promise.resolve()
        inVolo -= 1
        return { raw: risposta([]), model: 'm', provider: 'groq' }
      }),
    }
    const { pace } = pacerFinto()

    await extractRosterByBands({
      bands: [band(7, [1], 1, 16), band(8, [2], 1, 16), band(9, [3], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(ordine).toEqual([7, 8, 9])
    expect(massimoInVolo).toBe(1)
  })

  it('chiama pace fra le bande e non dopo l ultima', async () => {
    const p = provider('groq', risposta([]), risposta([]), risposta([]))
    const { pace, chiamate } = pacerFinto()

    await extractRosterByBands({
      bands: [band(1, [1], 1, 16), band(2, [2], 1, 16), band(3, [3], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(chiamate.map((c) => c.index)).toEqual([1, 2])
  })

  it('passa al pacer il retryAfterSeconds dell errore e ritenta la banda una volta sola', async () => {
    const p = provider(
      'groq',
      new VisionProviderError('troppe richieste', { status: 429, retryAfterSeconds: 12 }),
      risposta([[1, 'RENATA', 'M']]),
    )
    const { pace, chiamate } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(chiamate).toEqual([{ index: 0, retryAfterSeconds: 12 }])
    expect(p.extract).toHaveBeenCalledTimes(2)
    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(1)
    expect(outcome.attempts).toBe(2)
  })

  it('non ritenta più di una volta una banda che va sempre in rate limit', async () => {
    const p = provider(
      'groq',
      new VisionProviderError('troppe richieste', { status: 429, retryAfterSeconds: 3 }),
      new VisionProviderError('troppe richieste', { status: 429, retryAfterSeconds: 3 }),
    )
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).toHaveBeenCalledTimes(2)
    expect(outcome.failures).toHaveLength(1)
  })

  it('non ritenta una risposta troncata: rimandarla la troncherebbe di nuovo', async () => {
    const p = provider('groq', new VisionTruncatedError('risposta troncata'))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).toHaveBeenCalledTimes(1)
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].error).toContain('troncata')
  })

  it('chiede una riparazione quando l output della banda non è valido, e riesce', async () => {
    const p = provider('groq', '{"columns": ["RENATA"]}', risposta([[1, 'RENATA', 'M']]))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).toHaveBeenCalledTimes(2)
    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(1)
    expect(vi.mocked(p.extract).mock.calls[1][0].previousTurns).toHaveLength(2)
  })

  it('passa alla riserva la banda che il provider principale non riesce a leggere', async () => {
    const primario = provider('groq', new VisionProviderError('quota esaurita'))
    const riserva = provider('anthropic', risposta([[1, 'RENATA', 'M']]))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: primario,
      fallback: riserva,
      pace,
    })

    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(1)
    expect(outcome.provider).toContain('anthropic')
  })

  it('con tutte le bande fallite restituisce un outcome vuoto invece di lanciare', async () => {
    // il numero di bande dipende da quante colonne ha la foto (10 su agosto,
    // 14 su settembre): il test non lo fissa
    const bande = Array.from({ length: 11 }, (_, i) => band(i, [i + 1], 1, 16))
    const p = provider('groq', ...bande.map(() => new VisionProviderError('quota esaurita')))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: bande,
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(bande.length)
    expect(outcome.extraction.cells).toEqual([])
    expect(outcome.extraction.columns).toEqual([])
    expect(outcome.provider).toBe('groq')
  })

  it('costruisce per ogni banda il prompt del suo intervallo di giorni e delle sue colonne', async () => {
    const p = provider('groq', risposta([]), risposta([]))
    const { pace } = pacerFinto()

    await extractRosterByBands({
      bands: [band(1, [1, 2], 1, 16), band(2, [1, 2], 17, 31)],
      knownCodes: ['NOTTE'],
      header: HEADER,
      provider: p,
      pace,
    })

    const primo = vi.mocked(p.extract).mock.calls[0][0].prompt
    const secondo = vi.mocked(p.extract).mock.calls[1][0].prompt

    expect(primo).toMatch(/dal giorno 1 al giorno 16/i)
    expect(secondo).toMatch(/dal giorno 17 al giorno 31/i)
    expect(primo).toContain('NOTTE')
    // due colonne di contenuto per banda
    expect(primo).toMatch(/\b2\b/)
  })

  it('propaga i conflitti della fusione e scarta le colonne di servizio', async () => {
    const p = provider(
      'groq',
      risposta([
        [1, 'RENATA', 'M'],
        [1, 'AIUTO MATT.', '3'],
        [30, 'RENATA', 'P'],
      ]),
    )
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1, 2], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    // la colonna di aiuto sparisce senza contare come conflitto; il giorno 30
    // fuori dalla banda è un conflitto
    expect(outcome.extraction.columns).toEqual(['RENATA'])
    expect(outcome.extraction.cells).toHaveLength(1)
    expect(outcome.conflicts).toBe(1)
  })

  it('conserva il testo grezzo anche delle bande fallite, che è ciò che si guarda dopo', async () => {
    const p = provider('groq', 'questa non è una risposta', 'nemmeno questa')
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.rawOutputs.join('\n')).toContain('questa non è una risposta')
  })

  it('senza bande non chiama il provider e non lancia', async () => {
    const p = provider('groq')
    const { pace, chiamate } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).not.toHaveBeenCalled()
    expect(chiamate).toEqual([])
    expect(outcome.extraction.cells).toEqual([])
    expect(outcome.failures).toEqual([])
  })
})

describe('createTokenPacer', () => {
  /** Orologio e attesa finti: il pacer non deve mai dormire in un test. */
  function orologio() {
    let adesso = 0
    const attese: number[] = []
    return {
      attese,
      now: () => adesso,
      sleep: async (ms: number) => {
        attese.push(ms)
        adesso += ms
      },
      avanza: (ms: number) => {
        adesso += ms
      },
    }
  }

  it('attende l intervallo che tiene il consumo sotto il tetto di token al minuto', async () => {
    const o = orologio()
    const pace = createTokenPacer({
      tokensPerMinute: 8000,
      tokensPerBand: 4000,
      now: o.now,
      sleep: o.sleep,
    })

    await pace(1)

    // 4000 token per banda su un tetto di 8000 al minuto: una banda ogni 30 s
    expect(o.attese).toEqual([30_000])
  })

  it('sottrae il tempo già passato nella chiamata al modello', async () => {
    const o = orologio()
    const pace = createTokenPacer({
      tokensPerMinute: 8000,
      tokensPerBand: 4000,
      now: o.now,
      sleep: o.sleep,
    })

    await pace(1)
    o.avanza(10_000) // la banda successiva ha impiegato 10 s
    await pace(2)

    expect(o.attese).toEqual([30_000, 20_000])
  })

  it('non attende affatto se è già passato più dell intervallo', async () => {
    const o = orologio()
    const pace = createTokenPacer({
      tokensPerMinute: 8000,
      tokensPerBand: 4000,
      now: o.now,
      sleep: o.sleep,
    })

    await pace(1)
    o.avanza(90_000)
    await pace(2)

    expect(o.attese).toEqual([30_000])
  })

  it('rispetta un retryAfterSeconds più lungo dell intervallo', async () => {
    const o = orologio()
    const pace = createTokenPacer({
      tokensPerMinute: 8000,
      tokensPerBand: 4000,
      now: o.now,
      sleep: o.sleep,
    })

    await pace(1, 45)

    expect(o.attese).toEqual([45_000])
  })

  it('col retryAfterSeconds più corto dell intervallo attende comunque l intervallo', async () => {
    const o = orologio()
    const pace = createTokenPacer({
      tokensPerMinute: 8000,
      tokensPerBand: 4000,
      now: o.now,
      sleep: o.sleep,
    })

    await pace(1, 2)

    expect(o.attese).toEqual([30_000])
  })

  it('col ritmo di default copre la banda piu pesante misurata, prenotati compresi', async () => {
    // Numeri della misura reale su 24 bande (due foto): l input per banda e
    // 1577-1581 nel caso normale e 2601-2605 sulle bande larghe, quelle che
    // includono le colonne di aiuto. Groq mette nel budget al minuto anche i
    // token di output **prenotati** con `max_completion_tokens`, quindi la
    // banda peggiore pesa 2605 + 4000 = 6605. Col ritmo tarato su 5500 si sono
    // vista 3 risposte 429.
    const INPUT_BANDA_PEGGIORE = 2605
    const OUTPUT_PRENOTATI = 4000
    const pesoBandaPeggiore = INPUT_BANDA_PEGGIORE + OUTPUT_PRENOTATI

    const o = orologio()
    const pace = createTokenPacer({ now: o.now, sleep: o.sleep })

    await pace(1)

    const intervallo = o.attese[0]
    expect(intervallo).toBeGreaterThan(0)
    // quante bande stanno in un minuto a questo ritmo: anche se sono tutte
    // della specie peggiore, devono stare sotto il tetto
    const bandePerMinuto = 60_000 / intervallo
    expect(bandePerMinuto * pesoBandaPeggiore).toBeLessThanOrEqual(GROQ_FREE_TOKENS_PER_MINUTE)
  })
})
