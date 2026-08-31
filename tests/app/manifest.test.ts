import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import manifest from '@/app/manifest'
import { tokenColors } from '../helpers/tokens'

const RADICE = path.join(import.meta.dirname, '../..')

describe('manifest della PWA', () => {
  const m = manifest()

  it('si installa e si apre a schermo intero', () => {
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(m.name).toBe('Turni')
    expect(m.short_name).toBe('Turni')
    expect(m.lang).toBe('it')
  })

  it('tinge la barra di stato come il fondo chiaro', () => {
    expect(m.theme_color).toBe(tokenColors('chiaro').background)
    expect(m.background_color).toBe(tokenColors('chiaro').background)
  })

  it('dichiara un icona mascherabile, che è quella che iOS e Android ritagliano', () => {
    const mascherabili = (m.icons ?? []).filter((icona) => icona.purpose === 'maskable')
    expect(mascherabili).toHaveLength(1)
  })

  // Un manifest che promette un icona assente è un installazione senza icona, e
  // non lo dice nessuno: il browser mette un rettangolo grigio e via.
  it('ogni icona promessa esiste su disco, del lato dichiarato', async () => {
    for (const icona of m.icons ?? []) {
      const file = path.join(RADICE, 'public', String(icona.src))
      expect(existsSync(file), `manca ${icona.src}`).toBe(true)

      const [larghezza, altezza] = String(icona.sizes).split('x').map(Number)
      const dati = await sharp(file).metadata()
      expect(dati.width, `${icona.src} larghezza`).toBe(larghezza)
      expect(dati.height, `${icona.src} altezza`).toBe(altezza)
    }
  })

  it('porta anche le icone che Next aggancia da sé', async () => {
    // `src/app/icon.png` e `src/app/apple-icon.png` non stanno nel manifest:
    // Next genera i <link> da sé sulla convenzione dei nomi. Se sparissero,
    // la scheda del browser e la schermata Home resterebbero senza icona senza
    // che nessuna prova sul manifest se ne accorga.
    for (const [file, lato] of [
      ['src/app/icon.png', 512],
      ['src/app/apple-icon.png', 180],
    ] as const) {
      const completo = path.join(RADICE, file)
      expect(existsSync(completo), `manca ${file}`).toBe(true)
      const dati = await sharp(completo).metadata()
      expect(dati.width, `${file} lato`).toBe(lato)
      expect(dati.height, `${file} lato`).toBe(lato)
    }
  })
})
