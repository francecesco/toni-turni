'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { isValidEmail, normalizeEmail, requireReferente } from '@/modules/auth'

export async function inviteUser(form: FormData): Promise<{ errors: string[] }> {
  const referente = await requireReferente()

  const raw = form.get('email')
  const email = typeof raw === 'string' ? normalizeEmail(raw) : ''
  if (!isValidEmail(email)) {
    redirect(`/settings/users?error=${encodeURIComponent('Indirizzo email non valido')}`)
  }

  await prisma.invite.upsert({
    where: { email },
    create: { email, invitedBy: referente.email },
    update: {},
  })
  revalidatePath('/settings/users')
  return { errors: [] }
}

export async function revokeInvite(form: FormData): Promise<void> {
  await requireReferente()
  const raw = form.get('email')
  if (typeof raw === 'string' && raw !== '') {
    const normalized = normalizeEmail(raw)
    // Le righe più vecchie potrebbero non essere state normalizzate alla scrittura:
    // confrontiamo su righe già lette invece di fidarci di un where per stringa esatta,
    // come già fa il callback OAuth per il match sull invito.
    const invites = await prisma.invite.findMany()
    const matches = invites.filter((invite) => normalizeEmail(invite.email) === normalized)
    if (matches.length > 0) {
      await prisma.invite.deleteMany({ where: { email: { in: matches.map((m) => m.email) } } })
      revalidatePath('/settings/users')
    }
  }
}
