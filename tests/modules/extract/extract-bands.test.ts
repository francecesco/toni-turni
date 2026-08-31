import { describe, expect, it, vi } from 'vitest'
import type { BandSpec } from '@/modules/ingest/layout'
import type { RosterBand } from '@/modules/ingest/crop'
import {
  createRetryAfterPacer,
  extractRosterByBands,
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
  const chiamate: Array<{ index: number; retryAfterSeconds?: number; retry?: boolean }> = []
  const pace = async (
    index: number,
    retryAfterSeconds?: number,
    options?: { retry?: boolean },
  ) => {
    chiamate.push({ index, retryAfterSeconds, retry: options?.retry })
  }
  return { pace, chiamate }
}

describe('extractRosterByBands', () => {
  it('fonde due bande riuscite in un unica estrazione', async () => {
    const p = provider(
      'gemini',
      risposta([[1, 'RENATA', 'M']]),
      risposta([[1, 'ALEX', 'P']]),
    )
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      // una colonna e un giorno per banda: le bande rispondono su tutti gli
      // incroci che dichiarano, quindi non c è nessun buco da dichiarare
      bands: [band(1, [1], 1, 1), band(2, [2], 1, 1)],
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
    expect(outcome.provider).toBe('gemini')
    expect(outcome.attempts).toBe(2)
    expect(outcome.conflicts).toBe(0)
  })

  it('una banda fallita finisce in failures, le altre restano', async () => {
    const p = provider(
      'gemini',
      risposta([[1, 'RENATA', 'M']]),
      new VisionProviderError('chiave rifiutata', { status: 403 }),
      risposta([[1, 'ALEX', 'P']]),
    )
    const bande = [band(1, [1], 1, 1), band(2, [2], 1, 1), band(3, [3], 1, 1)]
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
    expect(outcome.failures[0].error).toContain('chiave rifiutata')
    expect(outcome.extraction.cells.map((c) => c.column)).toEqual(['RENATA', 'ALEX'])
  })

  it('elabora le bande in sequenza, una chiamata alla volta', async () => {
    const ordine: number[] = []
    let inVolo = 0
    let massimoInVolo = 0
    const p: VisionProvider = {
      name: 'gemini',
      extract: vi.fn(async (request) => {
        inVolo += 1
        massimoInVolo = Math.max(massimoInVolo, inVolo)
        ordine.push(request.image[0])
        await Promise.resolve()
        inVolo -= 1
        return { raw: risposta([]), model: 'm', provider: 'gemini' }
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
    const p = provider('gemini', risposta([]), risposta([]), risposta([]))
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
      'gemini',
      new VisionProviderError('troppe richieste', { status: 429, retryAfterSeconds: 12 }),
      risposta([[1, 'RENATA', 'M']]),
    )
    const { pace, chiamate } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 1)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(chiamate).toEqual([{ index: 0, retryAfterSeconds: 12, retry: true }])
    expect(p.extract).toHaveBeenCalledTimes(2)
    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(1)
    expect(outcome.attempts).toBe(2)
  })

  it('non ritenta più di una volta una banda che va sempre in rate limit', async () => {
    const p = provider(
      'gemini',
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

  it('ritenta un rate limit anche quando il provider non indica quanto attendere', async () => {
    // Groq mandava sempre `retry-after`; non tutti lo fanno. Gate sul solo header
    // significava non ritentare affatto, cioe perdere la banda al primo 429.
    const p = provider(
      'gemini',
      new VisionProviderError('troppe richieste', { status: 429 }),
      risposta([[1, 'RENATA', 'M']]),
    )
    const { pace, chiamate } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 1)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).toHaveBeenCalledTimes(2)
    expect(chiamate).toEqual([{ index: 0, retryAfterSeconds: undefined, retry: true }])
    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(1)
  })

  it.each([500, 502, 503, 504])('ritenta un %i, che e transitorio', async (status) => {
    // Misurato sul serio: la prima chiamata su agosto ha preso un **503 dopo 40
    // secondi**. Con dieci bande un 503 perdeva una banda; con la tabella intera
    // in una chiamata perde **tutta la tabella**, quindi ritentare non e un lusso.
    const p = provider(
      'gemini',
      new VisionProviderError('servizio non disponibile', { status }),
      risposta([[1, 'RENATA', 'M']]),
    )
    const { pace, chiamate } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 1)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).toHaveBeenCalledTimes(2)
    expect(chiamate).toEqual([{ index: 0, retryAfterSeconds: undefined, retry: true }])
    expect(outcome.failures).toEqual([])
  })

  it.each([400, 401, 403, 404])(
    'non ritenta un %i, che e un errore di configurazione',
    async (status) => {
      // Chiave sbagliata, modello inesistente, richiesta malformata: riprovare
      // spende quota e produce lo stesso rifiuto.
      const p = provider(
        'gemini',
        new VisionProviderError('rifiutata', { status }),
        risposta([[1, 'RENATA', 'M']]),
      )
      const { pace } = pacerFinto()

      const outcome = await extractRosterByBands({
        bands: [band(1, [1], 1, 1)],
        knownCodes: [],
        header: HEADER,
        provider: p,
        pace,
      })

      expect(p.extract).toHaveBeenCalledTimes(1)
      expect(outcome.failures).toHaveLength(1)
    },
  )

  it('ritenta un guasto di rete, che non ha nessuno stato HTTP', async () => {
    // Misurato: la lettura di agosto e rimasta appesa **301 secondi** e poi e
    // caduta senza stato (il `headersTimeout` di Node e 300 s). Con il gate sullo
    // stato HTTP non veniva ritentata, e con una chiamata sola quello e tutta la
    // tabella persa per una connessione andata male.
    const p = provider(
      'gemini',
      new VisionProviderError('Chiamata di rete a Gemini non riuscita'),
      risposta([[1, 'RENATA', 'M']]),
    )
    const { pace, chiamate } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 1)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).toHaveBeenCalledTimes(2)
    expect(chiamate).toEqual([{ index: 0, retryAfterSeconds: undefined, retry: true }])
    expect(outcome.failures).toEqual([])
  })

  it('non ritenta un errore del provider che non e un rate limit', async () => {
    // Una chiave sbagliata o un modello inesistente non migliorano riprovando.
    const p = provider(
      'gemini',
      new VisionProviderError('chiave non valida', { status: 401 }),
      risposta([[1, 'RENATA', 'M']]),
    )
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 1)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(p.extract).toHaveBeenCalledTimes(1)
    expect(outcome.failures).toHaveLength(1)
  })

  it('non ritenta una risposta troncata: rimandarla la troncherebbe di nuovo', async () => {
    const p = provider('gemini', new VisionTruncatedError('risposta troncata'))
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
    const p = provider('gemini', '{"columns": ["RENATA"]}', risposta([[1, 'RENATA', 'M']]))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 1)],
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
    const primario = provider('gemini', new VisionProviderError('chiave rifiutata', { status: 403 }))
    const riserva = provider('anthropic', risposta([[1, 'RENATA', 'M']]))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 1)],
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
    const p = provider('gemini', ...bande.map(() => new VisionProviderError('chiave rifiutata', { status: 403 })))
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
    expect(outcome.provider).toBe('gemini')
  })

  it('costruisce per ogni banda il prompt del suo intervallo di giorni e delle sue colonne', async () => {
    const p = provider('gemini', risposta([]), risposta([]))
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
      'gemini',
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
    const p = provider('gemini', 'questa non è una risposta', 'nemmeno questa')
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
    const p = provider('gemini')
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

describe('createRetryAfterPacer', () => {
  /** Attesa finta: nessun test deve dormire davvero. */
  function orologio() {
    const attese: number[] = []
    return { attese, sleep: async (ms: number) => void attese.push(ms) }
  }

  it('fra due bande non attende affatto', async () => {
    // Il pacer di prima esisteva per il tetto di 8000 token al minuto del piano
    // gratuito di Groq, e faceva ~50 s di attesa fra una banda e l altra: il 92%
    // del tempo di un estrazione era quello. Senza quel tetto non c e niente da
    // distanziare, e distanziare "per prudenza" costerebbe minuti a vuoto.
    const o = orologio()
    const pace = createRetryAfterPacer({ sleep: o.sleep })

    await pace(1)
    await pace(2)
    await pace(3)

    expect(o.attese).toEqual([])
  })

  it('attende quando il provider ha chiesto di riprovare piu tardi', async () => {
    const o = orologio()
    const pace = createRetryAfterPacer({ sleep: o.sleep })

    await pace(1, 30)

    expect(o.attese).toEqual([30_000])
  })

  it('attende un ritardo di riserva quando il provider non lo indica', async () => {
    // Un 429 senza `retry-after` c e, e un 503 non lo manda quasi mai: riprovare
    // nello stesso istante prende lo stesso rifiuto e brucia il solo ritentativo
    // che una banda ha.
    const o = orologio()
    const pace = createRetryAfterPacer({ sleep: o.sleep })

    await pace(1, undefined, { retry: true })

    expect(o.attese).toHaveLength(1)
    expect(o.attese[0]).toBeGreaterThanOrEqual(5_000)
  })

  it('rispetta il ritardo di riserva configurato', async () => {
    const o = orologio()
    const pace = createRetryAfterPacer({ sleep: o.sleep, defaultBackoffSeconds: 3 })

    await pace(1, undefined, { retry: true })

    expect(o.attese).toEqual([3_000])
  })
})

/**
 * Il caso in cui questo stesso modello sbagliava nella Fase 2A: 199 celle
 * mancanti su 248, non perché la chiamata fallisse ma perché la risposta era
 * valida e **corta**. Una banda letta a metà è peggio di una banda non letta,
 * perché somiglia a un foglio con le celle vuote: il buco deve essere
 * dichiarato, mai silenzioso.
 */
describe('extractRosterByBands, bande lette solo in parte', () => {
  it('dichiara un buco quando la banda restituisce meno celle di quelle chieste', async () => {
    const p = provider(
      'gemini',
      risposta([
        [1, 'RENATA', 'M'],
        [1, 'ALEX', 'P'],
        [2, 'RENATA', 'N'],
      ]),
    )
    const { pace } = pacerFinto()

    // 15 giorni x 2 colonne = 30 celle attese, ne arrivano 3
    const outcome = await extractRosterByBands({
      bands: [band(1, [1, 2], 1, 15)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].error).toContain('3')
    expect(outcome.failures[0].error).toContain('30')
    expect(outcome.failures[0].cells).toEqual({ read: 3, expected: 30 })
    // le celle lette non si buttano: il buco è nelle celle che mancano
    expect(outcome.extraction.cells).toHaveLength(3)
  })

  it('dichiara un buco anche quando la banda risponde con zero celle', async () => {
    const p = provider('gemini', risposta([]))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].cells).toEqual({ read: 0, expected: 16 })
    expect(outcome.extraction.cells).toEqual([])
  })

  it('non dichiara nessun buco quando la banda è completa', async () => {
    const p = provider(
      'gemini',
      risposta([
        [1, 'RENATA', 'M'],
        [1, 'ALEX', ''],
        [2, 'RENATA', ''],
        [2, 'ALEX', 'P'],
      ]),
    )
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1, 2], 1, 2)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(4)
  })

  /**
   * Una cella ripetuta e una cella fuori dall intervallo non riempiono il buco:
   * quello che conta è quante delle celle **chieste** sono arrivate, non quante
   * righe di JSON il modello ha scritto.
   */
  it('non lascia che duplicati e celle fuori intervallo riempiano il buco', async () => {
    const p = provider(
      'gemini',
      risposta([
        [1, 'RENATA', 'M'],
        [1, 'RENATA', 'M'],
        [9, 'RENATA', 'P'],
      ]),
    )
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 2)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].cells).toEqual({ read: 1, expected: 2 })
  })

  /**
   * Il falso allarme misurato su settembre: le bande con le colonne geometriche
   * `[9,10]` e `[11,12]` mostrano **due** colonne di servizio intitolate allo
   * stesso modo sul foglio (`AIUTO MATT.` due volte di fila). Il modello
   * risponde su tutti e trenta gli incroci, i nomi collassano su quindici e in
   * fusione non sopravvive niente, perché quelle colonne si scartano per nome.
   *
   * Dichiarare un buco qui è gridare al lupo: se il segnale suona quando non
   * manca niente, l infermiera impara a ignorarlo e la volta che un turno
   * sparisce davvero nessuno guarda.
   */
  it('non dichiara nessun buco per una banda di sole colonne di servizio', async () => {
    const celle: Array<[number, string, string]> = []
    for (let giorno = 1; giorno <= 15; giorno += 1) {
      celle.push([giorno, 'AIUTO MATT.', ''], [giorno, 'AIUTO MATT.', ''])
    }
    const p = provider('gemini', risposta(celle, ['AIUTO MATT.', 'AIUTO MATT.']))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [9, 10], 1, 15)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toEqual([])
  })

  /**
   * Lo stesso foglio, come è arrivato davvero dall interfaccia: l ultima banda
   * di agosto ha due colonne geometriche intitolate entrambe `AIUTO MATT.`, ma
   * il modello il nome lo scrive **una volta sola**. Sottrarre le occorrenze
   * nominate lasciava una colonna attesa che sul foglio non esiste, e la
   * tabella restava `partial` con «0 celle su 15 attese» a ogni caricamento.
   */
  it('non dichiara nessun buco quando le colonne di servizio omonime sono nominate una volta sola', async () => {
    const celle: Array<[number, string, string]> = []
    for (let giorno = 17; giorno <= 31; giorno += 1) celle.push([giorno, 'AIUTO MATT.', ''])
    const p = provider('gemini', risposta(celle, ['AIUTO MATT.']))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [9, 10], 17, 31)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toEqual([])
  })

  /**
   * Una banda mista, il caso che nascerà con un numero dispari di colonne di
   * persona: la colonna di servizio esce dalle attese, quella di persona no.
   */
  it('non dichiara nessun buco quando la banda ha letto tutte le colonne di persona', async () => {
    const celle: Array<[number, string, string]> = []
    for (let giorno = 1; giorno <= 15; giorno += 1) {
      celle.push([giorno, 'CARMEN', 'M'], [giorno, 'AIUTO POM.', ''])
    }
    const p = provider('gemini', risposta(celle, ['CARMEN', 'AIUTO POM.']))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [8, 9], 1, 15)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toEqual([])
    expect(outcome.extraction.cells).toHaveLength(15)
  })

  /**
   * Il difetto opposto, quello grave: una banda di sole colonne di persona che
   * ne salta una intera **deve** restare un buco dichiarato. È il modo in cui
   * questo modello sbagliava in Fase 2A, e contare solo le colonne che a valle
   * si scoprono utili lo renderebbe silenzioso.
   */
  it('dichiara il buco della colonna di persona che la banda non ha nominato', async () => {
    const celle: Array<[number, string, string]> = []
    for (let giorno = 1; giorno <= 15; giorno += 1) celle.push([giorno, 'CARMEN', 'M'])
    const p = provider('gemini', risposta(celle, ['CARMEN']))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [7, 8], 1, 15)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].cells).toEqual({ read: 15, expected: 30 })
    expect(outcome.extraction.cells).toHaveLength(15)
  })

  /** Una banda non letta per niente resta un buco senza conteggio di celle. */
  it('distingue la banda non letta da quella letta a metà', async () => {
    const p = provider('gemini', new VisionProviderError('chiave rifiutata', { status: 403 }))
    const { pace } = pacerFinto()

    const outcome = await extractRosterByBands({
      bands: [band(1, [1], 1, 16)],
      knownCodes: [],
      header: HEADER,
      provider: p,
      pace,
    })

    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0].cells).toBeUndefined()
  })
})
