import { describe, expect, it } from 'vitest'
import { menuItemsFor } from '@/modules/auth/menu'

describe('menuItemsFor', () => {
  it('dà alla referente le tre voci, con gli href esatti', () => {
    expect(menuItemsFor({ role: 'REFERENTE' })).toEqual([
      { href: '/rosters/upload', label: 'Carica la tabella' },
      { href: '/settings/codes', label: 'Codici turno' },
      { href: '/settings/users', label: 'Utenti' },
    ])
  })

  it('non dà niente a un infermiera', () => {
    // È la regola invariante 7 resa verificabile: oggi è un `&&` dentro il JSX,
    // che nessuna prova può leggere. Nascondere una voce non autorizza niente —
    // i controlli veri restano nelle route e nelle server action.
    expect(menuItemsFor({ role: 'NURSE' })).toEqual([])
  })

  it('restituisce una copia, non l elenco condiviso', () => {
    // Chi chiama potrebbe ordinare o filtrare in posto: senza la copia
    // modificherebbe le voci di tutti gli altri.
    const primo = menuItemsFor({ role: 'REFERENTE' })
    primo.pop()
    expect(menuItemsFor({ role: 'REFERENTE' })).toHaveLength(3)
  })
})
