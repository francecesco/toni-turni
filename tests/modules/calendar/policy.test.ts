import { describe, expect, it } from 'vitest'
import { authorizeSync } from '@/modules/calendar/policy'

const infermiera = { id: 'utente1', role: 'NURSE' as const }
const referente = { id: 'utente9', role: 'REFERENTE' as const }

describe('authorizeSync', () => {
  it('permette a un utente di sincronizzare la propria colonna', () => {
    expect(authorizeSync(infermiera, 'utente1')).toEqual({ allowed: true })
  })

  it('nega a un utente la colonna di un altra', () => {
    expect(authorizeSync(infermiera, 'utente2')).toEqual({ allowed: false, reason: 'non_e_tua' })
  })

  it('permette alla referente di sincronizzare la colonna di un altra', () => {
    // Resta comunque vero che si scrivono solo i turni che quell utente ha confermato.
    expect(authorizeSync(referente, 'utente1')).toEqual({ allowed: true })
  })

  it('nega con un utente senza id, invece di lasciar passare', () => {
    expect(authorizeSync({ id: '', role: 'NURSE' }, '')).toEqual({
      allowed: false,
      reason: 'non_e_tua',
    })
  })
})
