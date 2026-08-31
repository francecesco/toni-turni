import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHex, relativeLuminance } from '@/lib/contrast'
import { tokenColors } from '../helpers/tokens'

describe('parseHex', () => {
  it('legge #RRGGBB', () => {
    expect(parseHex('#1A6FD4')).toEqual({ r: 26, g: 111, b: 212 })
  })

  it('accetta le minuscole e gli spazi intorno', () => {
    expect(parseHex('  #ffffff ')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('rifiuta quello che non è un esadecimale a sei cifre, invece di restituire NaN', () => {
    // Un NaN silenzioso qui diventerebbe un rapporto di contrasto finto, e la
    // prova sui token passerebbe senza aver misurato niente.
    expect(() => parseHex('oklch(0.5 0 0)')).toThrow(/esadecimale/)
    expect(() => parseHex('#fff')).toThrow(/esadecimale/)
  })
})

describe('relativeLuminance', () => {
  it('vale 0 sul nero e 1 sul bianco', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6)
  })
})

describe('contrastRatio', () => {
  it('dà 21 fra nero e bianco', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2)
  })

  it('dà 1 fra un colore e se stesso', () => {
    expect(contrastRatio('#1A6FD4', '#1A6FD4')).toBeCloseTo(1, 6)
  })

  it('non dipende dall ordine degli argomenti', () => {
    expect(contrastRatio('#1A6FD4', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#1A6FD4'),
      6,
    )
  })

  it('misura il blu delle azioni con testo bianco sopra la soglia di 4,5', () => {
    expect(contrastRatio('#1A6FD4', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })

  it('boccia il verde che era stato scelto per primo', () => {
    // #0F8A60 dava 4,35:1 con testo bianco: è stato sostituito da #0C7A55.
    // Questa prova esiste perché quel valore non torni per distrazione.
    expect(contrastRatio('#0F8A60', '#FFFFFF')).toBeLessThan(4.5)
    expect(contrastRatio('#0C7A55', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })
})

/** Le coppie sono elencate, non dedotte dai nomi: `--sunday` non ha un `--sunday-foreground`. */
const COPPIE_TESTO: ReadonlyArray<readonly [string, string]> = [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['ok-foreground', 'ok'],
  ['ok-soft-foreground', 'ok-soft'],
  ['warn-foreground', 'warn'],
  ['warn-soft-foreground', 'warn-soft'],
  ['destructive-foreground', 'destructive'],
  ['destructive-soft-foreground', 'destructive-soft'],
  ['sunday-soft-foreground', 'sunday-soft'],
]

/** Bordi e cifre grandi: 3:1 basta, non è testo corrente. */
const COPPIE_NON_TESTO: ReadonlyArray<readonly [string, string]> = [
  ['border', 'background'],
  ['sunday', 'background'],
]

describe.each(['chiaro', 'scuro'] as const)('token della veste, tema %s', (tema) => {
  const token = tokenColors(tema)

  it('dichiara tutti i token che le coppie citano', () => {
    const citati = [...COPPIE_TESTO, ...COPPIE_NON_TESTO].flat()
    const mancanti = citati.filter((nome) => token[nome] === undefined)
    expect(mancanti).toEqual([])
  })

  it.each(COPPIE_TESTO)('%s su %s sta a 4,5:1 o meglio', (davanti, dietro) => {
    expect(contrastRatio(token[davanti], token[dietro])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(COPPIE_NON_TESTO)('%s su %s sta a 3:1 o meglio', (davanti, dietro) => {
    expect(contrastRatio(token[davanti], token[dietro])).toBeGreaterThanOrEqual(3)
  })
})
