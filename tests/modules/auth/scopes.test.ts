import { describe, expect, it } from 'vitest'
import { GOOGLE_SCOPES } from '@/modules/auth/google'

describe('GOOGLE_SCOPES', () => {
  it('chiede login, eventi e la creazione di calendari secondari', () => {
    // `calendar.app.created` è il permesso che serve per creare il calendario
    // dedicato: con `calendar.events` da solo la creazione risponde 403.
    expect(GOOGLE_SCOPES).toContain('openid')
    expect(GOOGLE_SCOPES).toContain('email')
    expect(GOOGLE_SCOPES).toContain('profile')
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.app.created')
  })

  it('non chiede permessi su Gmail, Drive, contatti né la gestione di tutti i calendari', () => {
    for (const scope of GOOGLE_SCOPES) {
      expect(scope).not.toMatch(/gmail|drive|contacts/)
    }
    // Lo scope pieno `auth/calendar` darebbe accesso a tutti i calendari: non serve.
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar')
  })
})
