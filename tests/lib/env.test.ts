import { afterEach, describe, expect, it } from 'vitest'
import { optionalEnv, requireEnv } from '@/lib/env'

const KEY = 'TURNI_TEST_VALUE'

afterEach(() => {
  delete process.env[KEY]
})

describe('requireEnv', () => {
  it('restituisce il valore quando la variabile è presente', () => {
    process.env[KEY] = 'ciao'
    expect(requireEnv(KEY)).toBe('ciao')
  })

  it('solleva un errore che nomina la variabile mancante', () => {
    expect(() => requireEnv(KEY)).toThrowError(/TURNI_TEST_VALUE/)
  })

  it('tratta la stringa vuota come mancante', () => {
    process.env[KEY] = '   '
    expect(() => requireEnv(KEY)).toThrowError(/TURNI_TEST_VALUE/)
  })
})

describe('optionalEnv', () => {
  it('usa il fallback quando la variabile manca', () => {
    expect(optionalEnv(KEY, '90')).toBe('90')
  })

  it('preferisce il valore presente al fallback', () => {
    process.env[KEY] = '30'
    expect(optionalEnv(KEY, '90')).toBe('30')
  })
})
