import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGeminiProvider, GEMINI_DEFAULT_MODEL } from '@/modules/extract/providers/gemini'
import { VisionProviderError, VisionTruncatedError } from '@/modules/extract/providers/types'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0x42])

function risposta(text: string, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      ...extra,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function corpo(fetchMock: ReturnType<typeof vi.fn>, chiamata = 0) {
  return JSON.parse(String((fetchMock.mock.calls[chiamata][1] as RequestInit).body))
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'AIza-di-test'
})

afterEach(() => {
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.GEMINI_MAX_OUTPUT_TOKENS
})

describe('createGeminiProvider', () => {
  it('restituisce il testo del modello', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{"year":2026}'))

    const result = await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'leggi' })

    expect(result.raw).toBe('{"year":2026}')
    expect(result.provider).toBe('gemini')
    expect(result.model).toBe(GEMINI_DEFAULT_MODEL)
  })

  it('unisce i pezzi di testo di una risposta divisa in più parti', async () => {
    // Gemini spezza le risposte lunghe in più `parts`: prendere solo la prima
    // troncherebbe silenziosamente la tabella, che è esattamente il guasto che la
    // strategia a una chiamata sola non può permettersi.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"cells":' }, { text: '[]}' }] }, finishReason: 'STOP' },
          ],
        }),
        { status: 200 },
      ),
    )

    const result = await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })

    expect(result.raw).toBe('{"cells":[]}')
  })

  it('manda l immagine come inline_data base64 insieme al prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'leggi la tabella' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('generativelanguage.googleapis.com')
    expect(String(url)).toContain(`${GEMINI_DEFAULT_MODEL}:generateContent`)
    expect((init as RequestInit).method).toBe('POST')

    const body = corpo(fetchMock)
    expect(body.contents[0].role).toBe('user')
    expect(body.contents[0].parts[0]).toEqual({ text: 'leggi la tabella' })
    expect(body.contents[0].parts[1].inline_data).toEqual({
      mime_type: 'image/jpeg',
      data: IMAGE.toString('base64'),
    })
  })

  it('chiede JSON e temperatura zero', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })

    const body = corpo(fetchMock)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.temperature).toBe(0)
  })

  it('manda la chiave in un header, non nell URL né nel corpo', async () => {
    // La chiave nella query string finisce nei log di ogni proxy che attraversa.
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).not.toContain('AIza-di-test')
    expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
      'x-goog-api-key': 'AIza-di-test',
    })
    expect(String((init as RequestInit).body)).not.toContain('AIza-di-test')
  })

  it('rispetta GEMINI_MODEL quando è impostato', async () => {
    process.env.GEMINI_MODEL = 'gemini-di-domani'
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    const result = await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })

    expect(result.model).toBe('gemini-di-domani')
    expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-di-domani:generateContent')
  })

  it('riporta i turni precedenti col ruolo "model", che è quello di Gemini', async () => {
    // Gemini non conosce il ruolo "assistant": una conversazione con quel ruolo
    // viene rifiutata, e il giro di riparazione non partirebbe mai.
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGeminiProvider(fetchMock).extract({
      image: IMAGE,
      prompt: 'ripara',
      previousTurns: [
        { role: 'assistant', text: 'output sbagliato' },
        { role: 'user', text: 'errore di validazione' },
      ],
    })

    const body = corpo(fetchMock)
    expect(body.contents).toHaveLength(3)
    expect(body.contents[1]).toEqual({ role: 'model', parts: [{ text: 'output sbagliato' }] })
    expect(body.contents[2]).toEqual({ role: 'user', parts: [{ text: 'errore di validazione' }] })
  })

  it('solleva un VisionProviderError se la chiave manca', async () => {
    delete process.env.GEMINI_API_KEY
    const fetchMock = vi.fn()

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('solleva un VisionProviderError su risposta HTTP di errore, riportando lo stato', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota esaurita', { status: 429 }))

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(/429/)
  })

  it('porta status e retryAfterSeconds su un 429 con header retry-after', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('troppe richieste', { status: 429, headers: { 'retry-after': '30' } }),
    )

    let caught: unknown
    try {
      await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(VisionProviderError)
    expect((caught as VisionProviderError).status).toBe(429)
    expect((caught as VisionProviderError).retryAfterSeconds).toBe(30)
  })

  it('riporta lo stato strutturato dell errore, che dice cosa fare', async () => {
    // "ha risposto con stato 429" non dice a nessuno se la quota e finita, se il
    // piano non copre quel modello o se e un picco momentaneo. Lo stato di Google
    // lo dice, ed e la differenza fra un messaggio e una diagnosi: senza questo
    // ci sono volute tre prove a mano per capire che i modelli Pro hanno quota
    // zero senza fatturazione attiva.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'You exceeded your current quota, please check your plan and billing details.',
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    )

    let caught: unknown
    try {
      await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    } catch (e) {
      caught = e
    }

    expect((caught as Error).message).toContain('429')
    expect((caught as Error).message).toContain('RESOURCE_EXHAUSTED')
    expect((caught as Error).message).toContain('billing')
  })

  it('riporta il modello inesistente, che e un errore di configurazione', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 404,
            status: 'NOT_FOUND',
            message: 'This model models/gemini-vecchio is no longer available to new users.',
          },
        }),
        { status: 404 },
      ),
    )

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(/NOT_FOUND[\s\S]*no longer available/)
  })

  it('accorcia un messaggio d errore lunghissimo invece di riversarlo', async () => {
    // Il messaggio d errore di un 400 puo citare il valore del campo rifiutato, e
    // il campo piu grosso della richiesta e l immagine in base64: un corpo
    // riversato per intero finirebbe nei log con dentro la foto dei turni.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 400, status: 'INVALID_ARGUMENT', message: 'A'.repeat(5000) },
        }),
        { status: 400 },
      ),
    )

    let caught: unknown
    try {
      await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    } catch (e) {
      caught = e
    }

    expect((caught as Error).message).toContain('INVALID_ARGUMENT')
    expect((caught as Error).message.length).toBeLessThan(600)
  })

  it('regge un corpo d errore che non e il JSON di Google', async () => {
    // Un proxy che intercetta risponde HTML: il messaggio deve restare quello
    // dello stato, non diventare un SyntaxError.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    )

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(/502/)
  })

  it('non mette la chiave nel messaggio di errore', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('errore con AIza-di-test', { status: 500 }),
    )

    let caught: unknown
    try {
      await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    } catch (e) {
      caught = e
    }

    expect((caught as Error).message).toContain('500')
    expect((caught as Error).message).not.toContain('AIza-di-test')
  })

  it('solleva VisionTruncatedError quando finishReason è MAX_TOKENS, non un errore di formato', async () => {
    // Rimandare la stessa immagine con un prompt di riparazione tronca di nuovo:
    // il chiamante deve poter distinguere questo caso da un JSON malformato.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"cells":[' }] }, finishReason: 'MAX_TOKENS' },
          ],
          usageMetadata: { candidatesTokenCount: 32768 },
        }),
        { status: 200 },
      ),
    )

    let caught: unknown
    try {
      await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(VisionTruncatedError)
    expect((caught as Error).message).toMatch(/tronc/i)
    expect((caught as Error).message).toContain('32768')
  })

  it('solleva un VisionProviderError quando la risposta è bloccata dai filtri', async () => {
    // Una foto di una tabella non dovrebbe farlo scattare, ma se scatta il
    // messaggio deve dire perché: senza questo si vedrebbe solo "nessun contenuto".
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
        { status: 200 },
      ),
    )

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(/SAFETY/)
  })

  it('solleva un VisionProviderError se la risposta non contiene contenuto', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    )

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })

  it('solleva un VisionProviderError se il corpo non è JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('<html>proxy</html>', { status: 200 }),
    )

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })

  it('mette un limite di tempo alla richiesta, con un margine sul tempo misurato', async () => {
    // Misurato: la lettura di agosto e rimasta appesa **301 secondi** e poi e
    // caduta sul `headersTimeout` di Node (300 s) con un errore che non dice
    // niente. Un limite nostro fallisce prima e con un nome. Il margine e sul
    // dato: la lettura piu lenta riuscita ha preso 141 s.
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('un limite di tempo scaduto e un guasto transitorio, non un errore di formato', async () => {
    // Senza stato HTTP: e cosi che `extractRosterByBands` lo riconosce come
    // ritentabile invece di perdere tutta la tabella.
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
    )

    let caught: unknown
    try {
      await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(VisionProviderError)
    expect((caught as VisionProviderError).status).toBeUndefined()
    expect((caught as Error).message).toMatch(/tempo|attes/i)
  })

  it('traduce un errore di rete del fetch in VisionProviderError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

    await expect(
      createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })

  it('chiede un tetto di token in uscita capiente per una tabella intera, configurabile', async () => {
    // ~250 celle di JSON più i token di ragionamento: un tetto stretto tronca la
    // tabella a metà. Gemini non conta i token prenotati, quindi chiederne molti
    // non costa nulla se non si usano.
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))
    await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    expect(corpo(fetchMock).generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(16000)

    process.env.GEMINI_MAX_OUTPUT_TOKENS = '20000'
    const altro = vi.fn().mockResolvedValue(risposta('{}'))
    await createGeminiProvider(altro).extract({ image: IMAGE, prompt: 'x' })
    expect(corpo(altro).generationConfig.maxOutputTokens).toBe(20000)
  })

  it('ripiega sul default se GEMINI_MAX_OUTPUT_TOKENS non è un numero valido', async () => {
    // Number('') è 0, non NaN: senza controllo espliciti ogni risposta uscirebbe
    // troncata in silenzio.
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))
    await createGeminiProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    const default_ = corpo(fetchMock).generationConfig.maxOutputTokens

    for (const valore of ['abc', '0', '-5']) {
      process.env.GEMINI_MAX_OUTPUT_TOKENS = valore
      const altro = vi.fn().mockResolvedValue(risposta('{}'))
      await createGeminiProvider(altro).extract({ image: IMAGE, prompt: 'x' })
      expect(corpo(altro).generationConfig.maxOutputTokens).toBe(default_)
    }
  })
})
