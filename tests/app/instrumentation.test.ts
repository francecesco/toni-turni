import { afterEach, describe, expect, it, vi } from 'vitest'
import { register } from '@/instrumentation'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('register (instrumentation)', () => {
  it('all avvio stampa un avviso quando l accesso di prova è attivo', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('DEV_LOGIN_EMAILS', 'anna@example.com')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await register()

    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('anna@example.com')
  })

  it('non dice niente quando il bypass è spento', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await register()

    expect(warn).not.toHaveBeenCalled()
  })
})
