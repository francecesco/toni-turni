import { CameraIcon } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { Banner } from '@/components/banner'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/db'
import { requireReferente } from '@/modules/auth'

export const dynamic = 'force-dynamic'

/** Il mese che si sta per pianificare è normalmente il prossimo. */
function prossimoMese(oggi: Date): { year: number; month: number } {
  const mese = oggi.getMonth() + 2
  return mese > 12
    ? { year: oggi.getFullYear() + 1, month: mese - 12 }
    : { year: oggi.getFullYear(), month: mese }
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
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-safe pb-10">
        <p className="text-muted-foreground text-sm">
          Fotografa la tabella <strong>inquadrando solo la griglia</strong>, il più possibile
          dritta: i bordi e le colonne li riconosce l app da sola, ma solo se la griglia si vede
          tutta. La foto resta su questo server: verrà mandata al servizio di lettura solo quando
          lo chiederai tu, dal passo successivo, e prima potrai controllare i tagli.
        </p>

        {error && <Banner variant="error">{error}</Banner>}

        <form action="/api/rosters" method="post" encType="multipart/form-data" className="space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="photo"
              className="border-border bg-card flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center"
            >
              <CameraIcon className="text-muted-foreground size-8" />
              <span className="font-semibold">Scegli la foto della tabella</span>
              <span className="text-muted-foreground text-sm">
                Inquadra tutto il riquadro stampato, il più in piano possibile.
              </span>
            </label>
            <input id="photo" name="photo" type="file" accept="image/*" required className="sr-only" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="month" className="block text-sm font-medium">
                Mese
              </label>
              <input
                id="month"
                name="month"
                type="number"
                min={1}
                max={12}
                defaultValue={month}
                required
                className="border-input bg-background h-11 w-full rounded-lg border p-3 text-base"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="year" className="block text-sm font-medium">
                Anno
              </label>
              <input
                id="year"
                name="year"
                type="number"
                min={2020}
                max={2100}
                defaultValue={year}
                required
                className="border-input bg-background h-11 w-full rounded-lg border p-3 text-base"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="ward" className="block text-sm font-medium">
              Reparto
            </label>
            <input
              id="ward"
              name="ward"
              defaultValue={ultima?.ward ?? '3°PIANO'}
              required
              className="border-input bg-background h-11 w-full rounded-lg border p-3 text-base"
            />
          </div>

          <Button type="submit" size="touch" className="w-full">
            Carica
          </Button>
        </form>
      </main>
    </>
  )
}
