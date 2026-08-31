import { AppHeader } from '@/components/app-header'
import { Banner } from '@/components/banner'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { listShiftCodes } from '@/modules/codes'
import { requireReferente } from '@/modules/auth'
import { removeShiftCode, saveShiftCode } from './actions'

export default async function ShiftCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireReferente()
  const { error } = await searchParams
  const codes = await listShiftCodes()

  return (
    <>
      <AppHeader title="Codici turno" backHref="/rosters" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-safe pb-10">
        <p className="text-muted-foreground text-sm">
          Gli orari qui impostati determinano gli eventi creati sul calendario. Lascia gli orari
          vuoti per un evento che dura tutto il giorno.
        </p>

        {error && <Banner variant="error">{error}</Banner>}

        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {codes.map((def) => (
            <li key={def.code} className="bg-card rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base font-bold">{def.code}</span>
                {def.needsReview && <Badge variant="destructive">da chiarire</Badge>}
              </div>
              <p className="mt-0.5 text-sm">{def.label}</p>
              <dl className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <div className="flex gap-1">
                  <dt>tipo</dt>
                  <dd className="text-foreground font-medium">{def.kind}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>orario</dt>
                  <dd className="text-foreground font-medium tabular">
                    {def.startTime && def.endTime
                      ? `${def.startTime}–${def.endTime}${def.crossesMidnight ? ' (+1 giorno)' : ''}`
                      : 'tutto il giorno'}
                  </dd>
                </div>
                {def.location && (
                  <div className="flex gap-1">
                    <dt>sede</dt>
                    <dd className="text-foreground font-medium">{def.location}</dd>
                  </div>
                )}
              </dl>
              <form action={removeShiftCode} className="mt-2">
                <input type="hidden" name="code" value={def.code} />
                <button type="submit" className="text-destructive flex min-h-11 items-center text-sm">
                  Elimina
                </button>
              </form>
            </li>
          ))}
        </ul>

        <section className="bg-card space-y-3 rounded-2xl px-4 py-4 shadow-sm">
          <h2 className="font-medium">Aggiungi o modifica un codice</h2>
          <form
            action={async (formData: FormData) => {
              'use server'
              // saveShiftCode fa redirect (rilanciando l eccezione) in caso di errore: qui non
              // c è nulla da scartare, il valore di ritorno serve solo a chi la chiama nei test.
              await saveShiftCode(formData)
            }}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            <Input name="code" placeholder="Codice (es. M)" required />
            <Input name="label" placeholder="Etichetta" required />
            <select
              name="kind"
              defaultValue="work"
              className="border-input bg-background h-11 rounded-lg border p-3 text-base"
            >
              <option value="work">Turno di lavoro</option>
              <option value="absence">Assenza</option>
              <option value="info">Informativo</option>
              <option value="unknown">Da definire</option>
            </select>
            <Input name="startTime" placeholder="Inizio (07:00)" />
            <Input name="endTime" placeholder="Fine (14:00)" />
            <Input name="location" placeholder="Sede (opzionale)" />
            <Input
              name="color"
              placeholder="Colore (es. #f59e0b, opzionale)"
              pattern="#[0-9a-fA-F]{6}"
              title="Un colore esadecimale, es. #f59e0b"
            />
            <button
              type="submit"
              className="bg-primary text-primary-foreground col-span-2 h-12 rounded-xl px-4 text-base font-medium sm:col-span-3"
            >
              Salva
            </button>
          </form>
        </section>
      </main>
    </>
  )
}
