import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buttonVariants } from '@/components/ui/button'

const UI = path.join(import.meta.dirname, '../../src/components/ui')
const COMPONENTI = path.join(import.meta.dirname, '../../src/components')

/**
 * Il valore di queste prove non è dimostrare un design: è la regressione. Questi
 * file li rigenera `shadcn add`, e una rigenerazione riporterebbe `h-8`
 * silenziosamente — con tutti i controlli sotto i 44 px e nessuno che se ne
 * accorge finché non lo prova col pollice.
 */
describe('taglie da tocco', () => {
  it('Button ha una taglia da 48 px', () => {
    expect(buttonVariants({ size: 'touch' })).toContain('h-12')
  })

  it('Button ha una taglia icona da 44 px', () => {
    expect(buttonVariants({ size: 'icon-touch' })).toContain('size-11')
  })

  it('la taglia da tocco porta il testo a 16 px', () => {
    // Sotto i 16 px iOS ingrandisce la pagina quando il campo prende il focus.
    expect(buttonVariants({ size: 'touch' })).toContain('text-base')
  })

  it('Input è alto 44 px per default, non 32', () => {
    const sorgente = readFileSync(path.join(UI, 'input.tsx'), 'utf8')
    expect(sorgente).toContain('h-11')
    expect(sorgente).not.toContain('h-8')
  })

  it('il trigger di Select ha una taglia da tocco', () => {
    const sorgente = readFileSync(path.join(UI, 'select.tsx'), 'utf8')
    expect(sorgente).toContain('data-[size=touch]:h-11')
  })

  it('il tipo di size sul trigger di Select ammette "touch", non solo la classe CSS', () => {
    // Le due metà devono viaggiare insieme: una classe CSS che nessuna chiamata può
    // raggiungere è codice morto (il tipo blocca size="touch" prima di tsc --noEmit),
    // un tipo senza la classe fa rendere il trigger all'altezza sbagliata.
    const sorgente = readFileSync(path.join(UI, 'select.tsx'), 'utf8')
    expect(sorgente).toContain('"sm" | "default" | "touch"')
  })

  it('i link di AppHeader sono alti almeno 44 px', () => {
    // L'altezza qui non viene da `Button`: sono due `<Link>` nudi, e su un titolo
    // `text-2xl` l'area toccabile è quella del testo — 32 px, non 44. È il difetto
    // che questa prova impedisce di riportare.
    const sorgente = readFileSync(path.join(COMPONENTI, 'app-header.tsx'), 'utf8')
    const classi = [...sorgente.matchAll(/<Link[^>]*className="([^"]*)"/g)].map((m) => m[1])
    // Senza questa riga la prova passerebbe a vuoto il giorno che la regex non
    // combacia più con niente.
    expect(classi.length).toBeGreaterThanOrEqual(2)
    for (const stringa of classi) {
      expect(stringa).toMatch(/\b(?:min-)?h-1[12]\b/)
    }
  })
})
