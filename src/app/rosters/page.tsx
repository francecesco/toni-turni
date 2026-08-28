import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { monthLabel } from '@/lib/time'
import { requireUser } from '@/modules/auth'
import { ensureExtractionWorker } from '@/modules/roster'
import { reviewableRosters } from '@/modules/review'

export const dynamic = 'force-dynamic'

const ETICHETTE_STATO: Record<string, { testo: string; variante: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  uploaded: { testo: 'da estrarre', variante: 'outline' },
  extracting: { testo: 'estrazione in corso', variante: 'secondary' },
  interrupted: { testo: 'estrazione interrotta', variante: 'destructive' },
  extracted: { testo: 'letta', variante: 'default' },
  partial: { testo: 'letta in parte', variante: 'destructive' },
  failed: { testo: 'non letta', variante: 'destructive' },
}

export default async function RostersPage() {
  const user = await requireUser()

  // Se il processo è stato riavviato mentre un estrazione era a metà, è qui che
  // riprende: nessuno deve ricordarsi di premere niente.
  void ensureExtractionWorker()

  const tabelle = await reviewableRosters(user)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Tabelle turni</h1>
        <p className="text-sm text-muted-foreground">
          {user.role === 'REFERENTE'
            ? 'Carica la foto della tabella, controlla la lettura e conferma la tua colonna.'
            : 'Qui trovi i mesi da confermare. Vedi soltanto la tua colonna.'}
        </p>
      </header>

      {user.role === 'REFERENTE' && (
        <Link
          href="/rosters/upload"
          className="block rounded-xl bg-primary px-4 py-4 text-center text-base font-medium text-primary-foreground"
        >
          Carica la foto di un mese
        </Link>
      )}

      {tabelle.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">
            {user.role === 'REFERENTE'
              ? 'Nessuna tabella caricata finora.'
              : 'Nessun mese da confermare. Se aspetti dei turni, chiedi alla referente di associare la tua colonna.'}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {tabelle.map((tabella) => {
            const stato = ETICHETTE_STATO[tabella.status] ?? {
              testo: tabella.status,
              variante: 'outline' as const,
            }
            const destinazione =
              user.role === 'REFERENTE'
                ? `/rosters/${tabella.id}`
                : `/rosters/${tabella.id}/review`

            return (
              <li key={tabella.id}>
                <Link href={destinazione} className="block">
                  <Card className="transition-colors hover:bg-muted/50">
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        <span className="capitalize">{monthLabel(tabella.year, tabella.month)}</span>
                        <Badge variant={stato.variante}>{stato.testo}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {tabella.ward}
                      {tabella.version > 1 && ` · versione ${tabella.version}`}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
