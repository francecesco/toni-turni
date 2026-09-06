'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { clearCalendarId, requireUser } from '@/modules/auth'
import { describeOutcome, syncRoster } from '@/modules/calendar'
import {
  ReviewForbiddenError,
  ReviewRejectedError,
  confirmColumn,
  confirmDays,
  correctCell,
  removeAssignment,
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
  params: { error?: string; ok?: string; sync?: string; reauth?: boolean; calendarMissing?: boolean },
): never {
  const query = new URLSearchParams({ colonna: columnLabel })
  if (params.error) query.set('error', params.error)
  if (params.ok) query.set('ok', params.ok)
  if (params.sync) query.set('sync', params.sync)
  if (params.reauth) query.set('reauth', '1')
  if (params.calendarMissing) query.set('calendarMissing', '1')
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
 * «Togli dal calendario»: il foglio nuovo non ha più questo turno, ma l assegnazione
 * e l evento su Google ci sono ancora. Cancella l assegnazione; l evento lo toglie il
 * prossimo sync. Stessa barriera della conferma: solo chi possiede la colonna.
 */
export async function removeAssignmentAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')
  const day = Number(text(form, 'day'))

  if (rosterId === '' || columnLabel === '' || !Number.isInteger(day)) {
    tornaCon(rosterId, columnLabel, { error: 'Richiesta incompleta' })
  }

  try {
    await removeAssignment(user, { rosterId, columnLabel, day })
    revalidatePath(`/rosters/${rosterId}/review`)
    tornaCon(rosterId, columnLabel, {
      ok: `Giorno ${day} tolto: al prossimo invio l evento sparisce dal calendario.`,
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
    calendarMissing: esito.calendarMissing === true,
  })
}

/**
 * «Ricollega il calendario»: azzera l id del calendario dedicato salvato per la
 * persona, così il prossimo sync ne cerca uno per nome o ne crea uno nuovo. È
 * l **unico** modo in cui l app arriva a creare un secondo calendario, e per
 * questo è un gesto esplicito e non un ramo automatico del sync.
 *
 * Permessi come la conferma e il sync: solo chi possiede la colonna, referente
 * compresa — il calendario è della persona.
 */
export async function relinkCalendarAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')

  if (rosterId === '' || columnLabel === '') {
    tornaCon(rosterId, columnLabel, { error: 'Richiesta incompleta' })
  }

  let targetUserId: string
  try {
    targetUserId = await requireOwnColumn(user, columnLabel, 'ricollegarne il calendario')
  } catch (errore) {
    if (errore instanceof ReviewForbiddenError) {
      tornaCon(rosterId, columnLabel, { error: errore.message })
    }
    throw errore
  }

  await clearCalendarId(targetUserId)
  revalidatePath(`/rosters/${rosterId}/review`)
  tornaCon(rosterId, columnLabel, {
    ok: 'Calendario scollegato. Al prossimo invio l app cercherà «Turni Toniolo» fra i tuoi calendari e, se non c’è, lo creerà.',
  })
}

/**
 * La correzione a mano di una cella: il modello ha letto `M` dove il foglio dice `P`.
 *
 * Si sceglie fra i codici della legenda — il campo è un `<select>`, e `correctCell`
 * rifiuta comunque tutto il resto, perché una server action è raggiungibile con un POST
 * diretto. `code` vuoto significa «il foglio qui è vuoto», che è una risposta legittima
 * e diversa da «non lo so».
 *
 * Permessi: l infermiera la propria colonna, la referente qualsiasi colonna. La
 * barriera è dentro `correctCell` (`requireColumnAccess`), non qui: qui si traducono
 * solo i rifiuti in messaggi.
 */
export async function correctCellAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')
  const day = Number(text(form, 'day'))
  const code = text(form, 'code')

  if (rosterId === '' || columnLabel === '' || !Number.isInteger(day)) {
    tornaCon(rosterId, columnLabel, { error: 'Richiesta incompleta' })
  }

  let esito: Awaited<ReturnType<typeof correctCell>>
  try {
    esito = await correctCell(user, {
      rosterId,
      columnLabel,
      day,
      code: code === '' ? null : code,
    })
  } catch (errore) {
    if (errore instanceof ReviewForbiddenError || errore instanceof ReviewRejectedError) {
      tornaCon(rosterId, columnLabel, { error: errore.message })
    }
    throw errore
  }

  revalidatePath(`/rosters/${rosterId}/review`)

  const cosa =
    esito.code === null
      ? `Giorno ${day}: cella svuotata`
      : `Giorno ${day}: ora dice ${esito.code}`
  const coda = esito.assignmentRemoved
    ? ' — la conferma è stata rimossa: al prossimo sync l evento sparisce dal calendario'
    : esito.unconfirmed
      ? ' — la conferma di quel giorno è stata annullata: va riconfermato'
      : ''

  tornaCon(rosterId, columnLabel, { ok: `${cosa}${coda}` })
}
