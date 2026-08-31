import type { Role } from './policy'

export interface MenuItem {
  href: string
  label: string
}

const VOCI_REFERENTE: readonly MenuItem[] = [
  { href: '/rosters/upload', label: 'Carica la tabella' },
  { href: '/settings/codes', label: 'Codici turno' },
  { href: '/settings/users', label: 'Utenti' },
]

/**
 * Le voci del menu ⋯. Vuoto per chi non è referente, e allora il bottone non si
 * disegna affatto.
 *
 * È la regola invariante 7 («solo REFERENTE carica tabelle e modifica la
 * legenda») resa verificabile. **Non sostituisce** i controlli lato server:
 * nascondere una voce non è autorizzare.
 */
export function menuItemsFor(user: { role: Role }): MenuItem[] {
  return user.role === 'REFERENTE' ? [...VOCI_REFERENTE] : []
}
