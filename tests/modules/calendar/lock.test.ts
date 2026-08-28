import { describe, expect, it } from 'vitest'
import { withSyncLock } from '@/modules/calendar/lock'

describe('withSyncLock', () => {
  it('serializza le operazioni invece di intrecciarle', async () => {
    // SQLite non gestisce scritture concorrenti, e due sync sovrapposti
    // scriverebbero due volte lo stesso evento.
    const traccia: string[] = []

    const lento = withSyncLock(async () => {
      traccia.push('a-inizio')
      await new Promise((resolve) => setTimeout(resolve, 20))
      traccia.push('a-fine')
    })

    const veloce = withSyncLock(async () => {
      traccia.push('b-inizio')
      traccia.push('b-fine')
    })

    await Promise.all([lento, veloce])

    expect(traccia).toEqual(['a-inizio', 'a-fine', 'b-inizio', 'b-fine'])
  })

  it('restituisce il valore della funzione', async () => {
    await expect(withSyncLock(async () => 42)).resolves.toBe(42)
  })

  it('un errore non blocca la coda per sempre', async () => {
    await expect(
      withSyncLock(async () => {
        throw new Error('guasto')
      }),
    ).rejects.toThrow('guasto')

    await expect(withSyncLock(async () => 'dopo')).resolves.toBe('dopo')
  })

  it('la coda è unica: anche i sync di utenti diversi si mettono in fila', async () => {
    // Le scritture su SQLite sono una risorsa sola, non una per utente.
    const traccia: string[] = []

    const uno = withSyncLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      traccia.push('uno')
    })

    const due = withSyncLock(async () => {
      traccia.push('due')
    })

    await Promise.all([uno, due])

    expect(traccia).toEqual(['uno', 'due'])
  })
})
