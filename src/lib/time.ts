export const ROME_TZ = 'Europe/Rome' as const

/** Somma giorni a una data ISO (YYYY-MM-DD) restando in aritmetica UTC: nessun fuso di mezzo. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = Date.UTC(year, month - 1, day) + days * 86_400_000
  return new Date(shifted).toISOString().slice(0, 10)
}

/** Minuti di offset del fuso rispetto a UTC nell istante dato (60 = +01:00). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // hour12:false può restituire "24" a mezzanotte
    Number(parts.minute),
    Number(parts.second),
  )

  return (asIfUtc - instant.getTime()) / 60_000
}

/**
 * Converte un orario locale ("2026-10-25T07:00") nell istante UTC corrispondente.
 * Due passaggi: il primo stima l offset, il secondo lo corregge quando la stima
 * cade dal lato sbagliato di un cambio d ora.
 */
export function wallClockToUtc(wallClock: string, timeZone: string): Date {
  const withSeconds = wallClock.length === 16 ? `${wallClock}:00` : wallClock
  const asIfUtc = new Date(`${withSeconds}Z`)

  const firstGuess = new Date(asIfUtc.getTime() - zoneOffsetMinutes(asIfUtc, timeZone) * 60_000)
  return new Date(asIfUtc.getTime() - zoneOffsetMinutes(firstGuess, timeZone) * 60_000)
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000
}
