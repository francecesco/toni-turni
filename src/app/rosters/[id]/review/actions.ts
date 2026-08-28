'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/modules/auth'
import { describeOutcome, syncRoster } from '@/modules/calendar'
import {
  ReviewForbiddenError,
  confirmColumn,
  confirmDays,
  requireOwnColumn,
  unconfirmDays,
} from '@/modules/review'

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
  params: { error?: string; ok?: string; sync?: string; reauth?: boolean },
): never {
  const query = new URLSearchParams({ colonna: columnLabel })
  if (params.error) query.set('error', params.error)
  if (params.ok) query.set('ok', params.ok)
  if (params.sync) query.set('sync', params.sync)
  if (params.reauth) query.set('reauth', '1')
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

/**
 * Dalla conferma al calendario. È un atto **separato** dalla conferma, e a posta: la
 * conferma dice «ho letto e va bene», il sync dice «scrivilo sul mio calendario», e
 * sono due decisioni che si prendono in due momenti. Non parte mai da sé.
 *
 * Chi può premerlo: **solo l intestataria della colonna**, referente compresa. La
 * barriera è `requireOwnColumn`, la stessa della conferma, e sta qui — lato server —
 * perché una server action è raggiungibile con un POST diretto, non solo dal bottone.
 * `syncRoster` ha poi il suo `authorizeSync`, e legge solo i turni con `confirmedAt`:
 * tre reti sulla stessa regola, nessuna delle quali basta da sola.
 */
export async function syncColumnAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')

  if (rosterId === '' || columnLabel === '') {
    tornaCon(rosterId, columnLabel, { error: 'Richiesta incompleta' })
  }

  let targetUserId: string
  try {
    targetUserId = await requireOwnColumn(user, columnLabel, 'sincronizzarne i turni')
  } catch (errore) {
    if (errore instanceof ReviewForbiddenError) {
      tornaCon(rosterId, columnLabel, { error: errore.message })
    }
    throw errore
  }

  const esito = await syncRoster({ actor: user, targetUserId, rosterId })
  revalidatePath(`/rosters/${rosterId}/review`)
  tornaCon(rosterId, columnLabel, {
    sync: describeOutcome(esito),
    reauth: esito.needsReauth === true,
  })
}
