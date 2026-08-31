import { AppHeader } from '@/components/app-header'
import { Banner } from '@/components/banner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <>
      <AppHeader title="Utenti" backHref="/rosters" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-safe pb-10">
        {error && <Banner variant="error">{error}</Banner>}

        <section className="space-y-3">
          <h2 className="font-medium">Registrate</h2>
          <ul className="flex flex-col gap-2">
            {users.map((user) => (
              <li
                key={user.id}
                className="bg-card border-border flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{user.displayName}</p>
                  <p className="text-muted-foreground truncate text-sm">{user.email}</p>
                </div>
                <Badge variant={user.role === 'REFERENTE' ? 'default' : 'secondary'}>
                  {user.role}
                </Badge>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium">Inviti in attesa</h2>
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => (
              <li
                key={invite.email}
                className="bg-card border-border flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm"
              >
                <span className="truncate text-sm">{invite.email}</span>
                <form action={revokeInvite}>
                  <input type="hidden" name="email" value={invite.email} />
                  <button
                    type="submit"
                    className="text-destructive flex min-h-11 items-center px-2 text-sm"
                  >
                    Revoca
                  </button>
                </form>
              </li>
            ))}
            {invites.length === 0 && (
              <li className="text-muted-foreground py-2 text-sm">Nessun invito in attesa.</li>
            )}
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
            <Input
              name="email"
              type="email"
              required
              placeholder="email della collega"
              className="h-12 flex-1 rounded-xl"
            />
            <Button type="submit" size="touch" className="shrink-0">
              Invita
            </Button>
          </form>
        </section>
      </main>
    </>
  )
}
