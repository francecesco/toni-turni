import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { ActionDock } from '@/components/action-dock'
import { Banner } from '@/components/banner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { menuItemsFor, requireUser } from '@/modules/auth'
import { listShiftCodes } from '@/modules/codes'
import { normalizeColumn } from '@/modules/extract'
import {
  aliasFor,
  buildColumnGrid,
  canSeeColumn,
  columnAssignments,
  defaultColumn,
  describeUnreadBands,
  diffVersions,
  filterChangesByCoverage,
  gridSummary,
  listColumnAliases,
  rosterColumnLabels,
  visibleColumns,
} from '@/modules/review'
import { cellsForDiff, previousVersionOf } from '@/modules/roster'
import {
  confirmColumnAction,
  syncColumnAction,
  relinkCalendarAction,
} from './actions'
import { ChangesBox } from './changes-box'
import { ColumnSummary } from './column-summary'
import { DayRow } from './day-row'
import { SyncButton } from './sync-button'

export const dynamic = 'force-dynamic'

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
    calendarMissing?: string
  }>
}) {
  const user = await requireUser()
  const { id } = await params
  const { colonna, error, ok, sync, reauth, calendarMissing } = await searchParams

  const roster = await prisma.roster.findUnique({
    where: { id },
    include: { bands: { orderBy: { index: 'asc' } } },
  })
  if (!roster) notFound()

  // Solo la referente vede la voce delle colonne: è lei che associa una persona a
  // una colonna, e senza questa voce quella pagina non era più raggiungibile da
  // nessun punto dell interfaccia dopo l atterraggio del Task 7. Nascondere la
  // voce non autorizza niente: il controllo vero resta in `columns/actions.ts`
  // (`requireReferente`).
  const menuItems =
    user.role === 'REFERENTE'
      ? [
          ...menuItemsFor(user),
          { href: `/rosters/${roster.id}/columns`, label: 'Colonne e persone' },
          // Solo da una seconda versione: sulla prima non c è niente con cui confrontare.
          ...(roster.version > 1 ? [{ href: `/rosters/${roster.id}/diff`, label: 'Cosa è cambiato' }] : []),
        ]
      : menuItemsFor(user)

  const [etichette, aliases, codes] = await Promise.all([
    rosterColumnLabels(id),
    listColumnAliases(),
    listShiftCodes(),
  ])
  const visibili = visibleColumns(user, etichette, aliases)

  // Fra le colonne visibili, preferisce quella della persona che guarda: senza
  // questo la referente (che le vede tutte) atterrava sulla prima in ordine
  // alfabetico, quasi sempre la colonna di un'altra.
  const scelta = colonna && visibili.includes(colonna) ? colonna : defaultColumn(user, visibili, aliases)

  const header = (
    <AppHeader
      title={monthLabel(roster.year, roster.month)}
      subtitle={`${roster.ward}${roster.version > 1 ? ` · versione ${roster.version}` : ''}${scelta ? ` · ${scelta}` : ''}`}
      pickerHref="/rosters"
      menuItems={menuItems}
    />
  )

  if (scelta === null) {
    return (
      <>
        {header}
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-6">
          <EmptyState title="Non c’è ancora una colonna associata a te">
            Chiedi alla referente di associare il tuo nome alla colonna giusta: si fa una volta e
            vale anche per i mesi successivi.
          </EmptyState>
        </main>
      </>
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

  // Fase 5: il diff con la versione precedente, calcolato al volo. Sulla prima
  // versione è vuoto e il riquadro non si disegna.
  // Lettura parziale (banda non letta): un giorno mancante non è per forza «tolto
  // dal foglio», può essere un giorno non ancora letto — e un giorno che compare
  // solo ora non è per forza «nuovo», se era la lettura **precedente** a essere
  // parziale. La copertura per banda è rinviata alla Fase 6; qui la versione minima
  // onesta è tutto-o-niente su `status`.
  const sheetFullyRead = roster.status === 'extracted'
  const precedente = await previousVersionOf(id)
  const cambiamenti = precedente
    ? filterChangesByCoverage(diffVersions(await cellsForDiff(precedente.id), celle), {
        previousFullyRead: precedente.status === 'extracted',
        currentFullyRead: sheetFullyRead,
      })
    : []
  const cambiamentiDellaColonna = cambiamenti.filter((c) => c.columnKey === normalizeColumn(scelta))

  const righe = buildColumnGrid({
    year: roster.year,
    month: roster.month,
    columnLabel: scelta,
    cells: celle,
    codes,
    assignments: assegnazioni,
    changes: cambiamenti,
    sheetFullyRead,
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
    <>
      {header}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-6">
        {visibili.length > 1 && (
          <nav className="-mx-4 overflow-x-auto px-4">
            <div className="flex w-max gap-2 pb-1">
              {visibili.map((etichetta) => (
                <Link
                  key={etichetta}
                  href={`/rosters/${id}/review?colonna=${encodeURIComponent(etichetta)}`}
                  className={
                    etichetta === scelta
                      ? 'bg-primary text-primary-foreground flex h-11 items-center rounded-full px-4 text-sm font-semibold'
                      : 'border-border flex h-11 items-center rounded-full border px-4 text-sm'
                  }
                >
                  {etichetta}
                </Link>
              ))}
            </div>
          </nav>
        )}

        {error && <Banner variant="error">{error}</Banner>}
        {ok && <Banner variant="ok">{ok}</Banner>}

        {calendarMissing === '1' ? (
          <Banner variant="warn" title="Il calendario «Turni Toniolo» non esiste più su Google.">
            <p>
              L id salvato punta a un calendario che è stato cancellato. Per sicurezza l app non
              ne crea un altro da sola: se vuoi che lo ricrei, scollegalo qui e poi rimanda i
              turni. Se invece l hai cancellato per errore, su Google puoi ripristinarlo dal
              cestino dei calendari.
            </p>
            <form action={relinkCalendarAction} className="mt-2">
              <input type="hidden" name="rosterId" value={id} />
              <input type="hidden" name="columnLabel" value={scelta ?? ''} />
              <Button type="submit" size="touch">
                Ricollega il calendario
              </Button>
            </form>
          </Banner>
        ) : reauth === '1' ? (
          <Banner variant="warn" title="Il collegamento con Google va rinnovato.">
            <p>
              Non è un guasto e non hai perso niente: l app ha bisogno del tuo permesso per creare
              il calendario «Turni» e scriverci gli eventi, e quel permesso va dato di nuovo —
              succede anche a chi aveva già fatto l accesso prima di questa versione. I turni che
              hai confermato restano dove sono; dopo l autorizzazione torna qui e premi di nuovo il
              bottone.
            </p>
            <Button
              size="touch"
              className="mt-2"
              render={<a href="/api/auth/google/start" />}
              nativeButton={false}
            >
              Autorizza Google
            </Button>
          </Banner>
        ) : (
          sync && (
            <Banner variant="info" title="Esito del sync">
              {sync.split('\n').map((riga, indice) => (
                <p key={`${indice}-${riga}`} className="whitespace-pre-wrap">
                  {riga}
                </p>
              ))}
            </Banner>
          )
        )}

        <ColumnSummary
          columnLabel={scelta}
          summary={riassunto}
          canConfirm={puoConfermare}
          extracting={inLettura}
          unreadTouchingColumn={bandeCheToccanoQuestaColonna.length > 0}
          unknownBands={bandeIgnote.length > 0}
        />
        <ChangesBox changes={cambiamentiDellaColonna} />

        <ul className="flex flex-col gap-2">
          {righe.map((riga) => (
            <DayRow
              key={riga.day}
              row={riga}
              rosterId={id}
              columnLabel={scelta}
              codes={codes}
              canConfirm={puoConfermare}
              canCorrect={puoCorreggere}
            />
          ))}
        </ul>
      </main>

      {puoConfermare && (riassunto.confirmable > 0 || riassunto.confirmed > 0) && (
        <ActionDock note="Niente finisce sul calendario prima di questa conferma.">
          {riassunto.confirmable > 0 && (
            <form action={confirmColumnAction}>
              <input type="hidden" name="rosterId" value={id} />
              <input type="hidden" name="columnLabel" value={scelta} />
              <Button type="submit" size="touch" className="w-full">
                Confermo tutti i {riassunto.confirmable} turni
              </Button>
            </form>
          )}
          {/* Due decisioni, due bottoni. La conferma dice «ho letto e va bene», il sync
              dice «scrivilo sul mio calendario»: il secondo non parte mai da sé dopo il
              primo (regola invariante 1). */}
          {riassunto.confirmed > 0 && (
            <form action={syncColumnAction}>
              <input type="hidden" name="rosterId" value={id} />
              <input type="hidden" name="columnLabel" value={scelta} />
              <SyncButton shifts={riassunto.confirmed} synced={riassunto.synced} />
            </form>
          )}
        </ActionDock>
      )}
    </>
  )
}
