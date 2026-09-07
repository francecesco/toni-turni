import type { ShiftCodeDef, ShiftKind } from '@/modules/codes/types'
import { normalizeColumn } from '@/modules/extract'
import type { ChangeKind, VersionChange } from './diff'

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
  /** Il **foglio** porta una correzione a penna: è un dato letto dalla foto. */
  handCorrected: boolean
  conflicted: boolean
  conflictWith: string | null
  /**
   * Correzione fatta da **una persona** sulla griglia (`correct.ts`). Non c entra niente
   * con `handCorrected`: quello descrive la carta, questo descrive chi ha corretto la
   * lettura. `correctedAt` valorizzato con `correctedCode` null significa «il foglio qui
   * è vuoto».
   */
  correctedCode?: string | null
  correctedAt?: Date | null
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
  /** Non c è un turno da confermare: nessuna cella, o una cella svuotata a mano. */
  empty: boolean
  /** Vuota **per dichiarazione di una persona**, non per un buco della lettura. */
  declaredEmpty: boolean
  /** Il codice viene da una correzione a mano, non dal lettore automatico. */
  manuallyCorrected: boolean
  correctedCode: string | null
  /** Il testo letto dal modello, `null` quando il modello non ha letto niente. */
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
  /** L ultimo invio è riuscito e nessuna riconferma l ha superato: è sul calendario così com è. */
  synced: boolean
  /** L ultimo invio di questo turno non è riuscito: `syncError` sull assegnazione dice perché. */
  syncFailed: boolean
  /** Si può confermare solo un turno con un codice che la legenda conosce. */
  confirmable: boolean
  attention: boolean
  attentionReasons: string[]
  /** Rispetto alla versione precedente della tabella: `null` se uguale o se è la prima versione. */
  changed: ChangeKind | null
  /** Il codice effettivo della versione precedente, solo quando `changed` non è null. */
  previousCode: string | null
  /**
   * Riga vuota che porta ancora una **conferma**: il turno non risulta più letto ma
   * l assegnazione (e forse l evento su Google) c è ancora. Una bozza su riga vuota
   * non è un orfana: il sync non l ha mai scritta.
   */
  orphanAssignment: boolean
  /**
   * `orphanAssignment` è certa solo quando il foglio nuovo lo dice: foto letta per
   * intero (`sheetFullyRead`) **e** diff che dichiara quel giorno `removed`. Su una
   * lettura parziale la riga vuota può essere un giorno non letto, e senza diff — la
   * prima versione — non c è nessun «foglio nuovo» con cui confrontare. La copertura
   * per banda (quale giorno è stato letto davvero) è rinviata alla Fase 6: qui la
   * versione minima onesta è tutto-o-niente.
   */
  orphanCertain: boolean
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
  changes?: VersionChange[]
  /** Falso su una lettura parziale: una riga vuota può essere un giorno non letto. */
  sheetFullyRead?: boolean
}): GridRow[] {
  const sheetFullyRead = input.sheetFullyRead ?? true
  const giorniNelMese = new Date(input.year, input.month, 0).getDate()
  const chiaveColonna = normalizeColumn(input.columnLabel)

  const perGiorno = new Map<number, ReviewCell>()
  for (const cell of input.cells) {
    if (normalizeColumn(cell.columnLabel) === chiaveColonna) perGiorno.set(cell.day, cell)
  }

  const legenda = new Map(input.codes.map((def) => [def.code, def]))
  const conferme = new Map(input.assignments.map((a) => [a.day, a]))
  const cambi = new Map(
    (input.changes ?? [])
      .filter((c) => c.columnKey === chiaveColonna)
      .map((c) => [c.day, c]),
  )

  const righe: GridRow[] = []
  for (let day = 1; day <= giorniNelMese; day += 1) {
    const cell = perGiorno.get(day) ?? null
    // Una correzione a mano vince sulla lettura del modello: su quella cella l autorità
    // è la persona che ha il foglio davanti.
    const corretta = cell !== null && (cell.correctedAt ?? null) !== null
    const codiceEffettivo = corretta ? (cell?.correctedCode ?? null) : (cell?.code ?? null)
    const def = codiceEffettivo ? (legenda.get(codiceEffettivo) ?? null) : null
    const assegnazione = conferme.get(day) ?? null
    const confermata = assegnazione?.confirmedAt != null

    const declaredEmpty = corretta && codiceEffettivo === null
    const empty = cell === null || declaredEmpty
    const unknownCode = cell !== null && !corretta && cell.code === null
    const changedSinceConfirm =
      confermata && assegnazione !== null && !empty && assegnazione.code !== codiceEffettivo
    const cambio = cambi.get(day) ?? null
    // Solo una **conferma** su una riga vuota è un orfana: una bozza non è mai finita
    // sul calendario (il sync la salta e protegge la chiave), quindi non c è niente da
    // togliere e chiederlo sarebbe rimediare a un guasto che non c è.
    const orphanAssignment = empty && assegnazione !== null && assegnazione.confirmedAt != null
    // Certa solo se il foglio nuovo lo dice: letto per intero **e** il diff dichiara
    // quel giorno «tolto». Senza diff — la prima versione — non c è un foglio nuovo con
    // cui confrontare, e su una lettura parziale la riga vuota può essere un giorno non
    // letto.
    const orphanCertain = orphanAssignment && sheetFullyRead && cambio?.kind === 'removed'

    const attentionReasons: string[] = []
    // Su una cella corretta a mano i motivi che vengono dalla lettura del modello sono
    // già stati risolti: una persona l ha guardata. Segnalarli ancora manderebbe
    // l attenzione dove l errore non c è più.
    if (!corretta) {
      if (cell?.handCorrected) attentionReasons.push('correzione a penna')
      if (cell?.conflicted) {
        attentionReasons.push(`letture discordanti: ${cell.rawCode} o ${cell.conflictWith ?? '?'}`)
      }
      if (unknownCode) attentionReasons.push(`codice sconosciuto: ${cell?.rawCode}`)
    }
    if (def?.needsReview) attentionReasons.push(`orario del codice ${def.code} ancora da confermare`)
    if (changedSinceConfirm) {
      attentionReasons.push(`cambiato dopo la conferma: era ${assegnazione?.code}`)
    }
    if (cambio?.kind === 'changed') attentionReasons.push(`cambiato rispetto alla foto precedente: era ${cambio.before}`)
    if (cambio?.kind === 'added') attentionReasons.push('nuovo rispetto alla foto precedente')
    if (orphanCertain) {
      attentionReasons.push('il foglio nuovo non ha più questo turno')
    } else if (orphanAssignment) {
      // Non si sa **perché** il turno non c è: giorno non letto, prima versione senza
      // confronto, cella svuotata a mano. Quello che si sa è che la conferma resta.
      attentionReasons.push('il turno confermato non risulta più letto: resta com’è')
    }

    righe.push({
      day,
      isoDate: isoDate(input.year, input.month, day),
      weekday: weekday(input.year, input.month, day),
      empty,
      declaredEmpty,
      manuallyCorrected: corretta,
      correctedCode: corretta ? (cell?.correctedCode ?? null) : null,
      rawCode: cell === null || cell.rawCode === '' ? null : cell.rawCode,
      code: codiceEffettivo,
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
      syncFailed: assegnazione?.syncState === 'failed',
      confirmable: codiceEffettivo !== null,
      attention: attentionReasons.length > 0,
      attentionReasons,
      changed: cambio?.kind ?? null,
      previousCode: cambio ? cambio.before : null,
      orphanAssignment,
      orphanCertain,
    })
  }

  return righe
}

