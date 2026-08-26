import Link from 'next/link'
import { requireUser } from '@/modules/auth'

export default async function HomePage() {
  const user = await requireUser()

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Ciao {user.displayName}</h1>
      <p className="text-sm text-gray-600">
        Il caricamento delle tabelle turni arriva nella prossima fase.
      </p>

      {user.role === 'REFERENTE' && (
        <nav className="flex gap-4 text-sm">
          <Link href="/settings/codes" className="underline">
            Codici turno
          </Link>
          <Link href="/settings/users" className="underline">
            Utenti
          </Link>
        </nav>
      )}

      <form action="/api/auth/logout" method="post">
        <button type="submit" className="text-sm text-gray-600 underline">
          Esci
        </button>
      </form>
    </main>
  )
}
