import type { ShiftCodeDef, ShiftKind } from '@/modules/codes/types'
import { normalizeLabel } from './access'

/**
 * La griglia di conferma di **una** colonna: una riga per ogni giorno del mese,
 * anche per i giorni senza turno, così un giorno saltato dall estrazione si vede
 * come vuoto invece di scomparire dall elenco.
 *
 * Cosa evidenzia, e soprattutto cosa no: si evidenziano le celle **corrette a
 * penna**, i **conflitti fra bande**, i **codici sconosciuti** e i codici della
 * legenda ancora da confermare. **Non** si evidenzia la confidenza bassa: sulla
 * misura reale nessuna cella su 519 stava sotto 0,8 ed entrambe le celle sbagliate
 * erano dichiarate con confidenza alta, mentre il rilevamento delle correzioni a
 * penna ha richiamo 100% (10 su 10). Evidenziare la confidenza sposterebbe
 * l attenzione dell utente esattamente dove l errore non è. La confidenza resta
 * comunque leggibile su ogni cella (regola invariante 5).
 */

export interface ReviewCell {
  day: number
  columnLabel: string
  rawCode: string
  code: string | null
  confidence: number
  handCorrected: boolean
  conflicted: boolean
  conflictWith: string | null
}

export interface ReviewAssignment {
  day: number
  code: string
  confirmedAt: Date | null
  syncState: string
}

export interface GridRow {
  day: number
  isoDate: string
  weekday: string
  empty: boolean
  rawCode: string | null
  code: string | null
  codeLabel: string | null
  kind: ShiftKind | null
  time: string | null
  crossesMidnight: boolean
  location: string | null
  color: string | null
  confidence: number | null
  handCorrected: boolean
  conflicted: boolean
  conflictWith: string | null
  unknownCode: boolean
  needsReview: boolean
  confirmed: boolean
  confirmedCode: string | null
  changedSinceConfirm: boolean
  synced: boolean
  /** Si può confermare solo un turno con un codice che la legenda conosce. */
  confirmable: boolean
  attention: boolean
  attentionReasons: string[]
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'] as const

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Giorno della settimana in aritmetica UTC: nessun fuso di mezzo. */
function weekday(year: number, month: number, day: number): string {
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}

function describeTime(def: ShiftCodeDef): string {
  if (def.startTime === null || def.endTime === null) return 'tutto il giorno'
  const suffisso = def.crossesMidnight ? ' (+1 giorno)' : ''
  return `${def.startTime}–${def.endTime}${suffisso}`
}

export function buildColumnGrid(input: {
  year: number
  month: number
  columnLabel: string
  cells: ReviewCell[]
  codes: ShiftCodeDef[]
  assignments: ReviewAssignment[]
}): GridRow[] {
  const giorniNelMese = new Date(input.year, input.month, 0).getDate()
  const chiaveColonna = normalizeLabel(input.columnLabel)

  const perGiorno = new Map<number, ReviewCell>()
  for (const cell of input.cells) {
    if (normalizeLabel(cell.columnLabel) === chiaveColonna) perGiorno.set(cell.day, cell)
  }

  const legenda = new Map(input.codes.map((def) => [def.code, def]))
  const conferme = new Map(input.assignments.map((a) => [a.day, a]))

  const righe: GridRow[] = []
  for (let day = 1; day <= giorniNelMese; day += 1) {
    const cell = perGiorno.get(day) ?? null
    const def = cell?.code ? (legenda.get(cell.code) ?? null) : null
    const assegnazione = conferme.get(day) ?? null
    const confermata = assegnazione?.confirmedAt != null

    const unknownCode = cell !== null && cell.code === null
    const changedSinceConfirm =
      confermata && assegnazione !== null && cell !== null && assegnazione.code !== cell.code

    const attentionReasons: string[] = []
    if (cell?.handCorrected) attentionReasons.push('correzione a penna')
    if (cell?.conflicted) {
      attentionReasons.push(`letture discordanti: ${cell.rawCode} o ${cell.conflictWith ?? '?'}`)
    }
    if (unknownCode) attentionReasons.push(`codice sconosciuto: ${cell?.rawCode}`)
    if (def?.needsReview) attentionReasons.push(`orario del codice ${def.code} ancora da confermare`)
    if (changedSinceConfirm) {
      attentionReasons.push(`cambiato dopo la conferma: era ${assegnazione?.code}`)
    }

    righe.push({
      day,
      isoDate: isoDate(input.year, input.month, day),
      weekday: weekday(input.year, input.month, day),
      empty: cell === null,
      rawCode: cell?.rawCode ?? null,
      code: cell?.code ?? null,
      codeLabel: def?.label ?? null,
      kind: def?.kind ?? null,
      time: def ? describeTime(def) : null,
      crossesMidnight: def?.crossesMidnight ?? false,
      location: def?.location ?? null,
      color: def?.color ?? null,
      confidence: cell?.confidence ?? null,
      handCorrected: cell?.handCorrected ?? false,
      conflicted: cell?.conflicted ?? false,
      conflictWith: cell?.conflictWith ?? null,
      unknownCode,
      needsReview: def?.needsReview ?? false,
      confirmed: confermata,
      confirmedCode: confermata ? (assegnazione?.code ?? null) : null,
      changedSinceConfirm,
      synced: assegnazione?.syncState === 'synced',
      confirmable: cell !== null && cell.code !== null,
      attention: attentionReasons.length > 0,
      attentionReasons,
    })
  }

  return righe
}

export interface GridSummary {
  days: number
  shifts: number
  confirmed: number
  attention: number
  unknownCodes: number
  confirmable: number
}

export function gridSummary(rows: GridRow[]): GridSummary {
  return {
    days: rows.length,
    shifts: rows.filter((r) => !r.empty).length,
    confirmed: rows.filter((r) => r.confirmed).length,
    attention: rows.filter((r) => r.attention).length,
    unknownCodes: rows.filter((r) => r.unknownCode).length,
    confirmable: rows.filter((r) => r.confirmable).length,
  }
}
