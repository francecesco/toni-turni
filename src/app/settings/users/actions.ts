'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { isValidEmail, normalizeEmail, requireReferente } from '@/modules/auth'

export async function inviteUser(form: FormData): Promise<{ errors: string[] }> {
  const referente = await requireReferente()

  const raw = form.get('email')
  const email = typeof raw === 'string' ? normalizeEmail(raw) : ''
  if (!isValidEmail(email)) {
    return { errors: ['Indirizzo email non valido'] }
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
    await prisma.invite.deleteMany({ where: { email: normalizeEmail(raw) } })
    revalidatePath('/settings/users')
  }
}
