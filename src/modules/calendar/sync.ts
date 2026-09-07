import {
  GoogleAccountMissingError,
  GoogleReauthRequiredError,
  googleClientForUser,
  markNeedsReauth,
  readGoogleAccountState,
  setCalendarId,
  type Role,
} from '@/modules/auth'
import { listShiftCodes } from '@/modules/codes'
import { getRosterMonth } from '@/modules/roster'
import { createCalendarApi, isReauthNeeded, type CalendarApi } from './api'
import { DedicatedCalendarMissingError, resolveDedicatedCalendar } from './dedicated'
import { buildDesiredEvents } from './event'
import { planSync } from './diff'
import { withSyncLock } from './lock'
import { authorizeSync } from './policy'
import { listAssignmentsForSync, recordFailure, recordSynced } from './repository'
import { belongsTo } from './shiftKey'
import { monthWindow } from './window'
import type { AssignmentRecord, SyncFailure, SyncOutcome, SyncPlan } from './types'

export interface SyncActor {
  id: string
  role: Role
}

export interface SyncRosterInput {
  actor: SyncActor
  targetUserId: string
  rosterId: string
  /** Iniettabile nei test: in produzione è il client OAuth dell utente. */
  apiFactory?: (userId: string) => Promise<CalendarApi>
}

function failed(error: string, calendarId = '', needsReauth = false): SyncOutcome {
  return {
    ok: false,
    calendarId,
    ...(needsReauth ? { needsReauth: true } : {}),
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skipped: [],
    failures: [],
    foreignEvents: 0,
    outOfWindowEvents: 0,
    protectedEvents: 0,
    error,
  }
}

async function defaultApiFactory(userId: string): Promise<CalendarApi> {
  const client = await googleClientForUser(userId)
  // OAuth2Client.request soddisfa CalendarTransport così com è: rinnova da sé
  // l access token dal refresh token e riprova la richiesta.
  return createCalendarApi(client)
}

/**
 * Applica il piano un passo alla volta. Sequenziale per scelta: le chiamate a Google
 * e le scritture su SQLite di un singolo sync non vanno parallelizzate, e un ordine
 * prevedibile è ciò che rende leggibile un guasto a metà.
 */
async function applyPlan(input: {
  api: CalendarApi
  calendarId: string
  userId: string
  plan: SyncPlan
  storedEventIds: Map<string, string | null>
}): Promise<{
  created: number
  updated: number
  deleted: number
  unchanged: number
  failures: SyncFailure[]
  needsReauth: boolean
}> {
  let created = 0
  let updated = 0
  let deleted = 0
  let unchanged = 0
  let needsReauth = false
  const failures: SyncFailure[] = []

  for (const step of input.plan.steps) {
    try {
      if (step.action === 'create') {
        const evento = await input.api.insertEvent({
          calendarId: input.calendarId,
          payload: step.payload,
        })
        await recordSynced(step.assignmentId, evento.id)
        created += 1
      } else if (step.action === 'update') {
        await input.api.patchEvent({
          calendarId: input.calendarId,
          eventId: step.eventId,
          payload: step.payload,
        })
        await recordSynced(step.assignmentId, step.eventId)
        updated += 1
      } else if (step.action === 'keep') {
        unchanged += 1
        // Nessuna chiamata a Google: si allinea solo l anagrafica locale, e solo
        // se non era già allineata.
        if (input.storedEventIds.get(step.assignmentId) !== step.eventId) {
          await recordSynced(step.assignmentId, step.eventId)
        }
      } else {
        // Doppia verifica prima di un azione irreversibile: la chiave deve essere
        // di questo utente, e l api rilegge l evento prima di cancellarlo.
        if (!belongsTo(step.shiftKey, input.userId)) {
          throw new Error(`shiftKey non riconosciuta: ${step.shiftKey}`)
        }
        await input.api.deleteEvent({
          calendarId: input.calendarId,
          eventId: step.eventId,
          expectedUserId: input.userId,
        })
        deleted += 1
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ shiftKey: step.shiftKey, action: step.action, message })

      if (step.action === 'create' || step.action === 'update' || step.action === 'keep') {
        await recordFailure(step.assignmentId, message)
      }

      // Consenso revocato: continuare significherebbe collezionare lo stesso
      // errore su ogni turno rimasto.
      if (isReauthNeeded(error)) {
        await markNeedsReauth(input.userId)
        needsReauth = true
        break
      }
    }
  }

  return { created, updated, deleted, unchanged, failures, needsReauth }
}

/**
 * Sincronizza sul calendario dedicato i turni **confermati** di una tabella, per una
 * sola utente. Le regole che il flusso fa rispettare, nell ordine in cui si applicano:
 *
 * 1. si sincronizza solo la propria colonna (la referente anche le altre);
 * 2. senza `confirmedAt` non si scrive nulla;
 * 3. si scrive solo sul calendario dedicato dell app, mai sul principale;
 * 4. si toccano solo gli eventi con la nostra `shiftKey`, dentro il mese in questione.
 */
