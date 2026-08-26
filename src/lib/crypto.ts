import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { requireEnv } from './env'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

function key(): Buffer {
  const raw = Buffer.from(requireEnv('APP_ENCRYPTION_KEY'), 'base64')
  if (raw.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY deve essere di 32 byte in base64 (openssl rand -base64 32)')
  }
  return raw
}

/**
 * Formato: iv.ciphertext.authTag, tutti in base64.
 * `context` viene autenticato ma non cifrato (AAD): lega il payload al record che lo
 * contiene, così un blob spostato su un altro utente non si decifra.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(payload: string, context: string): string {
  const parts = payload.split('.')
  if (parts.length !== 3) throw new Error('Payload cifrato malformato')

  const [iv, ciphertext, authTag] = parts.map((part) => Buffer.from(part, 'base64'))

  // GCM accetta tag più corti di 16 byte: senza questi controlli un tag troncato
  // ridurrebbe l'autenticazione a pochi byte di forza.
  if (iv.length !== IV_BYTES) {
    throw new Error('Payload cifrato malformato: IV di lunghezza errata')
  }
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Payload cifrato malformato: tag di autenticazione di lunghezza errata')
  }

  const decipher = createDecipheriv(ALGORITHM, key(), iv)
  decipher.setAAD(Buffer.from(context, 'utf8'))
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
