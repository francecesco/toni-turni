import { isColonnaDiServizio, normalizeColumn } from '@/modules/extract'
import type { AliasLike } from './access'

/**
 * Come si dichiara un buco.
 *
 * L avviso "qualcosa non è stato letto" è l unica difesa contro un turno che
 * sparisce, e vale solo se l utente si fida: un allarme che suona a vuoto viene
 * ignorato, e la volta che serve nessuno guarda. Quindi:
 *
 * 1. il buco si dichiara per **colonna e giorni**, non per indice di banda. Un
 *    "15 celle su 30 non lette" fa spaventare un infermiera che in realtà ha tutti
 *    i suoi turni: quelle quindici erano i totali di reparto;
 * 2. le colonne di servizio (`AIUTO MATT.`, `TOT M`, ...) sono marcate come tali e
 *    non contano come buco: non sono i turni di nessuno;
 * 3. dove i nomi non si conoscono — una banda mai letta non ha restituito
 *    intestazioni — lo si dice, invece di inventare un elenco preciso.
 */

export interface ColumnCoverage {
  columnLabel: string
  /** Colonna di servizio: ignorata dalla referente o riconosciuta dal nome. */
  ignored: boolean
  daysRead: number
  missingDays: number[]
  bandIndexes: number[]
}

interface CellLike {
  day: number
  columnLabel: string
  bandIndex: number | null
}

function isServiceColumn(label: string, aliases: AliasLike[]): boolean {
  const alias = aliases.find((a) => normalizeColumn(a.label) === normalizeColumn(label))
  if (alias?.ignored) return true
  if (alias?.userId) return false
  return isColonnaDiServizio(label)
}

export function columnCoverage(input: {
  year: number
  month: number
  cells: CellLike[]
  aliases: AliasLike[]
}): ColumnCoverage[] {
  const giorniNelMese = new Date(input.year, input.month, 0).getDate()

  const perColonna = new Map<string, { days: Set<number>; bands: Set<number> }>()
  for (const cell of input.cells) {
    const voce = perColonna.get(cell.columnLabel) ?? { days: new Set(), bands: new Set() }
    voce.days.add(cell.day)
    if (cell.bandIndex !== null) voce.bands.add(cell.bandIndex)
    perColonna.set(cell.columnLabel, voce)
  }

  const copertura: ColumnCoverage[] = []
  for (const [columnLabel, voce] of perColonna) {
    const missingDays: number[] = []
    for (let day = 1; day <= giorniNelMese; day += 1) {
      if (!voce.days.has(day)) missingDays.push(day)
    }
    copertura.push({
      columnLabel,
      ignored: isServiceColumn(columnLabel, input.aliases),
      daysRead: voce.days.size,
      missingDays,
      bandIndexes: [...voce.bands].sort((a, b) => a - b),
    })
  }

  return copertura.sort((a, b) => a.columnLabel.localeCompare(b.columnLabel, 'it'))
}

export interface UnreadBandReport {
  index: number
  status: string
  error: string | null
  /** Nomi certi: solo quelli che quella banda ha davvero restituito, in passato. */
  knownColumns: string[]
  description: string
  /** Riguarda solo colonne di servizio: non è un buco nei turni di nessuno. */
  serviceOnly: boolean
}

export function describeUnreadBands(input: {
  bands: Array<{ index: number; status: string; error: string | null }>
  cells: CellLike[]
  aliases: AliasLike[]
}): UnreadBandReport[] {
  // Le colonne che ogni banda ha davvero prodotto: è tutto ciò che sappiamo di
  // certo sulla geografia della tabella.
  const colonnePerBanda = new Map<number, string[]>()
  for (const cell of input.cells) {
    if (cell.bandIndex === null) continue
    const elenco = colonnePerBanda.get(cell.bandIndex) ?? []
    if (!elenco.includes(cell.columnLabel)) elenco.push(cell.columnLabel)
    colonnePerBanda.set(cell.bandIndex, elenco)
  }
  for (const elenco of colonnePerBanda.values()) {
    elenco.sort((a, b) => a.localeCompare(b, 'it'))
  }

  const indiciNoti = [...colonnePerBanda.keys()].sort((a, b) => a - b)

  const vicinaASinistra = (index: number): string | null => {
    const candidati = indiciNoti.filter((i) => i < index)
    if (candidati.length === 0) return null
    const colonne = colonnePerBanda.get(candidati[candidati.length - 1]) ?? []
    return colonne[colonne.length - 1] ?? null
  }
  const vicinaADestra = (index: number): string | null => {
    const candidato = indiciNoti.find((i) => i > index)
    if (candidato === undefined) return null
    return (colonnePerBanda.get(candidato) ?? [])[0] ?? null
  }

  return input.bands
    .filter((banda) => banda.status !== 'done')
    .sort((a, b) => a.index - b.index)
    .map((banda) => {
      const knownColumns = colonnePerBanda.get(banda.index) ?? []

      if (knownColumns.length > 0) {
        const serviceOnly = knownColumns.every((label) => isServiceColumn(label, input.aliases))
        return {
          index: banda.index,
          status: banda.status,
          error: banda.error,
          knownColumns,
          serviceOnly,
          description: serviceOnly
            ? `le colonne di servizio ${knownColumns.join(', ')} non sono state lette: non sono turni di nessuno`
            : `le colonne ${knownColumns.join(', ')} non sono state lette`,
        }
      }

      const sinistra = vicinaASinistra(banda.index)
      const destra = vicinaADestra(banda.index)

      let description: string
      if (sinistra !== null && destra !== null) {
        description = `un gruppo di colonne fra ${sinistra} e ${destra} non è stato letto`
      } else if (sinistra !== null) {
        description = `un gruppo di colonne dopo ${sinistra} non è stato letto`
      } else if (destra !== null) {
        description = `un gruppo di colonne prima di ${destra} non è stato letto`
      } else {
        description = 'nessuna colonna di questa parte della tabella è stata letta'
      }

      return {
        index: banda.index,
        status: banda.status,
        error: banda.error,
        knownColumns: [],
        // Senza i nomi non si può affermare che siano colonne di servizio: nel
        // dubbio si dichiara il buco, non si tace.
        serviceOnly: false,
        description,
      }
    })
}
