import { Banner } from '@/components/banner'
import { Badge } from '@/components/ui/badge'
import type { GridSummary } from '@/modules/review'

function elencoGiorni(giorni: number[]): string {
  if (giorni.length <= 8) return giorni.join(', ')
  return `${giorni.slice(0, 8).join(', ')} e altri ${giorni.length - 8}`
}

/** La testa della colonna: quanto è confermato, e cosa va guardato prima. */
export function ColumnSummary({
  columnLabel,
  summary,
  canConfirm,
  extracting,
  unreadTouchingColumn,
  unknownBands,
}: {
  columnLabel: string
  summary: GridSummary
  canConfirm: boolean
  extracting: boolean
  unreadTouchingColumn: boolean
  unknownBands: boolean
}) {
  const percentuale =
    summary.confirmable === 0 ? 0 : Math.round((summary.confirmed / summary.confirmable) * 100)

  return (
    <section className="flex flex-col gap-3">
      <div className="bg-card rounded-2xl px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-base font-bold">{columnLabel}</span>
          {summary.attention > 0 && (
            <Badge variant="destructive">{summary.attention} da rileggere</Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-sm tabular">
          <span className="text-foreground font-bold">{summary.confirmed}</span> di{' '}
          {summary.confirmable} confermati
        </p>
        <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
          <div className="bg-ok h-full rounded-full" style={{ width: `${percentuale}%` }} />
        </div>
      </div>

      {!canConfirm && (
        <Banner variant="info">
          Stai guardando la colonna di un altra persona: puoi leggerla, ma confermarla spetta solo a
          lei. Un turno finisce sul calendario di qualcuno unicamente con la sua conferma.
        </Banner>
      )}

      {extracting && (
        <Banner variant="warn">
          La lettura della tabella è ancora in corso: quello che vedi può essere incompleto.
        </Banner>
      )}

      {summary.emptyDays.length > 0 ? (
        <Banner
          variant="error"
          title={`${summary.emptyDays.length} ${summary.emptyDays.length === 1 ? 'giorno' : 'giorni'} senza turno letto`}
        >
          In questa colonna: {elencoGiorni(summary.emptyDays)}. Può voler dire che sulla tabella la
          casella era vuota, oppure che quel giorno non è stato letto: controllalo con la referente
          prima di fidarti.
        </Banner>
      ) : unreadTouchingColumn ? (
        <Banner variant="error">
          Una parte della tabella che contiene questa colonna non è stata letta.
        </Banner>
      ) : unknownBands ? (
        <Banner variant="info">
          Alcune parti della tabella non sono state lette, ma questa colonna risulta completa per
          tutti i giorni del mese.
        </Banner>
      ) : null}

      {summary.unknownCodes > 0 && (
        <Banner variant="warn">
          {summary.unknownCodes} {summary.unknownCodes === 1 ? 'codice' : 'codici'} non sono nella
          legenda: non si possono confermare finché la referente non li aggiunge, perché l app non
          inventa un orario che non conosce.
        </Banner>
      )}
    </section>
  )
}
