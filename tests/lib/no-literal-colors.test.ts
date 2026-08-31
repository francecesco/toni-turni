import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RADICE = path.join(import.meta.dirname, '../../src')

/**
 * Le pagine non ancora convertite alla veste «Corsia».
 *
 * **Questo elenco si accorcia.** Ogni task che riveste una pagina la toglie da
 * qui prima di toccarla, così la prova diventa rossa e guida il lavoro. Quando è
 * vuoto, si cancella l elenco insieme a questo commento e alla prova che lo usa.
 */
const DA_CONVERTIRE: readonly string[] = [
  'app/login/page.tsx',
  'app/rosters/[id]/page.tsx',
  'app/settings/codes/page.tsx',
  'app/settings/users/page.tsx',
]

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
  const convertiti = TUTTI.filter((file) => !DA_CONVERTIRE.includes(file))

  it.each(convertiti)('%s usa solo token', (relativo) => {
    expect(coloriLetterali(path.join(RADICE, relativo))).toEqual([])
  })

  // Senza questa, una pagina convertita e dimenticata nell elenco smetterebbe di
  // essere protetta in silenzio: l elenco resterebbe lungo e nessuno lo saprebbe.
  it.each(DA_CONVERTIRE)('%s è ancora nell elenco a ragione', (relativo) => {
    expect(TUTTI).toContain(relativo)
    expect(coloriLetterali(path.join(RADICE, relativo)).length).toBeGreaterThan(0)
  })
})
