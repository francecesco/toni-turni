import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireReferente } from '@/modules/auth'
import { DEFAULT_DAY_COLUMN_FRACTION } from '@/modules/ingest'

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
    select: { ward: true, columnCount: true, dayColumnFraction: true },
  })
  const { year, month } = prossimoMese(new Date())

  return (
    <main className="mx-auto max-w-xl space-y-6 p-4 pb-24">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Carica la tabella</h1>
        <p className="text-sm text-muted-foreground">
          Fotografa la tabella <strong>inquadrando solo la griglia</strong>, il più possibile
          dritta. La foto resta su questo server: verrà mandata al servizio di lettura solo quando
          lo chiederai tu, dal passo successivo.
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

        <div className="space-y-2">
          <label htmlFor="columnCount" className="block text-sm font-medium">
            Quante colonne ha la tabella, oltre a quella dei giorni
          </label>
          <input
            id="columnCount"
            name="columnCount"
            type="number"
            min={1}
            max={40}
            defaultValue={ultima?.columnCount ?? 14}
            required
            className="w-full rounded-lg border p-3 text-base"
          />
          <p className="text-xs text-muted-foreground">
            Contale sulla foto comprese <span className="font-mono">AIUTO MATT.</span>,{' '}
            <span className="font-mono">TOT M</span> e simili: servono a capire dove tagliare, poi
            vengono scartate. Al passo successivo vedrai i tagli disegnati sulla foto e potrai
            correggere questo numero.
          </p>
        </div>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Ritaglio avanzato (serve solo se la foto non è ben inquadrata)
          </summary>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <label htmlFor="dayColumnFraction" className="block text-sm">
                Larghezza della colonna dei giorni, come frazione della tabella
              </label>
              <input
                id="dayColumnFraction"
                name="dayColumnFraction"
                defaultValue={ultima?.dayColumnFraction ?? DEFAULT_DAY_COLUMN_FRACTION}
                inputMode="decimal"
                className="w-full rounded-lg border p-3 text-base"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="columnsPerBand" className="block text-sm">
                Colonne per ogni lettura
              </label>
              <input
                id="columnsPerBand"
                name="columnsPerBand"
                type="number"
                min={1}
                max={6}
                defaultValue={1}
                className="w-full rounded-lg border p-3 text-base"
              />
              <p className="text-xs text-muted-foreground">
                Una sola colonna per lettura è la scelta che legge meglio. Alzarla riduce i minuti
                di attesa ma peggiora l accuratezza.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['areaLeft', 'Bordo sinistro', 0],
                  ['areaTop', 'Bordo alto', 0],
                  ['areaRight', 'Bordo destro', 1],
                  ['areaBottom', 'Bordo basso', 1],
                ] as const
              ).map(([name, etichetta, valore]) => (
                <div key={name} className="space-y-1">
                  <label htmlFor={name} className="block text-xs">
                    {etichetta}
                  </label>
                  <input
                    id={name}
                    name={name}
                    defaultValue={valore}
                    inputMode="decimal"
                    className="w-full rounded-lg border p-2 text-base"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Frazioni da 0 a 1 della foto. Con 0, 0, 1, 1 si usa tutta la foto.
            </p>
          </div>
        </details>

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
