import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ShiftCodeDef } from '@/modules/codes'
import type { GridRow } from '@/modules/review'
import {
  confirmDayAction,
  correctCellAction,
  removeAssignmentAction,
  unconfirmDayAction,
} from './actions'

/**
 * Una riga giorno. Estratta da `page.tsx`, che a 436 righe non era più un file su
 * cui lavorare.
 *
 * Quello che guida l attenzione è `attention` (correzioni a penna, conflitti,
 * codici sconosciuti), **non** la confidenza: sulla misura reale nessuna cella
 * stava sotto 0,8 ed entrambe le celle sbagliate erano dichiarate con confidenza
 * alta. La confidenza si mostra comunque, come dato accessorio (regola
 * invariante 5), ma non colora niente.
 */
export function DayRow({
  row,
  rosterId,
  columnLabel,
  codes,
  canConfirm,
  canCorrect,
}: {
  row: GridRow
  rosterId: string
  columnLabel: string
  codes: ShiftCodeDef[]
  canConfirm: boolean
  canCorrect: boolean
}) {
  const domenica = row.weekday === 'dom'

  return (
    <li
      className={[
        'bg-card border-border rounded-2xl border px-3 py-3 shadow-sm',
        row.attention ? 'ring-warn/40 ring-2' : '',
        row.confirmed && !row.attention ? 'ring-ok/30 ring-1' : '',
        row.empty ? 'opacity-70' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <div
          className={[
            'flex size-12 shrink-0 flex-col items-center justify-center rounded-xl tabular',
            domenica ? 'bg-sunday-soft text-sunday-soft-foreground' : 'bg-muted text-foreground',
          ].join(' ')}
        >
          <span className="text-xl leading-none font-extrabold">{row.day}</span>
          <span className="text-[10px] tracking-wide uppercase opacity-70">{row.weekday}</span>
        </div>

        <div className="min-w-0 flex-1">
          {row.empty ? (
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-sm">
                {row.orphanCertain
                  ? 'il foglio nuovo non ha più questo turno'
                  : row.orphanAssignment
                    ? 'il turno confermato non risulta più letto: resta com’è'
                    : row.declaredEmpty
                      ? 'vuota — svuotata a mano'
                      : 'nessun turno letto'}
              </p>
              {row.orphanCertain && row.synced && (
                <p className="text-warn-soft-foreground text-xs font-medium">
                  sul calendario c’è ancora {row.confirmedCode ?? 'il turno di prima'}
                </p>
              )}
              {row.orphanCertain && canConfirm && (
                <form action={removeAssignmentAction}>
                  <input type="hidden" name="rosterId" value={rosterId} />
                  <input type="hidden" name="columnLabel" value={columnLabel} />
                  <input type="hidden" name="day" value={row.day} />
                  {/* Senza `synced` non c è niente su Google da cancellare: chiamarlo
                      «Togli dal calendario» promette un gesto che non serve. */}
                  <Button type="submit" size="touch" variant="outline" className="min-w-24">
                    {row.synced ? 'Togli dal calendario' : 'Togli il turno'}
                  </Button>
                </form>
              )}
            </div>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold">
                  {row.manuallyCorrected ? row.correctedCode : row.rawCode}
                </span>
                {row.codeLabel && (
                  <span className="text-muted-foreground text-sm">{row.codeLabel}</span>
                )}
                {row.unknownCode && <Badge variant="destructive">sconosciuto</Badge>}
                {row.manuallyCorrected && <Badge variant="outline">corretta a mano</Badge>}
                {row.changed === 'changed' && <Badge variant="secondary">cambiato</Badge>}
                {row.changed === 'added' && <Badge variant="secondary">nuovo</Badge>}
              </p>
              {row.time && (
                // `row.time` porta già il suffisso «(+1 giorno)» quando il turno
                // attraversa la mezzanotte (`describeTime` in `grid.ts`): niente da
                // aggiungere qui, o diventerebbe «(+1 giorno) del 4».
                <p className="text-muted-foreground text-sm tabular">
                  {row.time}
                  {row.location ? ` · ${row.location}` : ''}
                </p>
              )}
              {/* Chi guarda deve sapere cosa è stato corretto, e da cosa: senza
                  questo, una correzione sbagliata sarebbe invisibile. */}
              {row.manuallyCorrected && (
                <p className="text-muted-foreground text-xs">
                  {row.rawCode === null
                    ? 'scritta a mano: il lettore automatico non aveva letto niente qui'
                    : `corretta a mano: il lettore automatico aveva letto ${row.rawCode}`}
                </p>
              )}
              {!row.manuallyCorrected && row.confidence !== null && row.confidence < 0.9 && (
                <p className="text-muted-foreground text-xs tabular">
                  il lettore automatico si dichiara sicuro al {Math.round(row.confidence * 100)}%
                </p>
              )}
            </>
          )}

          {row.attentionReasons.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {row.attentionReasons.map((motivo) => (
                <li key={motivo} className="text-warn-soft-foreground bg-warn-soft rounded-lg px-2 py-1 text-xs font-medium">
                  {motivo}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canConfirm && row.confirmable && (
          <form
            // Confermato ma cambiato dopo la conferma: il bottone deve riconfermare
            // il codice nuovo, non deconfermare quello vecchio — altrimenti premerlo
            // protegge l evento sbagliato invece di aggiornarlo (`confirmDays` fa già
            // l upsert col codice nuovo e `syncState: 'confirmed'`).
            action={row.confirmed && !row.changedSinceConfirm ? unconfirmDayAction : confirmDayAction}
            className="shrink-0"
          >
            <input type="hidden" name="rosterId" value={rosterId} />
            <input type="hidden" name="columnLabel" value={columnLabel} />
            <input type="hidden" name="day" value={row.day} />
            <Button
              type="submit"
              size="touch"
              variant={row.confirmed && !row.changedSinceConfirm ? 'outline' : 'default'}
              className={row.confirmed && !row.changedSinceConfirm ? 'text-ok min-w-24' : 'min-w-24'}
            >
              {row.changedSinceConfirm ? 'Riconfermo' : row.confirmed ? 'Confermato' : 'Confermo'}
            </Button>
          </form>
        )}
      </div>

      {row.confirmed && row.synced && (
        <p className="text-ok mt-2 text-xs font-medium">già sul tuo calendario</p>
      )}

      {row.changedSinceConfirm && row.synced && (
        <p className="text-warn-soft-foreground mt-2 text-xs font-medium">
          sul calendario c’è ancora {row.confirmedCode}: riconferma per aggiornarlo
        </p>
      )}

      {/* La correzione si apre solo quando serve: una tendina per ogni giorno
          renderebbe illeggibile un mese intero sul telefono. Si sceglie fra i
          codici della legenda, perché un codice inventato non ha orario e non
          potrebbe diventare un evento. */}
      {canCorrect && (
        <details className="mt-2">
          <summary className="text-muted-foreground flex min-h-11 cursor-pointer items-center py-3 text-sm underline">
            {row.empty ? 'Scrivi il turno di questo giorno' : 'Correggi questo giorno'}
          </summary>
          <form action={correctCellAction} className="mt-2 flex items-center gap-2">
            <input type="hidden" name="rosterId" value={rosterId} />
            <input type="hidden" name="columnLabel" value={columnLabel} />
            <input type="hidden" name="day" value={row.day} />
            <select
              name="code"
              defaultValue={row.code ?? ''}
              aria-label={`Codice del giorno ${row.day}`}
              className="border-input bg-background h-11 min-w-0 flex-1 rounded-xl border px-3 text-base"
            >
              <option value="">— la casella è vuota —</option>
              {codes.map((def) => (
                <option key={def.code} value={def.code}>
                  {def.code} · {def.label}
                </option>
              ))}
            </select>
            <Button type="submit" size="touch" variant="outline" className="shrink-0">
              Salva
            </Button>
          </form>
          <p className="text-muted-foreground mt-1.5 text-xs">
            Una correzione annulla la conferma di quel giorno: va riconfermato prima di finire sul
            calendario.
          </p>
        </details>
      )}
    </li>
  )
}
