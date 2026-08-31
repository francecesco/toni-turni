import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { EmptyState } from '@/components/empty-state'
import { romeYearMonth } from '@/lib/time'
import { menuItemsFor, requireUser } from '@/modules/auth'
import { landingRoster, reviewableRosters } from '@/modules/review'

export const dynamic = 'force-dynamic'

/**
 * L app si apre sui turni del mese in corso: zero tocchi fra l apertura e il
 * motivo per cui è stata aperta. Non c è più una home di bottoni — le voci della
 * referente stanno nel menu ⋯ dell intestazione.
 */
export default async function HomePage() {
  const user = await requireUser()
  const tabelle = await reviewableRosters(user)
  const scelta = landingRoster(tabelle, romeYearMonth(new Date()))

  if (scelta) redirect(`/rosters/${scelta.id}/review`)

  const referente = user.role === 'REFERENTE'

  return (
    <>
      <AppHeader title="Turni" menuItems={menuItemsFor(user)} />
      <main className="flex flex-1 items-center px-safe pb-10">
        <EmptyState
          title="Non c è ancora nessuna tabella"
          action={referente ? { href: '/rosters/upload', label: 'Carica la foto del mese' } : undefined}
        >
          {referente ? (
            <p>Fotografa la tabella appesa in reparto e caricala: la lettura ci mette un paio di minuti.</p>
          ) : (
            <p>
              Quando la referente carica la tabella del mese, i tuoi turni compaiono qui e ti basterà
              confermarli.
            </p>
          )}
        </EmptyState>
      </main>
    </>
  )
}
