import { describe, expect, it } from 'vitest'
import {
  DEV_LOGIN_ENV,
  devLoginAllows,
  devLoginEmails,
  devLoginStartupWarning,
  isDevLoginEnabled,
} from '@/modules/auth/devLogin'

const dev = (value?: string) => ({
  NODE_ENV: 'development',
  ...(value === undefined ? {} : { [DEV_LOGIN_ENV]: value }),
})

describe('devLoginEmails', () => {
  it('senza la variabile non ammette nessuno: l assenza è il default', () => {
    expect(devLoginEmails(dev())).toEqual([])
    expect(isDevLoginEnabled(dev())).toBe(false)
  })

  it('una variabile vuota o di soli spazi non ammette nessuno', () => {
    expect(devLoginEmails(dev(''))).toEqual([])
    expect(devLoginEmails(dev('  ,  '))).toEqual([])
  })

  it('legge un elenco separato da virgole, normalizzato e senza duplicati', () => {
    expect(devLoginEmails(dev(' Anna@Example.com , carla@example.com, ANNA@example.com '))).toEqual([
      'anna@example.com',
      'carla@example.com',
    ])
  })

  it('in produzione l elenco è vuoto qualunque cosa dica la variabile', () => {
    const prod = { NODE_ENV: 'production', [DEV_LOGIN_ENV]: 'anna@example.com' }
    expect(devLoginEmails(prod)).toEqual([])
    expect(isDevLoginEnabled(prod)).toBe(false)
    expect(devLoginAllows('anna@example.com', prod)).toBe(false)
  })
})

describe('devLoginAllows', () => {
  it('ammette solo le email nominate nell elenco', () => {
    const env = dev('anna@example.com')
    expect(devLoginAllows('anna@example.com', env)).toBe(true)
    expect(devLoginAllows('ANNA@Example.com ', env)).toBe(true)
    expect(devLoginAllows('carla@example.com', env)).toBe(false)
    expect(devLoginAllows('', env)).toBe(false)
  })
})

describe('devLoginStartupWarning', () => {
  it('tace quando il bypass è spento', () => {
    expect(devLoginStartupWarning(dev())).toBeNull()
    expect(devLoginStartupWarning({ NODE_ENV: 'production' })).toBeNull()
  })

  it('quando è attivo nomina le email raggiungibili', () => {
    const warning = devLoginStartupWarning(dev('anna@example.com,carla@example.com'))
    expect(warning).toContain('ATTENZIONE')
    expect(warning).toContain('anna@example.com')
    expect(warning).toContain('carla@example.com')
  })

  it('in produzione avvisa che la variabile è ignorata invece di tacere', () => {
    const warning = devLoginStartupWarning({
      NODE_ENV: 'production',
      [DEV_LOGIN_ENV]: 'anna@example.com',
    })
    expect(warning).toContain('IGNORATO')
    expect(warning).toContain('404')
  })
})
