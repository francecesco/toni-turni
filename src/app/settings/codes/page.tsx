import { listShiftCodes } from '@/modules/codes'
import { requireReferente } from '@/modules/auth'
import { removeShiftCode, saveShiftCode } from './actions'

export default async function ShiftCodesPage() {
  await requireReferente()
  const codes = await listShiftCodes()

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Codici turno</h1>
        <p className="text-sm text-gray-600">
          Gli orari qui impostati determinano gli eventi creati sul calendario. Lascia gli orari vuoti
          per un evento che dura tutto il giorno.
        </p>
      </header>

      <table className="w-full text-sm">
        <thead className="text-left">
          <tr>
            <th className="p-2">Codice</th>
            <th className="p-2">Etichetta</th>
            <th className="p-2">Tipo</th>
            <th className="p-2">Orario</th>
            <th className="p-2">Sede</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.code} className="border-t">
              <td className="p-2 font-mono">
                {code.code}
                {code.needsReview && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    da confermare
                  </span>
                )}
              </td>
              <td className="p-2">{code.label}</td>
              <td className="p-2">{code.kind}</td>
              <td className="p-2">
                {code.startTime && code.endTime
                  ? `${code.startTime}–${code.endTime}${code.crossesMidnight ? ' (+1g)' : ''}`
                  : 'tutto il giorno'}
              </td>
              <td className="p-2">{code.location ?? '—'}</td>
              <td className="p-2 text-right">
                <form action={removeShiftCode}>
                  <input type="hidden" name="code" value={code.code} />
                  <button type="submit" className="text-red-600 hover:underline">
                    Elimina
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Aggiungi o modifica un codice</h2>
        <form
          action={async (formData: FormData) => {
            'use server'
            await saveShiftCode(formData)
          }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          <input name="code" placeholder="Codice (es. M)" required className="rounded border p-2" />
          <input name="label" placeholder="Etichetta" required className="rounded border p-2" />
          <select name="kind" defaultValue="work" className="rounded border p-2">
            <option value="work">Turno di lavoro</option>
            <option value="absence">Assenza</option>
            <option value="info">Informativo</option>
            <option value="unknown">Da definire</option>
          </select>
          <input name="startTime" placeholder="Inizio (07:00)" className="rounded border p-2" />
          <input name="endTime" placeholder="Fine (14:00)" className="rounded border p-2" />
          <input name="location" placeholder="Sede (opzionale)" className="rounded border p-2" />
          <button type="submit" className="col-span-2 rounded bg-black p-2 text-white sm:col-span-3">
            Salva
          </button>
        </form>
      </section>
    </main>
  )
}
