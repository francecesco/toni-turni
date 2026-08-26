import { describe, expect, it } from 'vitest'
import { signSession, verifySession } from '@/modules/auth/token'

const SECRET = 'segreto-di-test-abbastanza-lungo-32+'

describe('signSession / verifySession', () => {
  it('restituisce l id utente firmato', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(token, SECRET)).toEqual({ userId: 'user-123' })
  })

  it('rifiuta un token firmato con un altro segreto', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(token, 'un-altro-segreto-abbastanza-lungo')).toBeNull()
  })

  it('rifiuta un token manomesso', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(`${token}x`, SECRET)).toBeNull()
  })

  it('rifiuta un token scaduto', async () => {
    const token = await signSession('user-123', SECRET, -60)
    expect(await verifySession(token, SECRET)).toBeNull()
  })

  it('rifiuta una stringa che non è un token', async () => {
    expect(await verifySession('qualsiasi-cosa', SECRET)).toBeNull()
  })
})
