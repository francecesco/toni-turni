import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppMenu } from '@/components/app-menu'
import { LogoutForm } from '@/components/logout-form'

/**
 * Il menu ⋯ e anche il menu dell account: la voce «Esci» c e per tutti, non solo
 * per la referente. Prima con l elenco vuoto il bottone non si disegnava affatto,
 * e un infermiera non aveva nessun modo di uscire.
 */
describe('AppMenu', () => {
  it('disegna il bottone ⋯ anche senza voci della referente, perche dentro c e Esci', () => {
    const html = renderToStaticMarkup(createElement(AppMenu, { items: [] }))
    expect(html).toContain('aria-label="Altro"')
  })
})

describe('LogoutForm', () => {
  it('il logout e un POST sulla route di logout, non un link', () => {
    // La route accetta solo POST, di proposito: un GET si attiverebbe da un
    // <img src> su una pagina qualsiasi.
    const html = renderToStaticMarkup(createElement(LogoutForm))
    expect(html).toMatch(/<form[^>]*action="\/api\/auth\/logout"/)
    expect(html).toMatch(/<form[^>]*method="post"/i)
    expect(html).toContain('Esci')
  })

  it('il bottone ha una taglia da tocco', () => {
    const html = renderToStaticMarkup(createElement(LogoutForm))
    expect(html).toMatch(/<button[^>]*class="[^"]*\bh-12\b/)
  })
})
