import { prisma } from '@/lib/db'
import { normalizeColumn } from '@/modules/extract'
import { withWriteLock } from '@/modules/roster'
import { canSeeColumn, type Viewer } from './access'
import { aliasFor } from './aliases'
import type { ReviewAssignment } from './grid'

/**
 * La conferma umana: l unica cosa che autorizza una scrittura sul calendario.
 *
 * Due autorizzazioni distinte, e la differenza conta:
 * - **vedere** una colonna: l infermiera la propria, la referente tutte (le serve
 *   per il lavoro, ed è scritto nel design);
 * - **confermare** una colonna: soltanto la persona a cui la colonna è associata,
 *   referente compresa. Una referente che confermasse la colonna di un altra
 *   metterebbe eventi sul calendario di quella persona senza il suo consenso, e la
 *   regola invariante 1 dice che la conferma è dell utente.
 */

export class ReviewForbiddenError extends Error {
  constructor(message = 'Non hai accesso a questa colonna') {
    super(message)
    this.name = 'ReviewForbiddenError'
  }
}

export interface ColumnTarget {
  rosterId: string
  columnLabel: string
}

export interface ConfirmResult {
  confirmed: number
  refused: Array<{ day: number; reason: string }>
}

/**
 * Permesso di **vedere** la colonna — e di correggerne le celle, che è lo stesso
 * predicato: l infermiera la propria colonna, la referente tutte. Sul turno l autorità
 * è l infermiera, sul foglio è la referente, e nessuna delle due scrive per questo sul
 * calendario di qualcuno: quello lo fa solo la conferma, che ha la sua barriera.
 *
 * `azione` cambia solo la frase mostrata; la regola no.
 */
export async function requireColumnAccess(
  viewer: Viewer,
  columnLabel: string,
  azione = 'vederla',
): Promise<void> {
  const alias = await aliasFor(columnLabel)
  if (!canSeeColumn(viewer, alias)) {
    throw new ReviewForbiddenError(
      `La colonna "${columnLabel}" non è tua: solo chi vi è associato può ${azione}`,
    )
  }
}

/**
 * Permesso di **agire** sulla colonna: solo la persona associata, sempre, referente
 * compresa. È la stessa barriera per la conferma e per il sync, e deve restare una
 * sola: confermare al posto di un altra metterebbe eventi sul suo calendario senza il
 * suo consenso, e sincronizzare al posto suo li scriverebbe direttamente.
 *
 * `azione` cambia solo la frase mostrata; la regola no.
 */
export async function requireOwnColumn(
  viewer: Viewer,
  columnLabel: string,
  azione = 'confermarne i turni',
): Promise<string> {
  const alias = await aliasFor(columnLabel)
  if (alias === null || alias.ignored || alias.userId === null) {
    throw new ReviewForbiddenError(
      `La colonna "${columnLabel}" non è associata a nessuno: va prima assegnata`,
    )
  }
  if (alias.userId !== viewer.id) {
    throw new ReviewForbiddenError(
      `Solo la persona associata alla colonna "${columnLabel}" può ${azione}`,
    )
  }
  return alias.userId
}

async function cellsOfColumn(rosterId: string, columnLabel: string) {
  const chiave = normalizeColumn(columnLabel)
  const celle = await prisma.rosterCell.findMany({ where: { rosterId } })
  return celle.filter((c) => normalizeColumn(c.columnLabel) === chiave)
}

export async function confirmDays(
  viewer: Viewer,
  input: ColumnTarget & { days: number[] },
): Promise<ConfirmResult> {
  const userId = await requireOwnColumn(viewer, input.columnLabel)
  const celle = await cellsOfColumn(input.rosterId, input.columnLabel)
  const perGiorno = new Map(celle.map((c) => [c.day, c]))
  const now = new Date()

  const refused: Array<{ day: number; reason: string }> = []
  const daConfermare: Array<{ day: number; code: string; columnLabel: string }> = []

  for (const day of input.days) {
    const cella = perGiorno.get(day)
    if (!cella) {
      refused.push({ day, reason: 'Nessun turno letto per questo giorno' })
      continue
    }

    // Una correzione a mano vince sulla lettura del modello: su quella cella
    // l autorità è la persona che ha il foglio davanti (vedi `correct.ts`).
    const corretta = cella.correctedAt !== null
    const code = corretta ? cella.correctedCode : cella.code

    if (corretta && code === null) {
      refused.push({ day, reason: 'La cella è stata svuotata a mano: non c è un turno da confermare' })
      continue
    }
    if (code === null) {
      // Regola invariante 4: un codice sconosciuto non si indovina.
      refused.push({
        day,
        reason: `Il codice "${cella.rawCode}" non è nella legenda: va risolto prima di confermarlo`,
      })
      continue
    }
    daConfermare.push({ day, code, columnLabel: cella.columnLabel })
  }

  if (daConfermare.length > 0) {
    await withWriteLock(async () => {
      for (const turno of daConfermare) {
        await prisma.assignment.upsert({
          where: { userId_rosterId_day: { userId, rosterId: input.rosterId, day: turno.day } },
          create: {
            userId,
            rosterId: input.rosterId,
            day: turno.day,
            columnLabel: turno.columnLabel,
            code: turno.code,
            confirmedAt: now,
            syncState: 'confirmed',
          },
          update: {
            columnLabel: turno.columnLabel,
            code: turno.code,
            confirmedAt: now,
            syncState: 'confirmed',
          },
        })
      }
    })
  }

  return { confirmed: daConfermare.length, refused }
}

