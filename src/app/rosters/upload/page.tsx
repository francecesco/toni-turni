import Link from 'next/link'
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
    <main className="mx-auto max-w-xl space-y-6 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Carica la tabella</h1>
        <p className="text-sm text-muted-foreground">
          Fotografa la tabella <strong>inquadrando solo la griglia</strong>, il più possibile
          dritta: i bordi e le colonne li riconosce l app da sola, ma solo se la griglia si vede
          tutta. La foto resta su questo server: verrà mandata al servizio di lettura solo quando
          lo chiederai tu, dal passo successivo, e prima potrai controllare i tagli.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <form
        action="/api/rosters"
        method="post"
        encType="multipart/form-data"
        className="space-y-5"
      >
        <div className="space-y-2">
          <label htmlFor="photo" className="block text-sm font-medium">
            Foto della tabella
          </label>
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/*"
            required
            className="w-full rounded-lg border p-3 text-sm"
          />
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
              className="w-full rounded-lg border p-3 text-base"
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
              className="w-full rounded-lg border p-3 text-base"
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
            className="w-full rounded-lg border p-3 text-base"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-xl bg-primary px-4 py-4 text-base font-medium text-primary-foreground"
        >
          Carica
        </button>
      </form>

      <Link href="/rosters" className="block text-center text-sm underline">
        Torna alle tabelle
      </Link>
    </main>
  )
}
