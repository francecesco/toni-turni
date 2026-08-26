import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('encryptSecret / decryptSecret', () => {
  it('restituisce il testo originale', () => {
    const token = '1//refresh-token-di-google'
    expect(decryptSecret(encryptSecret(token))).toBe(token)
  })

  it('non lascia il testo in chiaro nel payload', () => {
    expect(encryptSecret('segretissimo')).not.toContain('segretissimo')
  })

  it('produce payload diversi per lo stesso testo (IV casuale)', () => {
    expect(encryptSecret('uguale')).not.toBe(encryptSecret('uguale'))
  })

  it('rifiuta un payload manomesso', () => {
    const payload = encryptSecret('integro')
    const parts = payload.split('.')
    const tampered = [parts[0], parts[1], Buffer.from('altro').toString('base64')].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('rifiuta un payload malformato', () => {
    expect(() => decryptSecret('non-un-payload')).toThrowError(/payload/i)
  })

  it('richiede la chiave di cifratura', () => {
    const saved = process.env.APP_ENCRYPTION_KEY
    delete process.env.APP_ENCRYPTION_KEY
    try {
      expect(() => encryptSecret('x')).toThrowError(/APP_ENCRYPTION_KEY/)
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved
    }
  })
})