export async function confirmColumn(viewer: Viewer, input: ColumnTarget): Promise<ConfirmResult> {
  const celle = await cellsOfColumn(input.rosterId, input.columnLabel)
  const days = celle.map((c) => c.day).sort((a, b) => a - b)
  return confirmDays(viewer, { ...input, days })
}

/**
 * Toglie la conferma riportando l assegnazione a bozza. L `eventId` resta: senza
 * quello il sync non saprebbe più quale evento del calendario ha creato lui, e la
 * regola invariante 2 vieta di toccare eventi non suoi.
 */
export async function unconfirmDays(
  viewer: Viewer,
  input: ColumnTarget & { days: number[] },
): Promise<{ unconfirmed: number }> {
  const userId = await requireOwnColumn(viewer, input.columnLabel)

  return withWriteLock(async () => {
    const esito = await prisma.assignment.updateMany({
      where: { userId, rosterId: input.rosterId, day: { in: input.days } },
      data: { confirmedAt: null, syncState: 'draft' },
    })
    return { unconfirmed: esito.count }
  })
}

/** Le conferme della persona associata alla colonna, per la griglia. */
export async function columnAssignments(
  rosterId: string,
  columnLabel: string,
): Promise<ReviewAssignment[]> {
  const alias = await aliasFor(columnLabel)
  if (alias === null || alias.userId === null || alias.ignored) return []

  const righe = await prisma.assignment.findMany({
    where: { rosterId, userId: alias.userId },
    orderBy: { day: 'asc' },
    select: { day: true, code: true, confirmedAt: true, syncState: true },
  })
  return righe
}

/**
 * Le tabelle che questo utente ha da confermare. Un infermiera le vede solo dopo
 * l estrazione: mentre il job gira la sua colonna sarebbe incompleta e confermarla
 * significherebbe confermare dei buchi.
 *
 * Il confronto fra la chiave dell alias e l etichetta letta dalla foto **non** si
 * può fare in SQL: l etichetta sulla cella è il testo come sta sul foglio
 * (`SARA DP.`) e la chiave è la sua forma normalizzata (`SARADP`). Si filtra in
 * memoria su poche righe, invece di confrontare in SQL due cose che non sono la
 * stessa e non trovare mai niente.
 */
export async function reviewableRosters(viewer: Viewer): Promise<
  Array<{
    id: string
    year: number
    month: number
    ward: string
    version: number
    status: string
    createdAt: Date
  }>
> {
  const select = {
    id: true,
    year: true,
    month: true,
    ward: true,
    version: true,
    status: true,
    createdAt: true,
  }
  const orderBy = [{ year: 'desc' }, { month: 'desc' }, { version: 'desc' }] as const

  if (viewer.role === 'REFERENTE') {
    return prisma.roster.findMany({ orderBy: [...orderBy], select })
  }

  const aliasSuoi = await prisma.columnAlias.findMany({
    where: { userId: viewer.id, ignored: false },
    select: { label: true },
  })
  if (aliasSuoi.length === 0) return []
  const chiavi = new Set(aliasSuoi.map((a) => normalizeColumn(a.label)))

  const candidate = await prisma.roster.findMany({
    where: { status: { in: ['extracted', 'partial'] } },
    orderBy: [...orderBy],
    select: {
      ...select,
      cells: { distinct: ['columnLabel'], select: { columnLabel: true } },
    },
  })

  return candidate
    .filter((roster) => roster.cells.some((c) => chiavi.has(normalizeColumn(c.columnLabel))))
    .map((roster) => {
      const { cells, ...senzaCelle } = roster
      void cells
      return senzaCelle
    })
}
