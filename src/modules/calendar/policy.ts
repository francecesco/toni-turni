import type { Role } from '@/modules/auth'

export type SyncAuthorization = { allowed: true } | { allowed: false; reason: 'non_e_tua' }

/**
 * Ogni utente sincronizza la propria colonna; la referente può farlo anche per le
 * altre, ma questo non allarga di un millimetro cosa viene scritto: si scrivono solo
 * i turni che l intestataria ha confermato. Il controllo va chiamato qui, dove si
 * decide, non nella sola interfaccia.
 */
export function authorizeSync(
  actor: { id: string; role: Role },
  targetUserId: string,
): SyncAuthorization {
  if (actor.role === 'REFERENTE' && targetUserId !== '') return { allowed: true }
  if (actor.id !== '' && actor.id === targetUserId) return { allowed: true }
  return { allowed: false, reason: 'non_e_tua' }
}
