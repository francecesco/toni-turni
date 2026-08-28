import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { requireReferente } from '@/modules/auth'
import { isNonNurseLabel, listColumnAliases, rosterColumnLabels } from '@/modules/review'
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
  const perLabel = new Map(aliases.map((a) => [a.label, a]))

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 pb-24">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href={`/rosters/${id}`} className="underline">
            {monthLabel(roster.year, roster.month)} · {roster.ward}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Colonne e persone</h1>
        <p className="text-sm text-muted-foreground">
          Associa il nome scritto sulla tabella alla persona che usa l app.
          L associazione si fa una volta e vale anche per i mesi successivi. Una colonna non
          associata non blocca niente: resta da assegnare.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {etichette.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            Nessuna colonna letta finora: la lettura della tabella non è ancora arrivata a
            nessuna intestazione.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {etichette.map((label) => {
            const alias = perLabel.get(label)
            const attuale = alias?.ignored ? 'ignora' : (alias?.userId ?? '')
            const suggerita = alias === undefined && isNonNurseLabel(label)

            return (
              <li key={label}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{label}</span>
                      {alias?.ignored && <Badge variant="outline">colonna di servizio</Badge>}
                      {!alias?.ignored && !alias?.userId && (
                        <Badge variant="secondary">da assegnare</Badge>
                      )}
                      {suggerita && <Badge variant="outline">sembra una colonna di servizio</Badge>}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form action={saveColumnAlias} className="flex flex-wrap items-center gap-3">
                      <input type="hidden" name="rosterId" value={id} />
                      <input type="hidden" name="label" value={label} />
                      <label className="sr-only" htmlFor={`user-${label}`}>
                        Persona associata a {label}
                      </label>
                      <select
                        id={`user-${label}`}
                        name="userId"
                        defaultValue={attuale}
                        className="min-w-48 flex-1 rounded-lg border p-3 text-base"
                      >
                        <option value="">Da assegnare</option>
                        {utenti.map((utente) => (
                          <option key={utente.id} value={utente.id}>
                            {utente.displayName} ({utente.email})
                          </option>
                        ))}
                        <option value="ignora">Non è un turno (aiuti, totali)</option>
                      </select>
                      <button
                        type="submit"
                        className="rounded-xl bg-primary px-5 py-3 text-base font-medium text-primary-foreground"
                      >
                        Salva
                      </button>
                    </form>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
