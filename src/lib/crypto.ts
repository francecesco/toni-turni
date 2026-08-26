import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { requireEnv } from './env'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

function key(): Buffer {
  const raw = Buffer.from(requireEnv('APP_ENCRYPTION_KEY'), 'base64')
  if (raw.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY deve essere di 32 byte in base64 (openssl rand -base64 32)')
  }
  return raw
}

/** Formato: iv.ciphertext.authTag, tutti in base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 3) throw new Error('Payload cifrato malformato')

  const [iv, ciphertext, authTag] = parts.map((part) => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv(ALGORITHM, key(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
