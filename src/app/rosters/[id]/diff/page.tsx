import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { Banner } from '@/components/banner'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/empty-state'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { requireReferente } from '@/modules/auth'
import { compactCode } from '@/modules/codes'
import { cellsForDiff, previousVersionOf } from '@/modules/roster'
import { diffVersions, listColumnAliases, type VersionChange } from '@/modules/review'
import { describeChange } from '../review/changes-box'

export const dynamic = 'force-dynamic'

/**
 * Il diff completo fra questa versione e la precedente: tutte le colonne, per
 * giorno, con «prima → dopo» e se la persona ha già riconfermato il valore
 * nuovo. Solo la referente (decisione del proprietario): `requireReferente`
 * rimanda alla home chiunque altro, lato server. Le versioni vecchie non si
 * consultano: conta solo l ultima, e questa pagina dice cosa è cambiato per
 * arrivarci.
 */
export default async function DiffPage({ params }: { params: Promise<{ id: string }> }) {
  await requireReferente()
  const { id } = await params

  const roster = await prisma.roster.findUnique({
    where: { id },
    select: { id: true, year: true, month: true, ward: true, version: true, status: true },
  })
  if (!roster) notFound()

  const header = (
    <AppHeader
      title="Cosa è cambiato"
      subtitle={`${monthLabel(roster.year, roster.month)} · ${roster.ward} · versione ${roster.version}`}
      backHref={`/rosters/${roster.id}/review`}
    />
  )

  const precedente = await previousVersionOf(roster.id)
  if (!precedente) {
    return (
      <>
        {header}
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-6">
          <EmptyState title="Questa è la prima foto del mese">
            Non c’è una foto precedente con cui confrontarla. Quando ne caricherai un’altra dello
            stesso mese, qui vedrai le differenze.
          </EmptyState>
        </main>
      </>
    )
  }

  const [celleNuove, cellePrecedenti, aliases, assegnazioni] = await Promise.all([
    cellsForDiff(roster.id),
    cellsForDiff(precedente.id),
    listColumnAliases(),
    prisma.assignment.findMany({
      where: { rosterId: roster.id, confirmedAt: { not: null } },
      select: { userId: true, day: true, code: true },
    }),
  ])
  // Lettura parziale (banda non letta): un giorno mancante può non essere stato
  // letto, non è detto che il foglio non abbia più il turno. Dichiararlo «tolto»
  // insegnerebbe a fidarsi di un allarme falso (vedi I2 nel rapporto della revisione).
  const lettoPerIntero = roster.status === 'extracted'
  const cambiamenti = diffVersions(cellePrecedenti, celleNuove).filter(
    (c) => lettoPerIntero || c.kind !== 'removed',
  )

  // «Ha già riconfermato»: la persona della colonna ha un assegnazione confermata
  // per quel giorno con il codice nuovo.
  const utentePerColonna = new Map(aliases.filter((a) => !a.ignored && a.userId).map((a) => [a.label, a.userId as string]))
  const confermaPer = (c: VersionChange): boolean => {
    const userId = utentePerColonna.get(c.columnKey)
    if (!userId || c.after === null) return false
    return assegnazioni.some((a) => a.userId === userId && a.day === c.day && compactCode(a.code) === compactCode(c.after ?? ''))
  }

  const perColonna = new Map<string, VersionChange[]>()
  for (const c of cambiamenti) {
    const lista = perColonna.get(c.columnLabel) ?? []
    lista.push(c)
    perColonna.set(c.columnLabel, lista)
  }

  return (
    <>
      {header}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-6">
        <p className="text-muted-foreground text-sm">
          Confronto con la versione {precedente.version}. Le colonne di servizio e i totali non
          compaiono.
        </p>
        {!lettoPerIntero && (
          <Banner variant="warn">
            Lettura parziale: alcune parti della foto non sono state lette. I turni che non
            compaiono non sono elencati come tolti, perché potrebbero non essere stati letti.
          </Banner>
        )}
        {cambiamenti.length === 0 ? (
          <EmptyState title="Nessuna differenza rispetto alla foto precedente">
            Le due letture coincidono cella per cella: nessuna differenza da rivedere. Le conferme
            già date sono passate a questa versione.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...perColonna.entries()].map(([colonna, lista]) => (
              <li key={colonna} className="bg-card border-border rounded-2xl border px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold">{colonna}</span>
                  <Badge variant="secondary">
                    {lista.length} {lista.length === 1 ? 'giorno' : 'giorni'}
                  </Badge>
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {lista.map((c) => (
                    <li key={`${c.columnKey}:${c.day}`} className="flex items-center justify-between gap-2 text-sm tabular">
                      <span>{describeChange(c)}</span>
                      {confermaPer(c) ? (
                        <Badge variant="default">riconfermato</Badge>
                      ) : (
                        <Badge variant="outline">da riconfermare</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
