import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buttonVariants } from '@/components/ui/button'

const UI = path.join(import.meta.dirname, '../../src/components/ui')

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
})
