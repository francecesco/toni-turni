import { prisma } from '@/lib/db'
import type { AssignmentRecord } from './types'
import { isoDateFor } from './window'

/**
 * I turni di **una sola** utente per una sola tabella. Il filtro su `userId` è qui,
 * dove si leggono i dati, non solo nell interfaccia: è la regola per cui ognuna vede
 * e scrive soltanto la propria colonna.
 */
export async function listAssignmentsForSync(input: {
  userId: string
  rosterId: string
  year: number
  month: number
}): Promise<AssignmentRecord[]> {
  const rows = await prisma.assignment.findMany({
    where: { userId: input.userId, rosterId: input.rosterId },
    orderBy: { day: 'asc' },
    select: { id: true, day: true, code: true, confirmedAt: true, eventId: true },
  })

  return rows.map((row) => ({
    id: row.id,
    date: isoDateFor(input.year, input.month, row.day),
    code: row.code,
    // Nessuna conferma, nessuna scrittura: `confirmedAt` è il consenso esplicito.
    confirmed: row.confirmedAt !== null,
    eventId: row.eventId,
  }))
}

/**
 * Le registrazioni dell esito tollerano l assegnazione scomparsa: fra il piano e la
 * scrittura l utente può aver caricato una nuova versione della tabella, e un sync
 * riuscito non deve trasformarsi in un errore per questo.
 */
export async function recordSynced(assignmentId: string, eventId: string): Promise<void> {
  await prisma.assignment.updateMany({
    where: { id: assignmentId },
    data: { eventId, syncState: 'synced', syncError: null, syncedAt: new Date() },
  })
}

export async function recordFailure(assignmentId: string, message: string): Promise<void> {
  await prisma.assignment.updateMany({
    where: { id: assignmentId },
    // L eventId resta: se l evento esiste, il prossimo sync deve poterlo aggiornare.
    data: { syncState: 'failed', syncError: message.slice(0, 500) },
  })
}
