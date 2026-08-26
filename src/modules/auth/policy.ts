export type Role = 'REFERENTE' | 'NURSE'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function roleForNewUser(existingUsers: number): Role {
  return existingUsers === 0 ? 'REFERENTE' : 'NURSE'
}

export type RegistrationDecision =
  | { allowed: true; role: Role }
  | { allowed: false; reason: 'not_invited' }

/**
 * Il primo accesso in assoluto crea la referente. Dopo di quello serve un invito:
 * senza questo controllo qualunque account Google potrebbe entrare nell app.
 */
export function decideRegistration(
  email: string,
  ctx: { existingUsers: number; invitedEmails: string[] },
): RegistrationDecision {
  if (ctx.existingUsers === 0) return { allowed: true, role: 'REFERENTE' }

  const normalized = normalizeEmail(email)
  const invited = ctx.invitedEmails.some((candidate) => normalizeEmail(candidate) === normalized)

  return invited ? { allowed: true, role: 'NURSE' } : { allowed: false, reason: 'not_invited' }
}
