import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('encryptSecret / decryptSecret', () => {
  const CONTEXT = 'google_refresh:user-123'

  it('restituisce il testo originale', () => {
    const token = '1//refresh-token-di-google'
    expect(decryptSecret(encryptSecret(token, CONTEXT), CONTEXT)).toBe(token)
  })

  it('non lascia il testo in chiaro nel payload', () => {
    expect(encryptSecret('segretissimo', CONTEXT)).not.toContain('segretissimo')
  })

  it('produce payload diversi per lo stesso testo (IV casuale)', () => {
    expect(encryptSecret('uguale', CONTEXT)).not.toBe(encryptSecret('uguale', CONTEXT))
  })

  it('rifiuta un payload manomesso', () => {
    const payload = encryptSecret('integro', CONTEXT)
    const parts = payload.split('.')
    const tampered = [parts[0], parts[1], randomBytes(16).toString('base64')].join('.')
    expect(() => decryptSecret(tampered, CONTEXT)).toThrow()
  })

  it('rifiuta un payload malformato', () => {
    expect(() => decryptSecret('non-un-payload', CONTEXT)).toThrowError(/payload/i)
  })

  it('richiede la chiave di cifratura', () => {
    const saved = process.env.APP_ENCRYPTION_KEY
    delete process.env.APP_ENCRYPTION_KEY
    try {
      expect(() => encryptSecret('x', CONTEXT)).toThrowError(/APP_ENCRYPTION_KEY/)
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved
    }
  })

  it('rifiuta un tag troncato', () => {
    const payload = encryptSecret('integro', CONTEXT)
    const parts = payload.split('.')
    const tampered = [parts[0], parts[1], randomBytes(4).toString('base64')].join('.')
    expect(() => decryptSecret(tampered, CONTEXT)).toThrowError(/tag di autenticazione/)
  })

  it('rifiuta un IV di lunghezza errata', () => {
    const payload = encryptSecret('integro', CONTEXT)
    const parts = payload.split('.')
    const tampered = [randomBytes(8).toString('base64'), parts[1], parts[2]].join('.')
    expect(() => decryptSecret(tampered, CONTEXT)).toThrowError(/IV/)
  })

  it('rifiuta un ciphertext manomesso', () => {
    const payload = encryptSecret('integro', CONTEXT)
    const parts = payload.split('.')
    const tampered = [parts[0], randomBytes(16).toString('base64'), parts[2]].join('.')
    expect(() => decryptSecret(tampered, CONTEXT)).toThrow()
  })

  it('rifiuta un contesto diverso', () => {
    const payload = encryptSecret('integro', 'google_refresh:user-123')
    expect(() => decryptSecret(payload, 'google_refresh:user-999')).toThrow()
  })

  it('rifiuta una chiave di lunghezza sbagliata', () => {
    const saved = process.env.APP_ENCRYPTION_KEY
    process.env.APP_ENCRYPTION_KEY = randomBytes(16).toString('base64')
    try {
      expect(() => encryptSecret('x', CONTEXT)).toThrowError(/APP_ENCRYPTION_KEY/)
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved
    }
  })
})
