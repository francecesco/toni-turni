/**
 * Su quale tabella si apre l app, e quali mesi elenca il selettore. Logica pura:
 * i candidati arrivano da `reviewableRosters`, che filtra già per quello che
 * l utente ha il diritto di vedere.
 */

export interface LandingCandidate {
  id: string
  year: number
  month: number
  version: number
}

export interface MonthEntry {
  id: string
  year: number
  month: number
  /** Vero sul mese di **oggi**, non sulla tabella su cui si è atterrati. */
  current: boolean
}

/** Dal più recente: anno, poi mese, poi versione. Tutti e tre decrescenti. */
function piuRecentePrima(a: LandingCandidate, b: LandingCandidate): number {
  return b.year - a.year || b.month - a.month || b.version - a.version
}

/**
 * La tabella del mese corrente alla versione più alta; se non c è, la più
 * recente; se non c è niente, `null`.
 *
 * L ordine in ingresso non si assume: si riordina qui, così chi chiama non ha un
 * contratto implicito da rispettare.
 */
export function landingRoster(
  candidates: readonly LandingCandidate[],
  today: { year: number; month: number },
): LandingCandidate | null {
  if (candidates.length === 0) return null

  const ordinati = [...candidates].sort(piuRecentePrima)
  // Ordinati per versione decrescente, il primo del mese giusto è la versione più alta.
  const delMese = ordinati.find((c) => c.year === today.year && c.month === today.month)
  return delMese ?? ordinati[0]
}

/** Gli stati in cui la griglia di conferma ha davvero qualcosa da mostrare. */
const PRONTA = ['extracted', 'partial']

/**
 * Dove portare chi apre una tabella. Su una tabella non ancora letta la griglia
 * di conferma direbbe «non c è ancora una colonna associata a te», che è falso:
 * la verità è che l estrazione deve ancora girare, e la pagina di stato la sa
 * mostrare.
 */
export function rosterHref(roster: { id: string; status: string }): string {
  return PRONTA.includes(roster.status) ? `/rosters/${roster.id}/review` : `/rosters/${roster.id}`
}

/**
 * Una voce per (anno, mese), quella della versione più alta, dal più recente. Le
 * versioni superate non compaiono come voci separate.
 */
export function monthPickerEntries(
  candidates: readonly LandingCandidate[],
  today: { year: number; month: number },
): MonthEntry[] {
  const visti = new Set<string>()
  const voci: MonthEntry[] = []

  for (const candidato of [...candidates].sort(piuRecentePrima)) {
    const chiave = `${candidato.year}-${candidato.month}`
    if (visti.has(chiave)) continue
    visti.add(chiave)

    voci.push({
      id: candidato.id,
      year: candidato.year,
      month: candidato.month,
      current: candidato.year === today.year && candidato.month === today.month,
    })
  }

  return voci
}
