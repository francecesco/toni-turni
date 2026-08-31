import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { Banner } from '@/components/banner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { menuItemsFor, requireReferente } from '@/modules/auth'
import { extractionStrategyFromEnv, normalizeColumn } from '@/modules/extract'
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
  const user = await requireReferente()
  const { id } = await params
  const { error } = await searchParams
  // Quanto durera la lettura dipende dalla strategia, e dire "una decina di
  // letture da un minuto" quando ne parte una sola insegna a non fidarsi
  // dell avviso.
  const strategia = extractionStrategyFromEnv()

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
    <>
      <AppHeader
        title={monthLabel(roster.year, roster.month)}
        backHref="/rosters"
        subtitle={`${roster.ward}${roster.version > 1 ? ` · versione ${roster.version}` : ''}${roster.provider ? ` · letta con ${roster.provider}` : ''}`}
        menuItems={menuItemsFor(user)}
      />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-safe pb-10">
        {error && <Banner variant="error">{error}</Banner>}

        {roster.error && <Banner variant="error">{roster.error}</Banner>}

        {!fotoDisponibile && (
          <Banner variant="info">
            La foto non è più sul server: è stata cancellata dalla conservazione automatica. I
            turni già letti restano, ma non è più possibile rileggere la tabella.
          </Banner>
        )}

        {daEstrarre && fotoDisponibile && (
          <section className="bg-card space-y-4 rounded-2xl px-4 py-4 shadow-sm">
            <h2 className="text-base font-bold">Controlla i tagli, poi manda a leggere</h2>
            <p className="text-muted-foreground text-sm">
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
              className="w-full rounded-2xl border border-border"
            />
            <Banner variant="warn">
              La foto contiene i turni di tutte le colleghe. Premendo il bottone la mandi al
              servizio di lettura automatica.{' '}
              {strategia === 'whole'
                ? 'È una lettura sola e ci vuole meno di un minuto.'
                : 'Una porzione alla volta: una decina di letture da un minuto ciascuna.'}{' '}
              Puoi chiudere la pagina e tornare dopo.
            </Banner>
            <form action={`/api/rosters/${id}/extract`} method="post">
              <Button type="submit" size="touch" className="w-full">
                Manda a leggere e comincia
              </Button>
            </form>
          </section>
        )}

        {inCorso && (
          <section className="bg-card space-y-4 rounded-2xl px-4 py-4 shadow-sm">
            <h2 className="text-base font-bold">Lettura in corso</h2>
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
                <Button type="submit" size="touch" variant="outline" className="w-full">
                  Riprendi adesso
                </Button>
              </form>
            )}
          </section>
        )}

        {conclusa && (
          <section className="bg-card space-y-4 rounded-2xl px-4 py-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Risultato della lettura</h2>
              {roster.status === 'extracted' && <Badge>completa</Badge>}
              {roster.status === 'partial' && <Badge variant="destructive">incompleta</Badge>}
              {roster.status === 'failed' && <Badge variant="destructive">non riuscita</Badge>}
            </div>
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
              <Banner variant="warn">
                <strong>
                  {progresso.handCorrected}{' '}
                  {progresso.handCorrected === 1 ? 'cella corretta' : 'celle corrette'} a penna
                </strong>
                : sono quelle da rileggere sulla foto. È l unico punto in cui il lettore
                automatico sbaglia davvero, e le trova tutte. Sono già evidenziate nella griglia
                di conferma di ogni colonna.
              </Banner>
            )}
            {progresso.unknownCodes > 0 && (
              <p className="text-muted-foreground text-sm">
                I codici che la legenda non conosce restano da risolvere: aggiungili in{' '}
                <Link href="/settings/codes" className="underline">
                  Codici turno
                </Link>{' '}
                e non serve rileggere la tabella.
              </p>
            )}
            {(roster.status === 'partial' || roster.status === 'failed') && fotoDisponibile && (
              <form action={`/api/rosters/${id}/extract`} method="post">
                <Button type="submit" size="touch" variant="outline" className="w-full">
                  Riprova le letture che mancano
                </Button>
              </form>
            )}
          </section>
        )}

        {bandeNonLette.length > 0 && (
          <section className="bg-card space-y-3 rounded-2xl px-4 py-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Parti non lette</h2>
              {buchiDaPersone.length > 0 ? (
                <Badge variant="destructive">{buchiDaPersone.length} da controllare</Badge>
              ) : (
                <Badge variant="outline">solo colonne di servizio</Badge>
              )}
            </div>
            <ul className="space-y-2 text-sm">
              {bandeNonLette.map((banda) => (
                <li
                  key={banda.index}
                  className={
                    banda.serviceOnly
                      ? 'bg-muted text-muted-foreground rounded-lg p-3'
                      : 'bg-destructive/10 rounded-lg p-3'
                  }
                >
                  <p>{banda.description}</p>
                  {banda.error && (
                    <p className="text-muted-foreground mt-1 text-xs">Motivo: {banda.error}</p>
                  )}
                  {banda.status === 'pending' && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Questa lettura non è ancora stata fatta.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {copertura.length > 0 && (
          <section className="bg-card space-y-3 rounded-2xl px-4 py-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Colonne lette</h2>
              {colonneIncomplete.length > 0 && (
                <Badge variant="destructive">{colonneIncomplete.length} incomplete</Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              Un giorno mancante è un turno che non è stato letto. Le colonne di servizio non sono
              turni di nessuno e non contano.
            </p>
            <ul className="divide-border divide-y text-sm">
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
                      <Badge variant="secondary">{colonna.daysRead} giorni, completa</Badge>
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
          </section>
        )}

        <nav className="grid gap-3">
          <Button
            size="touch"
            variant="outline"
            className="w-full"
            render={<Link href={`/rosters/${id}/columns`} />}
            nativeButton={false}
          >
            Colonne e persone
          </Button>
          <Button
            size="touch"
            variant="outline"
            className="w-full"
            render={<Link href={`/rosters/${id}/review`} />}
            nativeButton={false}
          >
            Conferma i turni
          </Button>
          {fotoDisponibile && (
            <Button
              size="touch"
              variant="outline"
              className="w-full"
              render={<a href={`/api/rosters/${id}/image`} />}
              nativeButton={false}
            >
              Guarda la foto originale
            </Button>
          )}
        </nav>
      </main>
    </>
  )
}
