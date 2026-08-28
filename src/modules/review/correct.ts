import { prisma } from '@/lib/db'
import { listShiftCodes, matchCode } from '@/modules/codes'
import { normalizeColumn } from '@/modules/extract'
import { withWriteLock } from '@/modules/roster'
import { aliasFor } from './aliases'
import { ReviewForbiddenError, requireColumnAccess } from './confirm'
import type { Viewer } from './access'

/**
 * La correzione a mano di una cella: il modello ha letto `M` dove il foglio dice `P`.
 *
 * Sulla misura reale sbaglia una cella su 488, ed è quasi certamente una riscritta a
 * penna sopra il correttore — cioè proprio quelle che contano. Prima di questo, l unica
 * cosa che l utente potesse fare era **non** confermare quel giorno, e quel turno non
 * finiva sul calendario.
 *
 * Tre cose che questa funzione tiene ferme:
 *
 * 1. **Si scelgono i codici della legenda, non si scrive testo libero.** Un codice
 *    inventato non ha orario, e senza orario non può diventare un evento (regola
 *    invariante 4: non si indovina un orario che non si conosce).
 * 2. **La lettura del modello non si cancella.** `rawCode` e `code` restano dove sono e
 *    la correzione vive su `correctedCode`/`correctedAt`/`correctedBy`: così si può
 *    mostrare «il lettore aveva letto H», e `saveBandCells` sa che quella cella non è
 *    più sua e non la sovrascrive rileggendo la banda.
 * 3. **Una correzione non è una conferma.** Correggere annulla la conferma di quel
 *    giorno, perché la conferma valeva per il codice di prima. Dalla correzione al
 *    calendario il percorso resta: si corregge, si conferma, si sincronizza.
 *
 * Chi può correggere: l infermiera **la propria** colonna, perché sul suo turno
 * l autorità è lei; la referente **qualsiasi** colonna, perché sul foglio l autorità è
 * lei. È esattamente il predicato di `canSeeColumn`, e la barriera è la stessa
 * (`requireColumnAccess`): una seconda nozione di «chi tocca cosa» divergerebbe.
 */

export { ReviewForbiddenError }

/** Rifiuto con una ragione da mostrare: non è un problema di permessi. */
export class ReviewRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewRejectedError'
  }
}

export interface CellCorrection {
  rosterId: string
  columnLabel: string
  day: number
  /** Codice della legenda, oppure `null` per dire «il foglio qui è vuoto». */
  code: string | null
}

export interface CorrectionResult {
  day: number
  code: string | null
  /** La conferma di quel giorno è stata annullata: va riconfermato. */
  unconfirmed: boolean
  /**
   * L assegnazione è stata rimossa. Succede solo svuotando una cella: `Assignment.code`
   * non è facoltativo, quindi una bozza col codice vecchio sarebbe un dato falso. Il
   * prossimo sync dell intestataria toglie l evento dal calendario.
   */
  assignmentRemoved: boolean
}

export async function correctCell(
  viewer: Viewer,
  input: CellCorrection,
): Promise<CorrectionResult> {
  const columnLabelRichiesta = input.columnLabel.trim()
  if (columnLabelRichiesta === '') {
    throw new ReviewRejectedError('Colonna mancante: non si sa quale cella correggere')
  }

  await requireColumnAccess(viewer, columnLabelRichiesta, 'correggerne le celle')

  const roster = await prisma.roster.findUnique({
    where: { id: input.rosterId },
    select: { year: true, month: true },
  })
  if (roster === null) throw new ReviewRejectedError('Tabella turni non trovata')

  const giorniNelMese = new Date(roster.year, roster.month, 0).getDate()
  if (!Number.isInteger(input.day) || input.day < 1 || input.day > giorniNelMese) {
    throw new ReviewRejectedError(`Il giorno ${input.day} non esiste in questo mese`)
  }

  let code: string | null = null
  if (input.code !== null && input.code.trim() !== '') {
    const def = matchCode(input.code, await listShiftCodes())
    if (def === null) {
      throw new ReviewRejectedError(
        `Il codice "${input.code}" non è nella legenda: scegline uno dall elenco, oppure chiedi alla referente di aggiungerlo`,
      )
    }
    code = def.code
  }

  const chiaveColonna = normalizeColumn(columnLabelRichiesta)
  const alias = await aliasFor(columnLabelRichiesta)

  return withWriteLock(async () => {
    const celle = await prisma.rosterCell.findMany({ where: { rosterId: input.rosterId } })
    const stessaColonna = celle.filter((c) => normalizeColumn(c.columnLabel) === chiaveColonna)

    // L etichetta già in tabella è il canone: scriverne una seconda grafia spaccherebbe
    // la colonna in due (`SARA DP.` e `SARA DP` sono la stessa infermiera).
    const columnLabel = stessaColonna[0]?.columnLabel ?? columnLabelRichiesta
    const esistente = stessaColonna.find((c) => c.day === input.day) ?? null

    const now = new Date()
    const correzione = { correctedCode: code, correctedAt: now, correctedBy: viewer.id }

    if (esistente === null) {
      // Il giorno non è nemmeno stato letto: la cella nasce ora, e senza attribuire al
      // modello una lettura che non ha fatto.
      await prisma.rosterCell.create({
        data: {
          rosterId: input.rosterId,
          day: input.day,
          columnLabel,
          rawCode: '',
          code: null,
          confidence: 0,
          bandIndex: null,
          ...correzione,
        },
      })
    } else {
      await prisma.rosterCell.update({ where: { id: esistente.id }, data: correzione })
    }

    let unconfirmed = false
    let assignmentRemoved = false

    if (alias?.userId) {
      const dove = { userId: alias.userId, rosterId: input.rosterId, day: input.day }
      if (code === null) {
        const esito = await prisma.assignment.deleteMany({ where: dove })
        assignmentRemoved = esito.count > 0
      } else {
        // L `eventId` resta: se un evento esiste, il prossimo sync deve poterlo
        // aggiornare invece di crearne un secondo (regola invariante 2).
        const esito = await prisma.assignment.updateMany({
          where: { ...dove, confirmedAt: { not: null } },
          data: { confirmedAt: null, syncState: 'draft' },
        })
        unconfirmed = esito.count > 0
      }
    }

    return { day: input.day, code, unconfirmed, assignmentRemoved }
  })
}
