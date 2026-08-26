import { describe, expect, it } from 'vitest'
import { decideRegistration, normalizeEmail, roleForNewUser } from '@/modules/auth/policy'

describe('normalizeEmail', () => {
  it('mette in minuscolo e rimuove gli spazi', () => {
    expect(normalizeEmail('  Anna.Rossi@Gmail.com ')).toBe('anna.rossi@gmail.com')
  })
})

describe('roleForNewUser', () => {
  it('il primo utente è la referente', () => {
    expect(roleForNewUser(0)).toBe('REFERENTE')
  })

  it('gli utenti successivi sono infermiere', () => {
    expect(roleForNewUser(1)).toBe('NURSE')
    expect(roleForNewUser(7)).toBe('NURSE')
  })
})

describe('decideRegistration', () => {
  it('accetta il primo accesso in assoluto come referente, senza invito', () => {
    expect(decideRegistration('anna@example.com', { existingUsers: 0, invitedEmails: [] })).toEqual({
      allowed: true,
      role: 'REFERENTE',
    })
  })

  it('rifiuta chi non è stata invitata quando esiste già un utente', () => {
    expect(
      decideRegistration('sconosciuta@example.com', { existingUsers: 1, invitedEmails: [] }),
    ).toEqual({ allowed: false, reason: 'not_invited' })
  })

  it('accetta chi è nella lista inviti come infermiera', () => {
    expect(
      decideRegistration('mery@example.com', {
        existingUsers: 1,
        invitedEmails: ['mery@example.com'],
      }),
    ).toEqual({ allowed: true, role: 'NURSE' })
  })

  it('confronta le email ignorando maiuscole e spazi', () => {
    expect(
      decideRegistration(' Mery@Example.com ', {
        existingUsers: 1,
        invitedEmails: ['mery@example.com'],
      }),
    ).toEqual({ allowed: true, role: 'NURSE' })
  })
})
