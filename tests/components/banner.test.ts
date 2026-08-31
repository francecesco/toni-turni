import { describe, expect, it } from 'vitest'
import { bannerClasses, type BannerVariant } from '@/components/banner'

const VARIANTI: BannerVariant[] = ['ok', 'warn', 'error', 'info']

describe('bannerClasses', () => {
  it('usa la coppia tenue giusta per ogni variante', () => {
    expect(bannerClasses('ok')).toBe('bg-ok-soft text-ok-soft-foreground')
    expect(bannerClasses('warn')).toBe('bg-warn-soft text-warn-soft-foreground')
    expect(bannerClasses('error')).toBe('bg-destructive-soft text-destructive-soft-foreground')
    expect(bannerClasses('info')).toBe('bg-muted text-muted-foreground')
  })

  it('dà a ogni variante il suo colore, senza ripetizioni', () => {
    // Un avviso d errore colorato come un avviso riuscito è il tipo di errore
    // che si vede solo quando è tardi.
    const classi = VARIANTI.map(bannerClasses)
    expect(new Set(classi).size).toBe(VARIANTI.length)
  })

  it('accoppia sempre un fondo con il suo testo', () => {
    for (const variante of VARIANTI) {
      const classi = bannerClasses(variante)
      const fondo = /\bbg-([a-z-]+)\b/.exec(classi)?.[1]
      const testo = /\btext-([a-z-]+)\b/.exec(classi)?.[1]
      expect(fondo, variante).toBeDefined()
      expect(testo, variante).toBe(`${fondo}-foreground`)
    }
  })
})
