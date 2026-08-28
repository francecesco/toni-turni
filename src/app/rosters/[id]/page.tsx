import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { requireReferente } from '@/modules/auth'
import { normalizeColumn } from '@/modules/extract'
import { rosterImageExists } from '@/modules/ingest'
import { rosterProgress } from '@/modules/roster'
import { columnCoverage, describeUnreadBands, listColumnAliases } from '@/modules/review'
import { ExtractionProgress } from './extraction-progress'

export const dynamic = 'force-dynamic'

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  await requireReferente()
  const { id } = await params
  const { error } = await searchParams

  const roster = await prisma.roster.findUnique({
    where: { id },
    include: {
      bands: { orderBy: { index: 'asc' } },
      cells: { orderBy: [{ day: 'asc' }, { columnLabel: 'asc' }] },
    },
  })
  if (!roster) notFound()

  const [progresso, aliases, fotoDisponibile] = await Promise.all([
    rosterProgress(id),
    listColumnAliases(),
    rosterImageExists(id),
  ])

  const copertura = columnCoverage({
    year: roster.year,
    month: roster.month,
    cells: roster.cells,
    aliases,
  })
  const bandeNonLette = describeUnreadBands({
    bands: roster.bands.map((b) => ({
      index: b.index,
      status: b.status,
      error: b.error,
      dayFrom: b.dayFrom,
      dayTo: b.dayTo,
    })),
    cells: roster.cells,
    aliases,
  })

  const inCorso = roster.status === 'extracting' || roster.status === 'interrupted'
  const daEstrarre = roster.status === 'uploaded'
  const conclusa = ['extracted', 'partial', 'failed'].includes(roster.status)
  // Un buco che riguarda i turni di qualcuno, distinto da quello sulle colonne di
  // servizio: è la differenza fra un allarme che serve e uno che insegna a ignorare.
  const buchiDaPersone = bandeNonLette.filter((banda) => !banda.serviceOnly)
  const colonnePersone = copertura.filter((c) => !c.ignored)
  const colonneIncomplete = colonnePersone.filter((c) => c.missingDays.length > 0)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 pb-24">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/rosters" className="underline">
            Tabelle turni
          </Link>
        </p>
        <h1 className="text-2xl font-semibold capitalize">
          {monthLabel(roster.year, roster.month)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {roster.ward}
          {roster.version > 1 && ` · versione ${roster.version}`}
          {roster.provider && ` · letta con ${roster.provider}`}
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {roster.error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {roster.error}
        </p>
      )}

      {!fotoDisponibile && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          La foto non è più sul server: è stata cancellata dalla conservazione automatica. I turni
          già letti restano, ma non è più possibile rileggere la tabella.
        </p>
      )}

      {daEstrarre && fotoDisponibile && (
        <Card>
          <CardHeader>
            <CardTitle>Controlla i tagli, poi manda a leggere</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              La foto qui sotto è già raddrizzata: sopra ci sono disegnati i tagli che verranno
              usati per leggerla. Le righe rosse sono i confini fra una colonna e l altra, la riga
              blu la fine del blocco dei giorni, la fascia verde tratteggiata la cucitura fra la
              prima e la seconda metà del mese. Devono cadere sui filetti stampati: se non ci
              cadono, rifai la foto inquadrando solo la griglia e più dritta possibile.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- l immagine è privata e servita da una route con autorizzazione: next/image non la ottimizzerebbe comunque */}
            <img
              src={`/api/rosters/${id}/preview`}
              alt="Anteprima dei tagli sulla foto della tabella"
              className="w-full rounded-lg border"
            />
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              La foto contiene i turni di tutte le colleghe. Premendo il bottone la mandi al
              servizio di lettura automatica, una porzione alla volta: una decina di letture da un
              minuto ciascuna. Puoi chiudere la pagina e tornare dopo.
            </div>
            <form action={`/api/rosters/${id}/extract`} method="post">
              <button
                type="submit"
                className="w-full rounded-xl bg-primary px-4 py-4 text-base font-medium text-primary-foreground"
              >
                Manda a leggere e comincia
              </button>
            </form>
          </CardContent>
        </Card>
      )}

      {inCorso && (
        <Card>
          <CardHeader>
            <CardTitle>Lettura in corso</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ExtractionProgress
              rosterId={id}
              initial={{
                status: progresso.status,
                bandsTotal: progresso.bandsTotal,
                bandsDone: progresso.bandsDone,
                bandsFailed: progresso.bandsFailed,
                missingBands: progresso.missingBands,
              }}
            />
            {roster.status === 'interrupted' && (
              <form action={`/api/rosters/${id}/extract`} method="post">
                <button
                  type="submit"
                  className="w-full rounded-xl border px-4 py-3 text-sm font-medium"
                >
                  Riprendi adesso
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {conclusa && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Risultato della lettura
              {roster.status === 'extracted' && <Badge>completa</Badge>}
              {roster.status === 'partial' && <Badge variant="destructive">incompleta</Badge>}
              {roster.status === 'failed' && <Badge variant="destructive">non riuscita</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Turni letti</dt>
                <dd className="text-lg font-medium">{progresso.cells}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Letture completate</dt>
                <dd className="text-lg font-medium">
                  {progresso.bandsDone} di {progresso.bandsTotal}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Correzioni a penna</dt>
                <dd className="text-lg font-medium">{progresso.handCorrected}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Letture discordanti</dt>
                <dd className="text-lg font-medium">{progresso.conflicted}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Codici sconosciuti</dt>
                <dd className="text-lg font-medium">{progresso.unknownCodes}</dd>
              </div>
            </dl>
            {progresso.handCorrected > 0 && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <strong>
                  {progresso.handCorrected}{' '}
                  {progresso.handCorrected === 1 ? 'cella corretta' : 'celle corrette'} a penna
                </strong>
                : sono quelle da rileggere sulla foto. È l unico punto in cui il lettore
                automatico sbaglia davvero, e le trova tutte. Sono già evidenziate nella griglia
                di conferma di ogni colonna.
              </p>
            )}
            {progresso.unknownCodes > 0 && (
              <p className="text-sm text-muted-foreground">
                I codici che la legenda non conosce restano da risolvere: aggiungili in{' '}
                <Link href="/settings/codes" className="underline">
                  Codici turno
                </Link>{' '}
                e non serve rileggere la tabella.
              </p>
            )}
            {(roster.status === 'partial' || roster.status === 'failed') && fotoDisponibile && (
              <form action={`/api/rosters/${id}/extract`} method="post">
                <button
                  type="submit"
                  className="w-full rounded-xl border px-4 py-3 text-sm font-medium"
                >
                  Riprova le letture che mancano
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {bandeNonLette.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Parti non lette
              {buchiDaPersone.length > 0 ? (
                <Badge variant="destructive">{buchiDaPersone.length} da controllare</Badge>
              ) : (
                <Badge variant="outline">solo colonne di servizio</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="space-y-2">
              {bandeNonLette.map((banda) => (
                <li
                  key={banda.index}
                  className={
                    banda.serviceOnly
                      ? 'rounded-lg bg-muted p-3 text-muted-foreground'
                      : 'rounded-lg bg-destructive/10 p-3'
                  }
                >
                  <p>{banda.description}</p>
                  {banda.error && (
                    <p className="mt-1 text-xs text-muted-foreground">Motivo: {banda.error}</p>
                  )}
                  {banda.status === 'pending' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Questa lettura non è ancora stata fatta.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {copertura.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Colonne lette
              {colonneIncomplete.length > 0 && (
                <Badge variant="destructive">{colonneIncomplete.length} incomplete</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Un giorno mancante è un turno che non è stato letto. Le colonne di servizio non sono
              turni di nessuno e non contano.
            </p>
            <ul className="divide-y text-sm">
              {copertura.map((colonna) => {
                const alias = aliases.find(
                  (a) => normalizeColumn(a.label) === normalizeColumn(colonna.columnLabel),
                )
                return (
                  <li key={colonna.columnLabel} className="flex flex-wrap gap-2 py-3">
                    <span className="min-w-32 font-medium">{colonna.columnLabel}</span>
                    {colonna.ignored ? (
                      <Badge variant="outline">colonna di servizio</Badge>
                    ) : colonna.missingDays.length === 0 ? (
                      <Badge variant="secondary">
                        {colonna.daysRead} giorni, completa
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        mancano i giorni {colonna.missingDays.join(', ')}
                      </Badge>
                    )}
                    {!colonna.ignored && !alias?.userId && (
                      <Badge variant="outline">da assegnare</Badge>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <nav className="grid gap-3">
        <Link
          href={`/rosters/${id}/columns`}
          className="rounded-xl border px-4 py-4 text-center text-base font-medium"
        >
          Colonne e persone
        </Link>
        <Link
          href={`/rosters/${id}/review`}
          className="rounded-xl border px-4 py-4 text-center text-base font-medium"
        >
          Conferma i turni
        </Link>
        {fotoDisponibile && (
          <a
            href={`/api/rosters/${id}/image`}
            className="rounded-xl border px-4 py-4 text-center text-base font-medium"
          >
            Guarda la foto originale
          </a>
        )}
      </nav>
    </main>
  )
}
