import { readFileSync } from 'node:fs'
import path from 'node:path'

const PERCORSO_CSS = path.join(import.meta.dirname, '../../src/app/globals.css')

/** Il blocco graffe-bilanciate che comincia con `apertura`. */
function blocco(css: string, apertura: string): string {
  const inizio = css.indexOf(apertura)
  if (inizio === -1) throw new Error(`Blocco non trovato in globals.css: ${apertura}`)
  let profondita = 0
  for (let i = inizio + apertura.length - 1; i < css.length; i += 1) {
    if (css[i] === '{') profondita += 1
    else if (css[i] === '}') {
      profondita -= 1
      if (profondita === 0) return css.slice(inizio, i + 1)
    }
  }
  throw new Error(`Blocco non chiuso in globals.css: ${apertura}`)
}

/**
 * I token colore di un tema, senza il `--` iniziale. Il tema chiaro sta nel
 * `:root` in cima al file, lo scuro nel `:root` dentro la media query: l ordine
 * dei due blocchi nel file conta, ed è quello che la spec fissa.
 */
export function tokenColors(tema: 'chiaro' | 'scuro'): Record<string, string> {
  const css = readFileSync(PERCORSO_CSS, 'utf8')
  const sorgente =
    tema === 'chiaro'
      ? blocco(css, ':root {')
      : blocco(blocco(css, '@media (prefers-color-scheme: dark) {'), ':root {')

  const token: Record<string, string> = {}
  for (const trovato of sorgente.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    token[trovato[1]] = trovato[2]
  }
  return token
}
