/**
 * Gli indicatori «già sul calendario»: logica pura, usata sia dall elenco dei
 * mesi sia dalla testa della griglia, così le due schermate non possono dire
 * cose diverse sullo stesso stato.
 *
 * Conta solo i turni **confermati**: una bozza non è mai sul calendario e non è
 * nemmeno «da mandare» — è ancora da leggere. `synced` è lo stato dell ultimo
 * invio riuscito e cade a `confirmed` quando si riconferma (vedi `confirm.ts`),
 * quindi «sul calendario» vuol dire «e corrisponde a quello che hai confermato».
 */
export interface CalendarCounts {
  confirmed: number
  synced: number
  failed: number
}

export interface CalendarBadge {
  text: string
  variant: 'default' | 'secondary' | 'destructive'
}

export function calendarCounts(
  rows: ReadonlyArray<{ rosterId: string; syncState: string }>,
): Map<string, CalendarCounts> {
  const perTabella = new Map<string, CalendarCounts>()
  for (const row of rows) {
    const conteggio = perTabella.get(row.rosterId) ?? { confirmed: 0, synced: 0, failed: 0 }
    conteggio.confirmed += 1
    if (row.syncState === 'synced') conteggio.synced += 1
    if (row.syncState === 'failed') conteggio.failed += 1
    perTabella.set(row.rosterId, conteggio)
  }
  return perTabella
}

/** `null` quando non c è niente da dire: nessun turno confermato. */
export function calendarBadge(counts: CalendarCounts | undefined): CalendarBadge | null {
  if (!counts || counts.confirmed === 0) return null
  if (counts.failed > 0) {
    return {
      text: counts.failed === 1 ? '1 invio non riuscito' : `${counts.failed} invii non riusciti`,
      variant: 'destructive',
    }
  }
  if (counts.synced >= counts.confirmed) return { text: 'sul calendario', variant: 'default' }
  return { text: `${counts.confirmed - counts.synced} da mandare`, variant: 'secondary' }
}