export async function syncRoster(input: SyncRosterInput): Promise<SyncOutcome> {
  const authorization = authorizeSync(input.actor, input.targetUserId)
  if (!authorization.allowed) {
    return failed('Puoi sincronizzare soltanto la tua colonna')
  }

  return withSyncLock(async () => {
    const roster = await getRosterMonth(input.rosterId)
    if (!roster) return failed('Tabella turni non trovata')

    const window = monthWindow(roster.year, roster.month)

    const shifts: AssignmentRecord[] = await listAssignmentsForSync({
      userId: input.targetUserId,
      rosterId: input.rosterId,
      year: roster.year,
      month: roster.month,
    })

    // Nessuna assegnazione **non** è un motivo per fermarsi, ed era: dopo «Togli dal
    // calendario» sull ultimo turno la persona non ha più assegnazioni, e un rifiuto
    // qui lascerebbe l evento su Google senza nessuna via per sparire. Con `desired` e
    // `protectedKeys` vuoti `planSync` cancella gli eventi **dell app** dentro il mese
    // (`turno_rimosso`) e non tocca nient altro: la regola 2 vive nella shiftKey, non
    // in questo conto.
    const codes = await listShiftCodes()
    const { desired, skipped, protectedKeys } = buildDesiredEvents({
      userId: input.targetUserId,
      shifts,
      codes,
      window: { from: window.from, to: window.to },
    })

    let api: CalendarApi
    try {
      api = await (input.apiFactory ?? defaultApiFactory)(input.targetUserId)
    } catch (error) {
      // Confronto anche sul nome, non solo `instanceof`: le classi possono
      // esistere in due copie sotto il bundler, e qui sbagliare significherebbe
      // far esplodere un errore invece di dire all utente di rifare il login.
      const name = error instanceof Error ? error.name : ''
      if (error instanceof GoogleReauthRequiredError || name === 'GoogleReauthRequiredError') {
        return failed('Il consenso Google va rinnovato: rifai il login', '', true)
      }
      if (error instanceof GoogleAccountMissingError || name === 'GoogleAccountMissingError') {
        return failed('Nessun account Google collegato: rifai il login', '', true)
      }
      throw error
    }

    let calendarId: string
    try {
      const state = await readGoogleAccountState(input.targetUserId)
      const dedicated = await resolveDedicatedCalendar({
        api,
        knownCalendarId: state?.calendarId ?? null,
      })
      calendarId = dedicated.calendarId
      if (dedicated.changed) await setCalendarId(input.targetUserId, calendarId)
    } catch (error) {
      if (isReauthNeeded(error)) {
        await markNeedsReauth(input.targetUserId)
        return failed('Il consenso Google va rinnovato: rifai il login', '', true)
      }
      if (error instanceof DedicatedCalendarMissingError) {
        // L id resta com è: azzerarlo è un gesto della persona, non dell app.
        return { ...failed(error.message), calendarMissing: true }
      }
      return failed(error instanceof Error ? error.message : String(error))
    }

    let existing
    try {
      existing = await api.listEvents({
        calendarId,
        timeMin: window.timeMin,
        timeMax: window.timeMax,
      })
    } catch (error) {
      if (isReauthNeeded(error)) {
        await markNeedsReauth(input.targetUserId)
        return failed('Il consenso Google va rinnovato: rifai il login', calendarId, true)
      }
      return failed(error instanceof Error ? error.message : String(error), calendarId)
    }

    const plan = planSync({
      userId: input.targetUserId,
      window: { from: window.from, to: window.to },
      desired,
      skipped,
      protectedKeys,
      existing,
    })

    const storedEventIds = new Map(shifts.map((shift) => [shift.id, shift.eventId]))
    const applied = await applyPlan({
      api,
      calendarId,
      userId: input.targetUserId,
      plan,
      storedEventIds,
    })

    return {
      ok: applied.failures.length === 0,
      // Se il consenso è caduto mentre il piano girava, `applyPlan` si è fermato e ha
      // già segnato l account: l esito deve dirlo, o l utente ritenterebbe a vuoto.
      ...(applied.needsReauth ? { needsReauth: true } : {}),
      calendarId,
      created: applied.created,
      updated: applied.updated,
      deleted: applied.deleted,
      unchanged: applied.unchanged,
      skipped: plan.skipped,
      failures: applied.failures,
      foreignEvents: plan.foreignEvents,
      outOfWindowEvents: plan.outOfWindowEvents,
      protectedEvents: plan.protectedEvents,
    }
  })
}
