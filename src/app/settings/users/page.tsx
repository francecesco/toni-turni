import { prisma } from '@/lib/db'
import { requireReferente } from '@/modules/auth'
import { inviteUser, revokeInvite } from './actions'

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireReferente()
  const { error } = await searchParams

  const [users, invites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.invite.findMany({ where: { usedAt: null }, orderBy: { createdAt: 'asc' } }),
  ])

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Utenti</h1>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Registrate</h2>
        <ul className="text-sm">
          {users.map((user) => (
            <li key={user.id} className="flex justify-between border-b py-2">
              <span>
                {user.displayName} <span className="text-gray-500">({user.email})</span>
              </span>
              <span className="text-gray-500">{user.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Inviti in attesa</h2>
        <ul className="text-sm">
          {invites.map((invite) => (
            <li key={invite.email} className="flex justify-between border-b py-2">
              <span>{invite.email}</span>
              <form action={revokeInvite}>
                <input type="hidden" name="email" value={invite.email} />
                <button type="submit" className="text-red-600 hover:underline">
                  Revoca
                </button>
              </form>
            </li>
          ))}
          {invites.length === 0 && <li className="py-2 text-gray-500">Nessun invito in attesa.</li>}
        </ul>

        <form
          action={async (formData: FormData) => {
            'use server'
            // inviteUser fa redirect (rilanciando l eccezione) in caso di errore: qui non
            // c è nulla da scartare, il valore di ritorno serve solo a chi la chiama nei test.
            await inviteUser(formData)
          }}
          className="flex gap-2"
        >
          <input
            name="email"
            type="email"
            required
            placeholder="email della collega"
            className="flex-1 rounded border p-2"
          />
          <button type="submit" className="rounded bg-black px-4 text-white">
            Invita
          </button>
        </form>
      </section>
    </main>
  )
}
