'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireReferente } from '@/modules/auth'
import { assignColumnToUser, clearColumnLabel, ignoreColumnLabel } from '@/modules/review'

/**
 * L associazione colonna → persona la fa la referente, e solo lei (regola
 * invariante 7). Il controllo è qui, nella server action, non nell interfaccia.
 */

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

function fallisci(rosterId: string, message: string): never {
  redirect(`/rosters/${rosterId}/columns?error=${encodeURIComponent(message)}`)
}

export async function saveColumnAlias(form: FormData): Promise<void> {
  await requireReferente()

  const rosterId = text(form, 'rosterId')
  const label = text(form, 'label')
  const userId = text(form, 'userId')
  if (rosterId === '' || label === '') return

  if (userId === '') {
    // "Nessuno" non significa "ignorata": la colonna torna semplicemente da
    // assegnare, e non blocca niente.
    await clearColumnLabel(label)
  } else if (userId === 'ignora') {
    await ignoreColumnLabel(label)
  } else {
    const { prisma } = await import('@/lib/db')
    const utente = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!utente) fallisci(rosterId, 'Utente non trovato')
    await assignColumnToUser(label, userId)
  }

  revalidatePath(`/rosters/${rosterId}/columns`)
}
