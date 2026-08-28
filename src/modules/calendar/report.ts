import { parseShiftKey } from './shiftKey'
import type { SkipReason, SyncOutcome } from './types'

const REASON_LABELS: Record<SkipReason, { one: string; many: string }> = {
  non_confermato: { one: 'non confermato', many: 'non confermati' },
  codice_sconosciuto: { one: 'con codice sconosciuto', many: 'con codice sconosciuto' },
  giorno_duplicato: { one: 'duplicato nello stesso giorno', many: 'duplicati nello stesso giorno' },
  fuori_intervallo: { one: 'fuori dal mese', many: 'fuori dal mese' },
  data_non_valida: { one: 'con data non valida', many: 'con data non valida' },
}

/** "2026-08-03" → "03/08"; se la data non è leggibile la restituisce com è. */
function giorno(isoDate: string): string {
  const parts = isoDate.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : isoDate
}

/**
 * L esito in italiano, da mostrare all utente dopo la conferma: quanti eventi sono
 * stati creati, aggiornati, cancellati, e soprattutto che cosa è stato saltato e
 * perché — è l unica cosa su cui poi deve intervenire lei.
 */
export function describeOutcome(outcome: SyncOutcome): string {
  if (outcome.error) return `Sync non eseguito: ${outcome.error}.`

  const lines: string[] = [
    `Creati ${outcome.created}, aggiornati ${outcome.updated}, cancellati ${outcome.deleted}, invariati ${outcome.unchanged}.`,
  ]

  if (outcome.skipped.length > 0) {
    const order: SkipReason[] = []
    const byReason = new Map<SkipReason, string[]>()
    for (const skip of outcome.skipped) {
      if (!byReason.has(skip.reason)) {
        byReason.set(skip.reason, [])
        order.push(skip.reason)
      }
      byReason.get(skip.reason)!.push(giorno(skip.date))
    }

    const gruppi = order.map((reason) => {
      const dates = byReason.get(reason)!
      const label = dates.length === 1 ? REASON_LABELS[reason].one : REASON_LABELS[reason].many
      return `${dates.length} ${label} (${dates.join(', ')})`
    })

    const testa = outcome.skipped.length === 1 ? 'Saltato 1 turno' : `Saltati ${outcome.skipped.length} turni`
    lines.push(`${testa}: ${gruppi.join(', ')}.`)
  }

  if (outcome.failures.length > 0) {
    const elenco = outcome.failures
      .map((failure) => {
        const parsed = parseShiftKey(failure.shiftKey)
        const quando = parsed ? giorno(parsed.date) : failure.shiftKey
        return `${quando} ${failure.action} — ${failure.message}`
      })
      .join('; ')
    lines.push(`Non riusciti ${outcome.failures.length}: ${elenco}.`)
  }

  if (outcome.protectedEvents > 0) {
    lines.push(
      `Eventi conservati perché il turno del giorno è da chiarire: ${outcome.protectedEvents}.`,
    )
  }

  if (outcome.foreignEvents > 0) {
    lines.push(`Eventi non creati dall app, lasciati intatti: ${outcome.foreignEvents}.`)
  }

  if (outcome.outOfWindowEvents > 0) {
    lines.push(`Eventi di altri mesi non toccati: ${outcome.outOfWindowEvents}.`)
  }

  return lines.join('\n')
}
