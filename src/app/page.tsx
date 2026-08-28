import Link from 'next/link'
import { requireUser } from '@/modules/auth'

export default async function HomePage() {
  const user = await requireUser()

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Ciao {user.displayName}</h1>

      <nav className="grid gap-3">
        <Link
          href="/rosters"
          className="rounded-xl bg-primary px-4 py-4 text-center text-base font-medium text-primary-foreground"
        >
          Tabelle turni
        </Link>
        {user.role === 'REFERENTE' && (
          <>
            <Link
              href="/rosters/upload"
              className="rounded-xl border px-4 py-4 text-center text-base font-medium"
            >
              Carica la foto di un mese
            </Link>
            <Link
              href="/settings/codes"
              className="rounded-xl border px-4 py-4 text-center text-base font-medium"
            >
              Codici turno
            </Link>
            <Link
              href="/settings/users"
              className="rounded-xl border px-4 py-4 text-center text-base font-medium"
            >
              Utenti
            </Link>
          </>
        )}
      </nav>

      <form action="/api/auth/logout" method="post">
        <button type="submit" className="text-sm text-muted-foreground underline">
          Esci
        </button>
      </form>
    </main>
  )
}
