import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { requireUser } from '@/modules/auth'
import { listShiftCodes } from '@/modules/codes'
import {
  aliasFor,
  buildColumnGrid,
  canSeeColumn,
  columnAssignments,
  describeUnreadBands,
  gridSummary,
  listColumnAliases,
  rosterColumnLabels,
  visibleColumns,
} from '@/modules/review'
import {
  confirmColumnAction,
  confirmDayAction,
  correctCellAction,
  syncColumnAction,
  unconfirmDayAction,
} from './actions'
import { SyncButton } from './sync-button'

export const dynamic = 'force-dynamic'

function elencoGiorni(giorni: number[]): string {
  if (giorni.length <= 8) return giorni.join(', ')
  return `${giorni.slice(0, 8).join(', ')} e altri ${giorni.length - 8}`
}

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    colonna?: string
    error?: string
    ok?: string
    sync?: string
    reauth?: string
  }>
}) {
  const user = await requireUser()
  const { id } = await params
  const { colonna, error, ok, sync, reauth } = await searchParams

  const roster = await prisma.roster.findUnique({
    where: { id },
    include: { bands: { orderBy: { index: 'asc' } } },
  })
  if (!roster) notFound()

  const [etichette, aliases, codes] = await Promise.all([
    rosterColumnLabels(id),
    listColumnAliases(),
    listShiftCodes(),
  ])
  const visibili = visibleColumns(user, etichette, aliases)

  const scelta = colonna && visibili.includes(colonna) ? colonna : (visibili[0] ?? null)

  const intestazione = (
    <header className="space-y-1">
      <p className="text-sm text-muted-foreground">
        <Link href="/rosters" className="underline">
          Tabelle turni
        </Link>
      </p>
      <h1 className="text-2xl font-semibold capitalize">{monthLabel(roster.year, roster.month)}</h1>
      <p className="text-sm text-muted-foreground">
        {roster.ward}
        {roster.version > 1 && ` · versione ${roster.version}`}
      </p>
    </header>
  )

  if (scelta === null) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-4 pb-24">
        {intestazione}
        <Card>
          <CardContent className="space-y-2 text-sm">
            <p>Non c è ancora una colonna associata a te su questa tabella.</p>
            <p className="text-muted-foreground">
              Chiedi alla referente di associare il tuo nome alla colonna giusta: si fa una volta e
              vale anche per i mesi successivi.
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }

  const alias = await aliasFor(scelta)
  const puoConfermare = alias?.userId === user.id
  // Correggere è un permesso diverso dal confermare: l infermiera è l autorità sul
  // proprio turno, la referente sul foglio. È lo stesso predicato di `canSeeColumn`, e
  // il controllo vero sta lato server, dentro `correctCell`.
  const puoCorreggere = canSeeColumn(user, alias)
  const [assegnazioni, celle] = await Promise.all([
    columnAssignments(id, scelta),
    prisma.rosterCell.findMany({ where: { rosterId: id }, orderBy: { day: 'asc' } }),
  ])

  const righe = buildColumnGrid({
    year: roster.year,
    month: roster.month,
    columnLabel: scelta,
    cells: celle,
    codes,
    assignments: assegnazioni,
  })
  const riassunto = gridSummary(righe)

  const bandeNonLette = describeUnreadBands({
    bands: roster.bands.map((b) => ({
      index: b.index,
      status: b.status,
      error: b.error,
      dayFrom: b.dayFrom,
      dayTo: b.dayTo,
    })),
    cells: celle,
    aliases,
  })
  const bandeCheToccanoQuestaColonna = bandeNonLette.filter((banda) =>
    banda.knownColumns.includes(scelta),
  )
  const bandeIgnote = bandeNonLette.filter(
    (banda) => banda.knownColumns.length === 0 && !banda.serviceOnly,
  )
  const inLettura = roster.status === 'extracting' || roster.status === 'interrupted'

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 pb-32">
      {intestazione}

      {visibili.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {visibili.map((etichetta) => (
            <Link
              key={etichetta}
              href={`/rosters/${id}/review?colonna=${encodeURIComponent(etichetta)}`}
              className={
                etichetta === scelta
                  ? 'rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground'
                  : 'rounded-full border px-4 py-2 text-sm'
              }
            >
              {etichetta}
            </Link>
          ))}
        </nav>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {ok && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{ok}</p>}

      {reauth === '1' ? (
        <div className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Il collegamento con Google va rinnovato.</p>
          <p>
            Non è un guasto e non hai perso niente: l app ha bisogno del tuo permesso per creare il
            calendario «Turni» e scriverci gli eventi, e quel permesso va dato di nuovo — succede
            anche a chi aveva già fatto l accesso prima di questa versione. I turni che hai
            confermato restano dove sono; dopo l autorizzazione torna qui e premi di nuovo il
            bottone.
          </p>
          <a
            href="/api/auth/google/start"
            className="inline-block rounded-lg bg-amber-900 px-4 py-3 text-sm font-medium text-amber-50"
          >
            Autorizza Google
          </a>
        </div>
      ) : (
        sync && (
          <div className="rounded-lg border bg-muted/50 p-3 text-sm">
            <p className="mb-1 font-medium">Esito del sync</p>
            {sync.split('\n').map((riga, indice) => (
              <p key={`${indice}-${riga}`} className="whitespace-pre-wrap text-muted-foreground">
                {riga}
              </p>
            ))}
          </div>
        )
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{scelta}</span>
            <Badge variant="secondary">
              {riassunto.confirmed} di {riassunto.confirmable} confermati
            </Badge>
            {riassunto.attention > 0 && (
              <Badge variant="destructive">{riassunto.attention} da rileggere</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!puoConfermare && (
            <p className="rounded-lg bg-muted p-3 text-muted-foreground">
              Stai guardando la colonna di un altra persona: puoi leggerla, ma confermarla spetta
              solo a lei. Un turno finisce sul calendario di qualcuno unicamente con la sua
              conferma.
            </p>
          )}

          {inLettura && (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
              La lettura della tabella è ancora in corso: quello che vedi può essere incompleto.
            </p>
          )}

          {riassunto.emptyDays.length > 0 ? (
            <p className="rounded-lg bg-destructive/10 p-3">
              <strong>
                {riassunto.emptyDays.length}{' '}
                {riassunto.emptyDays.length === 1 ? 'giorno' : 'giorni'} senza turno letto
              </strong>{' '}
              in questa colonna: {elencoGiorni(riassunto.emptyDays)}. Può voler dire che sulla
              tabella la casella era vuota, oppure che quel giorno non è stato letto: controllalo
              con la referente prima di fidarti.
            </p>
          ) : bandeCheToccanoQuestaColonna.length > 0 ? (
            <p className="rounded-lg bg-destructive/10 p-3">
              Una parte della tabella che contiene questa colonna non è stata letta.
            </p>
          ) : bandeIgnote.length > 0 ? (
            <p className="rounded-lg bg-muted p-3 text-muted-foreground">
              Alcune parti della tabella non sono state lette, ma questa colonna risulta completa
              per tutti i giorni del mese.
            </p>
          ) : null}

          {riassunto.unknownCodes > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
              {riassunto.unknownCodes}{' '}
              {riassunto.unknownCodes === 1 ? 'codice' : 'codici'} non sono nella legenda: non si
              possono confermare finché la referente non li aggiunge, perché l app non inventa un
              orario che non conosce.
            </p>
          )}
        </CardContent>
      </Card>

      <ul className="space-y-2">
        {righe.map((riga) => {
          const domenica = riga.weekday === 'dom'
          return (
            <li
              key={riga.day}
              className={[
                'rounded-xl border p-3',
                riga.attention ? 'border-destructive/40 bg-destructive/5' : '',
                riga.confirmed && !riga.attention ? 'border-emerald-300 bg-emerald-50/60' : '',
                riga.empty ? 'opacity-70' : '',
              ].join(' ')}
            >
              <div className="flex items-center gap-3">
                <div
                  className={[
                    'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg',
                    domenica ? 'bg-rose-100 text-rose-900' : 'bg-muted',
                  ].join(' ')}
                >
                  <span className="text-lg leading-none font-semibold">{riga.day}</span>
                  <span className="text-[10px] uppercase">{riga.weekday}</span>
                </div>

                <div className="min-w-0 flex-1">
                  {riga.empty ? (
                    <p className="text-sm text-muted-foreground">
                      {riga.declaredEmpty ? 'vuota — svuotata a mano' : 'nessun turno letto'}
                    </p>
                  ) : (
                    <>
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-medium">
                          {riga.manuallyCorrected ? riga.correctedCode : riga.rawCode}
                        </span>
                        {riga.codeLabel && (
                          <span className="text-sm text-muted-foreground">{riga.codeLabel}</span>
                        )}
                        {riga.unknownCode && <Badge variant="destructive">sconosciuto</Badge>}
                        {riga.manuallyCorrected && <Badge variant="outline">corretta a mano</Badge>}
                      </p>
                      {riga.time && (
                        <p className="text-sm text-muted-foreground">
                          {riga.time}
                          {riga.location ? ` · ${riga.location}` : ''}
                        </p>
                      )}
                      {/* Chi guarda deve sapere cosa è stato corretto, e da cosa: senza
                          questo, una correzione sbagliata sarebbe invisibile. */}
                      {riga.manuallyCorrected && (
                        <p className="text-xs text-muted-foreground">
                          {riga.rawCode === null
                            ? 'scritta a mano: il lettore automatico non aveva letto niente qui'
                            : `corretta a mano: il lettore automatico aveva letto ${riga.rawCode}`}
                        </p>
                      )}
                      {/* La confidenza arriva fino qui (regola invariante 5) ma non
                          guida l attenzione: sulla misura reale non distingue le celle
                          sbagliate. Si mostra solo quando è davvero bassa. */}
                      {!riga.manuallyCorrected && riga.confidence !== null && riga.confidence < 0.9 && (
                        <p className="text-xs text-muted-foreground">
                          il lettore automatico si dichiara sicuro al{' '}
                          {Math.round(riga.confidence * 100)}%
                        </p>
                      )}
                    </>
                  )}
                  {riga.attentionReasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {riga.attentionReasons.map((motivo) => (
                        <li key={motivo} className="text-xs text-destructive">
                          {motivo}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {puoConfermare && riga.confirmable && (
                  <form
                    action={riga.confirmed ? unconfirmDayAction : confirmDayAction}
                    className="shrink-0"
                  >
                    <input type="hidden" name="rosterId" value={id} />
                    <input type="hidden" name="columnLabel" value={scelta} />
                    <input type="hidden" name="day" value={riga.day} />
                    <button
                      type="submit"
                      className={
                        riga.confirmed
                          ? 'h-12 min-w-24 rounded-lg border border-emerald-400 bg-emerald-100 px-3 text-sm font-medium text-emerald-900'
                          : 'h-12 min-w-24 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground'
                      }
                    >
                      {riga.confirmed ? 'Confermato' : 'Confermo'}
                    </button>
                  </form>
                )}
              </div>

              {riga.confirmed && riga.synced && (
                <p className="mt-2 text-xs text-muted-foreground">già sul tuo calendario</p>
              )}

              {/* La correzione si apre solo quando serve: una tendina per ogni giorno
                  renderebbe illeggibile un mese intero sul telefono. Si sceglie fra i
                  codici della legenda, perché un codice inventato non ha orario e non
                  potrebbe diventare un evento. */}
              {puoCorreggere && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground underline">
                    {riga.empty ? 'Scrivi il turno di questo giorno' : 'Correggi questo giorno'}
                  </summary>
                  <form action={correctCellAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="rosterId" value={id} />
                    <input type="hidden" name="columnLabel" value={scelta} />
                    <input type="hidden" name="day" value={riga.day} />
                    <select
                      name="code"
                      defaultValue={riga.code ?? ''}
                      aria-label={`Codice del giorno ${riga.day}`}
                      className="h-12 min-w-0 flex-1 rounded-lg border bg-background px-2 text-base"
                    >
                      <option value="">— la casella è vuota —</option>
                      {codes.map((def) => (
                        <option key={def.code} value={def.code}>
                          {def.code} · {def.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="h-12 shrink-0 rounded-lg border px-4 text-sm font-medium"
                    >
                      Salva
                    </button>
                  </form>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Una correzione annulla la conferma di quel giorno: va riconfermato prima di
                    finire sul calendario.
                  </p>
                </details>
              )}
            </li>
          )
        })}
      </ul>

      {puoConfermare && (
        <div className="sticky bottom-4 space-y-2">
          <form action={confirmColumnAction}>
            <input type="hidden" name="rosterId" value={id} />
            <input type="hidden" name="columnLabel" value={scelta} />
            <button
              type="submit"
              className="w-full rounded-xl bg-primary px-4 py-4 text-base font-medium text-primary-foreground shadow-lg"
            >
              Confermo tutti i {riassunto.confirmable} turni della colonna
            </button>
          </form>
          <p className="text-center text-xs text-muted-foreground">
            Niente finisce sul calendario prima di questa conferma.
          </p>

          {/* Due decisioni, due bottoni. La conferma dice «ho letto e va bene», il
              sync dice «scrivilo sul mio calendario»: il secondo non parte mai da sé
              dopo il primo (regola invariante 1). */}
          {riassunto.confirmed > 0 && (
            <form action={syncColumnAction} className="space-y-2 pt-1">
              <input type="hidden" name="rosterId" value={id} />
              <input type="hidden" name="columnLabel" value={scelta} />
              <SyncButton shifts={riassunto.confirmed} />
            </form>
          )}
        </div>
      )}
    </main>
  )
}
