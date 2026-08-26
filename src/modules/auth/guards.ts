import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { readSessionCookie } from './session'
import type { Role } from './policy'

export interface CurrentUser {
  id: string
  email: string
  displayName: string
  role: Role
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await readSessionCookie()
  if (!session) return null

  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user) return null

  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function requireReferente(): Promise<CurrentUser> {
  const user = await requireUser()
  if (user.role !== 'REFERENTE') redirect('/')
  return user
}
