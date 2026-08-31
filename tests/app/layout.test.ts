import { describe, expect, it, vi } from 'vitest'

// `Figtree()` è una chiamata che solo il compilatore di Next sa eseguire. Qui
// serve soltanto che `layout.tsx` si importi: del carattere non si prova niente.
vi.mock('next/font/google', () => ({
  Figtree: () => ({ variable: '--font-figtree', className: 'font-figtree', style: {} }),
}))

const { metadata, viewport } = await import('@/app/layout')
const { tokenColors } = await import('../helpers/tokens')

describe('viewport del guscio', () => {
  it('porta il contenuto sotto il notch', () => {
    // Senza `cover` le safe-area valgono zero e il dock non ha da cosa scostarsi.
    expect(viewport.viewportFit).toBe('cover')
  })

  it('lascia lo zoom abilitato', () => {
    // Disattivarlo è un difetto di accessibilità, non una rifinitura: su un app
    // che si guarda alle sei del mattino è esattamente la cosa da non fare.
    expect(viewport.maximumScale).toBeUndefined()
    expect(viewport.userScalable).toBeUndefined()
  })

  it('dichiara i due temi ai controlli di sistema', () => {
    expect(viewport.colorScheme).toBe('light dark')
  })

  it('tinge la barra di stato del colore del fondo, in entrambi i temi', () => {
    // Un `theme_color` diverso dal fondo disegna una riga in cima allo schermo.
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: tokenColors('chiaro').background },
      { media: '(prefers-color-scheme: dark)', color: tokenColors('scuro').background },
    ])
  })
})

describe('metadata', () => {
  it('si chiama Turni', () => {
    expect(metadata.title).toBe('Turni')
  })

  it('dichiara che è un applicazione web capace, così iOS la apre a schermo intero', () => {
    expect(metadata.appleWebApp).toMatchObject({ capable: true, title: 'Turni' })
  })
})
