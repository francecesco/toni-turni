import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RADICE = path.join(import.meta.dirname, '../../src')

const FAMIGLIE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const UTILITY =
  'bg|text|border|ring|fill|stroke|divide|from|to|via|placeholder|shadow|outline|accent|caret|decoration'

/** `bg-emerald-50`, `dark:text-amber-900`, `hover:border-rose-300`. */
const CON_CIFRE = new RegExp(`\\b(?:${UTILITY})-(?:${FAMIGLIE})-\\d{2,3}\\b`, 'g')
/** `bg-white` non ha cifre e sfuggirebbe al primo modello. */
const SENZA_CIFRE = /\b(?:bg|text|border|fill|stroke|divide|ring)-(?:white|black)\b/g

function sorgenti(cartella: string): string[] {
  const trovati: string[] = []
  for (const voce of readdirSync(cartella)) {
    const completo = path.join(cartella, voce)
    if (statSync(completo).isDirectory()) trovati.push(...sorgenti(completo))
    else if (voce.endsWith('.tsx')) trovati.push(completo)
  }
  return trovati
}

function coloriLetterali(file: string): string[] {
  const testo = readFileSync(file, 'utf8')
  return [...testo.matchAll(CON_CIFRE), ...testo.matchAll(SENZA_CIFRE)].map((m) => m[0])
}

const TUTTI = [
  ...sorgenti(path.join(RADICE, 'app')),
  ...sorgenti(path.join(RADICE, 'components')),
].map((file) => path.relative(RADICE, file))

describe('nessuna pagina nomina un colore', () => {
  it.each(TUTTI)('%s usa solo token', (relativo) => {
    expect(coloriLetterali(path.join(RADICE, relativo))).toEqual([])
  })
})
