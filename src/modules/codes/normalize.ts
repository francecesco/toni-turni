import type { ShiftCodeDef } from './types'

/** Forma canonica per il confronto: maiuscolo, senza spazi, con il simbolo di grado uniformato. */
export function compactCode(raw: string): string {
  // 'º' (ordinale) e '°' (grado) sono indistinguibili sulla carta: uniformiamo.
  return raw.toUpperCase().replace(/º/g, '°').replace(/\s+/g, '')
}

export function matchCode(raw: string, defs: ShiftCodeDef[]): ShiftCodeDef | null {
  const key = compactCode(raw)
  if (key === '') return null
  return defs.find((def) => compactCode(def.code) === key) ?? null
}
