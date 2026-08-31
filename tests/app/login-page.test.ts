import { createElement, isValidElement, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LoginPage from '@/app/login/page'

afterEach(() => vi.unstubAllEnvs())

/** Testo di tutti i nodi dell albero JSX, senza bisogno di un DOM. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')

  const element = node as ReactElement<Record<string, unknown>>
  const props = element.props ?? {}
  const attributes = Object.entries(props)
    .filter(([key]) => key !== 'children')
    // Un elemento React dentro un prop che non è `children` (es. `render={<a/>}`)
    // porta anche lui del testo: senza scenderci, una prova d'assenza può passare
    // a vuoto pur avendo quel testo davanti.
    .map(([, value]) => (typeof value === 'string' ? value : isValidElement(value) ? textOf(value) : ''))
    .join(' ')
  return `${attributes} ${textOf(props.children)}`
}

async function render() {
  return textOf(await LoginPage({ searchParams: Promise.resolve({}) }))
}

describe('pagina di accesso', () => {
  it('mostra sempre il pulsante di Google', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(await render()).toContain('/api/auth/google/start')
  })

  it('senza la variabile non mostra nessun accesso di prova', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    // La precondizione va stabilita, non sperata: su una macchina di sviluppo
    // `.env` imposta davvero DEV_LOGIN_EMAILS, e senza questa riga la prova
    // misura la macchina invece del codice.
    vi.stubEnv('DEV_LOGIN_EMAILS', undefined)
    const text = await render()
    expect(text).not.toContain('/api/auth/dev-login')
    expect(text).not.toContain('prova')
  })

  it('con la variabile mostra un pulsante per ogni email nominata', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com,carla@example.com')

    const text = await render()

    expect(text).toContain('/api/auth/dev-login')
    expect(text).toContain('anna@example.com')
    expect(text).toContain('carla@example.com')
    expect(text).toContain('solo in sviluppo')
  })

  it('in produzione non mostra nulla anche con la variabile impostata', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com')

    expect(await render()).not.toContain('/api/auth/dev-login')
  })
})

describe('textOf non perde testo dentro un prop `render`', () => {
  // Il caso che il revisore ha segnalato: un domani `Button render={<a href="…"/>}>`
  // porta il link dentro un prop che non è `children`. Se `textOf` lo ignora, una
  // prova d'assenza («in produzione non mostra nulla») può passare a vuoto pur
  // avendo quel link davanti agli occhi — perché non lo vede, non perché non c è.
  it('trova il testo di un elemento React annidato in un prop diverso da `children`', () => {
    // `isValidElement` guarda il marcatore interno di React (`$$typeof`): un
    // oggetto letterale che imita la forma di un elemento non basta, serve un
    // elemento vero, creato con `createElement` (il file è `.ts`, non `.tsx`).
    const nodo = createElement('div', {
      render: createElement('a', { href: '/api/auth/dev-login' }, 'link-nascosto-in-render'),
    })
    expect(textOf(nodo)).toContain('link-nascosto-in-render')
  })
})
