'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/modules/auth'
import { ReviewForbiddenError, confirmColumn, confirmDays, unconfirmDays } from '@/modules/review'

/**
 * La conferma. È l unica cosa che autorizza una scrittura sul calendario, quindi
 * è **sempre** un atto esplicito di chi possiede la colonna, mai automatica e mai
 * di qualcun altro per lei. L autorizzazione la controlla `@/modules/review`,
 * lato server: qui si traducono solo i rifiuti in messaggi.
 */

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

function tornaCon(
  rosterId: string,
  columnLabel: string,
  params: { error?: string; ok?: string },
): never {
  const query = new URLSearchParams({ colonna: columnLabel })
  if (params.error) query.set('error', params.error)
  if (params.ok) query.set('ok', params.ok)
  redirect(`/rosters/${rosterId}/review?${query.toString()}`)
}

function messaggioDeiRifiuti(refused: Array<{ day: number; reason: string }>): string {
  if (refused.length === 0) return ''
  const primi = refused
    .slice(0, 3)
    .map((r) => `giorno ${r.day}: ${r.reason}`)
    .join('; ')
  const resto = refused.length > 3 ? ` (e altri ${refused.length - 3})` : ''
  return `${primi}${resto}`
}

export async function confirmDayAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')
  const day = Number(text(form, 'day'))

  if (rosterId === '' || columnLabel === '' || !Number.isInteger(day)) {
    tornaCon(rosterId, columnLabel, { error: 'Richiesta incompleta' })
  }

  try {
    const esito = await confirmDays(user, { rosterId, columnLabel, days: [day] })
    revalidatePath(`/rosters/${rosterId}/review`)
    if (esito.refused.length > 0) {
      tornaCon(rosterId, columnLabel, { error: messaggioDeiRifiuti(esito.refused) })
    }
  } catch (errore) {
    if (errore instanceof ReviewForbiddenError) {
      tornaCon(rosterId, columnLabel, { error: errore.message })
    }
    throw errore
  }
}

export async function unconfirmDayAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')
  const day = Number(text(form, 'day'))

  try {
    await unconfirmDays(user, { rosterId, columnLabel, days: [day] })
    revalidatePath(`/rosters/${rosterId}/review`)
  } catch (errore) {
    if (errore instanceof ReviewForbiddenError) {
      tornaCon(rosterId, columnLabel, { error: errore.message })
    }
    throw errore
  }
}

export async function confirmColumnAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')

  try {
    const esito = await confirmColumn(user, { rosterId, columnLabel })
    revalidatePath(`/rosters/${rosterId}/review`)
    tornaCon(rosterId, columnLabel, {
      ok: `${esito.confirmed} turni confermati`,
      error: esito.refused.length > 0 ? messaggioDeiRifiuti(esito.refused) : undefined,
    })
  } catch (errore) {
    if (errore instanceof ReviewForbiddenError) {
      tornaCon(rosterId, columnLabel, { error: errore.message })
    }
    throw errore
  }
}
