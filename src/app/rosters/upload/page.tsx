import { CameraIcon } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { Banner } from '@/components/banner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { prisma } from '@/lib/db'
import { romeYearMonth } from '@/lib/time'
import { requireReferente } from '@/modules/auth'

export const dynamic = 'force-dynamic'

/**
 * Il mese che si sta per pianificare è normalmente il prossimo. Il mese di
 * partenza si legge col fuso di Roma (`romeYearMonth`), non con quello del
 * processo: in un container UTC, alle 00:30 del 1° settembre a Roma il valore
 * precompilato sarebbe altrimenti settembre invece di ottobre.
 */
function prossimoMese(oggi: Date): { year: number; month: number } {
  const { year, month } = romeYearMonth(oggi)
  const prossimo = month + 1
  return prossimo > 12 ? { year: year + 1, month: prossimo - 12 } : { year, month: prossimo }
}

export default async function UploadRosterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireReferente()
  const { error } = await searchParams

  // I valori dell ultimo caricamento sono quasi sempre quelli giusti anche stavolta.
  const ultima = await prisma.roster.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { ward: true },
  })
  const { year, month } = prossimoMese(new Date())

  return (
    <>
      <AppHeader title="Carica la tabella" backHref="/rosters" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-safe pb-10">
        <p className="text-muted-foreground text-sm">
          Fotografa la tabella <strong>inquadrando solo la griglia</strong>, il più possibile
          dritta: i bordi e le colonne li riconosce l app da sola, ma solo se la griglia si vede
          tutta. La foto resta su questo server: verrà mandata al servizio di lettura solo quando
          lo chiederai tu, dal passo successivo, e prima potrai controllare i tagli.
        </p>

        {error && <Banner variant="error">{error}</Banner>}

        <form action="/api/rosters" method="post" encType="multipart/form-data" className="space-y-5">
          <div className="space-y-2">
            {/* Tutto il riquadro è il bersaglio, non solo la scritta: la label avvolge
                l intero blocco tratteggiato, così il tocco apre il rullino da qualunque
                punto ci si posi — non solo sulle due righe di testo. */}
            <label
              htmlFor="photo"
              className="border-border bg-card flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center"
            >
              <CameraIcon className="text-muted-foreground size-8" />
              <div>
                <p className="font-semibold">Scegli la foto della tabella</p>
                <p className="text-muted-foreground text-sm">
                  Inquadra tutto il riquadro stampato, il più in piano possibile.
                </p>
              </div>
              {/* Input vero e visibile, non `sr-only`: il nome del file scelto lo mostra il
                  browser da sé, e il messaggio di `required` (se si annulla la scelta) si
                  ancora a un elemento che si vede, non a un pixel clippato fuori schermo.
                  Il bottone nativo torna a un altezza da tocco (44px, non i 24px di
                  `file:h-6`), anche se ormai basta appoggiare il dito ovunque nel riquadro. */}
              <Input
                id="photo"
                name="photo"
                type="file"
                accept="image/*"
                required
                className="h-11 w-auto border-0 bg-transparent p-0 text-sm file:h-11"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="month" className="block text-sm font-medium">
                Mese
              </label>
              <Input id="month" name="month" type="number" min={1} max={12} defaultValue={month} required />
            </div>
            <div className="space-y-2">
              <label htmlFor="year" className="block text-sm font-medium">
                Anno
              </label>
              <Input id="year" name="year" type="number" min={2020} max={2100} defaultValue={year} required />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="ward" className="block text-sm font-medium">
              Reparto
            </label>
            <Input id="ward" name="ward" defaultValue={ultima?.ward ?? '3°PIANO'} required />
          </div>

          <Button type="submit" size="touch" className="w-full">
            Carica
          </Button>
        </form>
      </main>
    </>
  )
}
