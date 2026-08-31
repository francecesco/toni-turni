import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { Banner } from '@/components/banner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { requireReferente } from '@/modules/auth'
import { isColonnaDiServizio, normalizeColumn } from '@/modules/extract'
import { listColumnAliases, rosterColumnLabels } from '@/modules/review'
import { saveColumnAlias } from './actions'

export const dynamic = 'force-dynamic'

export default async function RosterColumnsPage({
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
    select: { id: true, year: true, month: true, ward: true },
  })
  if (!roster) notFound()

  const [etichette, aliases, utenti] = await Promise.all([
    rosterColumnLabels(id),
    listColumnAliases(),
    prisma.user.findMany({ orderBy: { displayName: 'asc' } }),
  ])
  // Gli alias sono chiavati sull identità della colonna (`normalizeColumn`), non
  // sul testo letto: è così che l associazione fatta su `SARA DP.` vale anche per
  // `SARA DP`.
  const perLabel = new Map(aliases.map((a) => [normalizeColumn(a.label), a]))

  return (
    <>
      <AppHeader
        title="Colonne e persone"
        backHref={`/rosters/${id}`}
        subtitle={`${monthLabel(roster.year, roster.month)} · ${roster.ward}`}
      />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-10">
        <p className="text-muted-foreground text-sm">
          Associa il nome scritto sulla tabella alla persona che usa l app. L associazione si fa
          una volta e vale anche per i mesi successivi. Una colonna non associata non blocca
          niente: resta da assegnare.
        </p>

        {error && <Banner variant="error">{error}</Banner>}

        {etichette.length === 0 ? (
          <div className="bg-card border-border text-muted-foreground rounded-2xl border px-4 py-3 text-sm shadow-sm">
            Nessuna colonna letta finora: la lettura della tabella non è ancora arrivata a nessuna
            intestazione.
          </div>
        ) : (
          <ul className="space-y-3">
            {etichette.map((label) => {
              const alias = perLabel.get(normalizeColumn(label))
              const attuale = alias?.ignored ? 'ignora' : (alias?.userId ?? '')
              const suggerita = alias === undefined && isColonnaDiServizio(label)

              return (
                <li key={label} className="bg-card border-border rounded-2xl border px-4 py-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{label}</span>
                    {alias?.ignored && <Badge variant="outline">colonna di servizio</Badge>}
                    {!alias?.ignored && !alias?.userId && (
                      <Badge variant="secondary">da assegnare</Badge>
                    )}
                    {suggerita && <Badge variant="outline">sembra una colonna di servizio</Badge>}
                  </div>
                  <form action={saveColumnAlias} className="mt-3 flex flex-wrap items-center gap-3">
                    <input type="hidden" name="rosterId" value={id} />
                    <input type="hidden" name="label" value={label} />
                    <label className="sr-only" htmlFor={`user-${label}`}>
                      Persona associata a {label}
                    </label>
                    <select
                      id={`user-${label}`}
                      name="userId"
                      defaultValue={attuale}
                      className="border-input bg-background h-11 min-w-0 flex-1 rounded-lg border px-3 text-base"
                    >
                      <option value="">Da assegnare</option>
                      {utenti.map((utente) => (
                        <option key={utente.id} value={utente.id}>
                          {utente.displayName} ({utente.email})
                        </option>
                      ))}
                      <option value="ignora">Non è un turno (aiuti, totali)</option>
                    </select>
                    <Button type="submit" size="touch" className="shrink-0">
                      Salva
                    </Button>
                  </form>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </>
  )
}
