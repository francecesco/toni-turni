/**
 * Rapporto di contrasto WCAG 2.1. Serve alla prova sui token della veste: le
 * soglie di leggibilità si misurano, non si dichiarano.
 */

/** Un colore #RRGGBB. La palette non usa l alfa, quindi non si accetta. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  const trovato = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!trovato) throw new Error(`Colore non esadecimale a sei cifre: ${hex}`)
  const numero = Number.parseInt(trovato[1], 16)
  return { r: (numero >> 16) & 0xff, g: (numero >> 8) & 0xff, b: numero & 0xff }
}

function canale(componente: number): number {
  const normalizzato = componente / 255
  return normalizzato <= 0.03928
    ? normalizzato / 12.92
    : ((normalizzato + 0.055) / 1.055) ** 2.4
}

/** Luminanza relativa: 0 sul nero, 1 sul bianco. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * canale(r) + 0.7152 * canale(g) + 0.0722 * canale(b)
}

/** Fra 1 (colori identici) e 21 (nero su bianco). */
export function contrastRatio(a: string, b: string): number {
  const primo = relativeLuminance(a)
  const secondo = relativeLuminance(b)
  return (Math.max(primo, secondo) + 0.05) / (Math.min(primo, secondo) + 0.05)
}
