import { optionalEnv } from '@/lib/env'

/** Come si legge una tabella: tutta in una chiamata, o mezzo mese per volta. */
export type ExtractionStrategy = 'whole' | 'bands'

/**
 * La strategia di lettura, da `AI_STRATEGY`. Default `whole`: **una chiamata
 * sola** con la tabella intera.
 *
 * Le due configurazioni sono due tagli della stessa pipeline, non due percorsi:
 *
 * - `whole` manda la tabella raddrizzata, ritagliata sulla griglia stampata e
 *   ricampionata, in un immagine sola. E la strategia veloce.
 * - `bands` manda mezzo mese per due colonne, che e la configurazione misurata
 *   al 99,8% per cella (487 su 488). Piu chiamate, ed e il ripiego.
 *
 * Una strategia sconosciuta **fallisce** invece di ripiegare sul default: un
 * ripiego silenzioso vorrebbe dire leggere la tabella in un modo diverso da
 * quello che l ambiente ha chiesto senza dirlo a nessuno. E la stessa regola del
 * provider (vedi `providerFromEnv`).
 *
 * Sta qui, e non nel modulo `roster`, perche il modulo `roster` tira dentro il
 * client Prisma: `npm run eval` gira sotto `tsx` fuori dal runtime di Next e
 * deve poter leggere la strategia senza aprire un database.
 */
export function extractionStrategyFromEnv(): ExtractionStrategy {
  const scelta = optionalEnv('AI_STRATEGY', 'whole')
  if (scelta === 'whole' || scelta === 'bands') return scelta
  throw new Error(`Strategia di estrazione non riconosciuta: ${scelta}`)
}
