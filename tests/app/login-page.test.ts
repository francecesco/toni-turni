import type { ReactElement } from 'react'
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
    .map(([, value]) => (typeof value === 'string' ? value : ''))
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