export interface GridSummary {
  days: number
  shifts: number
  confirmed: number
  /** Turni confermati e già sul calendario. */
  synced: number
  /** Turni il cui ultimo invio non è riuscito. */
  syncFailed: number
  attention: number
  unknownCodes: number
  confirmable: number
  /** Righe cambiate rispetto alla versione precedente della tabella (`changed !== null`). */
  changed: number
  /**
   * Giorni della **propria** colonna senza turno letto. È così che si dichiara un
   * buco a chi lo riguarda: per colonna e per giorni, non come "n celle su m non
   * lette" su una banda che magari conteneva solo i totali di reparto.
   */
  emptyDays: number[]
}

export function gridSummary(rows: GridRow[]): GridSummary {
  return {
    days: rows.length,
    shifts: rows.filter((r) => !r.empty).length,
    confirmed: rows.filter((r) => r.confirmed).length,
    synced: rows.filter((r) => r.confirmed && r.synced).length,
    syncFailed: rows.filter((r) => r.syncFailed).length,
    attention: rows.filter((r) => r.attention).length,
    unknownCodes: rows.filter((r) => r.unknownCode).length,
    confirmable: rows.filter((r) => r.confirmable).length,
    changed: rows.filter((r) => r.changed !== null).length,
    // Solo i buchi **veri**: una cella dichiarata vuota da una persona non è un giorno
    // non letto, e farla suonare come tale insegnerebbe a ignorare l allarme.
    emptyDays: rows.filter((r) => r.empty && !r.declaredEmpty).map((r) => r.day),
  }
}
