import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGroqProvider, GROQ_DEFAULT_MODEL } from '@/modules/extract/providers/groq'
import { VisionProviderError } from '@/modules/extract/providers/types'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0x42])

function risposta(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  process.env.GROQ_API_KEY = 'gsk-di-test'
})

afterEach(() => {
  delete process.env.GROQ_API_KEY
  delete process.env.GROQ_MODEL
})

describe('createGroqProvider', () => {
  it('restituisce il testo del modello', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{"year":2026}'))

    const result = await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'leggi' })

    expect(result.raw).toBe('{"year":2026}')
    expect(result.provider).toBe('groq')
    expect(result.model).toBe(GROQ_DEFAULT_MODEL)
  })

  it('manda l immagine come data URL base64 insieme al prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'leggi la tabella' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('api.groq.com')
    const body = JSON.parse(String((init as RequestInit).body))
    const content = body.messages[0].content
    expect(content[0]).toEqual({ type: 'text', text: 'leggi la tabella' })
    expect(content[1].image_url.url).toBe(`data:image/jpeg;base64,${IMAGE.toString('base64')}`)
  })

  it('chiede al provider la modalità JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))
    await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('manda la chiave nell header di autorizzazione e non nel corpo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))
    await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk-di-test')
    expect(String(init.body)).not.toContain('gsk-di-test')
  })

  it('rispetta GROQ_MODEL quando è impostato', async () => {
    process.env.GROQ_MODEL = 'qwen/qwen3.6-27b'
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    const result = await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })

    expect(result.model).toBe('qwen/qwen3.6-27b')
  })

  it('riporta i turni precedenti quando si chiede una riparazione', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGroqProvider(fetchMock).extract({
      image: IMAGE,
      prompt: 'ripara',
      previousTurns: [
        { role: 'assistant', text: 'output sbagliato' },
        { role: 'user', text: 'errore di validazione' },
      ],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.messages).toHaveLength(3)
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'output sbagliato' })
    expect(body.messages[2]).toEqual({ role: 'user', content: 'errore di validazione' })
  })

  it('solleva un VisionProviderError se la chiave manca', async () => {
    delete process.env.GROQ_API_KEY
    const fetchMock = vi.fn()

    await expect(
      createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('solleva un VisionProviderError su risposta HTTP di errore, riportando lo stato', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota esaurita', { status: 429 }))

    await expect(
      createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(/429/)
  })

  it('solleva un VisionProviderError se la risposta non contiene contenuto', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    )

    await expect(
      createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })

  it('non mette la chiave nel messaggio di errore', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('errore con gsk-di-test', { status: 500 }),
    )

    let errore: unknown
    try {
      await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    } catch (e) {
      errore = e
    }

    expect(errore).toBeInstanceOf(VisionProviderError)
    expect((errore as Error).message).toContain('500')
    // il corpo della risposta di Groq può contenere l eco della richiesta: non va nel messaggio
    expect((errore as Error).message).not.toContain('gsk-di-test')
  })
})
