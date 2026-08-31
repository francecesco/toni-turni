import Link from 'next/link'
import { AppHeader } from '@/components/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { monthLabel, romeYearMonth } from '@/lib/time'
import { menuItemsFor, requireUser } from '@/modules/auth'
import { ensureExtractionWorker } from '@/modules/roster'
import { monthPickerEntries, reviewableRosters } from '@/modules/review'

export const dynamic = 'force-dynamic'

const ETICHETTE_STATO: Record<string, { testo: string; variante: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  uploaded: { testo: 'da estrarre', variante: 'outline' },
  extracting: { testo: 'estrazione in corso', variante: 'secondary' },
  interrupted: { testo: 'estrazione interrotta', variante: 'destructive' },
  extracted: { testo: 'letta', variante: 'default' },
  partial: { testo: 'letta in parte', variante: 'destructive' },
  failed: { testo: 'non letta', variante: 'destructive' },
}

/**
 * Il selettore dei mesi, dietro il chevron dell intestazione. Un mese per riga,
 * anche quando ha più versioni: la versione più alta è quella che conta, le
 * altre non sono voci separate (`monthPickerEntries`).
 */
export default async function RostersPage() {
  const user = await requireUser()

  // Se il processo è stato riavviato mentre un estrazione era a metà, è qui che
  // riprende: nessuno deve ricordarsi di premere niente.
  void ensureExtractionWorker()

  const tabelle = await reviewableRosters(user)
  const voci = monthPickerEntries(tabelle, romeYearMonth(new Date()))
  const statoPerId = new Map(tabelle.map((t) => [t.id, t.status]))
  const referente = user.role === 'REFERENTE'

  return (
    <>
      <AppHeader title="I mesi" backHref="/" menuItems={menuItemsFor(user)} />
      <main className="flex flex-1 flex-col pb-10">
        {voci.length === 0 ? (
          <div className="flex flex-1 items-center px-safe">
            <EmptyState title="Non c è ancora nessuna tabella">
              {referente ? (
                <p>Fotografa la tabella appesa in reparto e caricala: la lettura ci mette un paio di minuti.</p>
              ) : (
                <p>
                  Quando la referente carica la tabella del mese, i tuoi turni compaiono qui e ti basterà
                  confermarli.
                </p>
              )}
            </EmptyState>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl flex flex-col gap-3 px-safe pb-10">
            {voci.map((voce) => (
              <li key={voce.id}>
                <Link href={`/rosters/${voce.id}/review`}>
                  <div
                    className={[
                      'bg-card border-border flex min-h-16 items-center justify-between gap-3 rounded-2xl border px-4 py-3',
                      voce.current ? 'border-primary' : '',
                    ].join(' ')}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold capitalize">
                        {monthLabel(voce.year, voce.month)}
                      </p>
                      {voce.current && <p className="text-primary text-xs font-medium">mese in corso</p>}
                    </div>
                    <Badge variant={ETICHETTE_STATO[statoPerId.get(voce.id) ?? '']?.variante ?? 'outline'}>
                      {ETICHETTE_STATO[statoPerId.get(voce.id) ?? '']?.testo ?? 'sconosciuto'}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <form action="/api/auth/logout" method="post" className="mx-auto max-w-2xl px-safe pb-10">
          <Button type="submit" variant="ghost" size="touch" className="w-full">
            Esci
          </Button>
        </form>
      </main>
    </>
  )
}
