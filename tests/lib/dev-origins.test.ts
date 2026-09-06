import { afterEach, describe, expect, it, vi } from 'vitest'
import { devOriginsFrom } from '@/lib/dev-origins'

/**
 * Il dev server di Next blocca come cross-origin i chunk JavaScript chiesti da un
 * host diverso da quello di avvio: dal telefono la pagina arriva, gli script no, e
 * niente si idrata. Gli origin ammessi si derivano da `APP_URL`, che per il
 * percorso dal telefono punta già all'IP di rete: una variabile sola, non due da
 * tenere allineate.
 */
describe('devOriginsFrom', () => {
  it('ammette l host di APP_URL, senza porta né schema', () => {
    expect(devOriginsFrom('http://192.168.1.28:3001')).toEqual(['192.168.1.28'])
  })

  it('con APP_URL assente non ammette nessun origin in più', () => {
    expect(devOriginsFrom(undefined)).toEqual([])
    expect(devOriginsFrom('')).toEqual([])
  })

  it('con un APP_URL malformato non ammette niente invece di lanciare', () => {
    expect(devOriginsFrom('non-un-url')).toEqual([])
  })
})

describe('next.config', () => {
  const originale = process.env.APP_URL

  afterEach(() => {
    if (originale === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originale
    vi.resetModules()
  })

  it('espone in allowedDevOrigins l host di APP_URL', async () => {
    process.env.APP_URL = 'http://192.168.1.28:3001'
    vi.resetModules()
    const { default: config } = await import('../../next.config')
    expect(config.allowedDevOrigins).toEqual(['192.168.1.28'])
  })
})
