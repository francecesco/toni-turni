import { optionalEnv } from '@/lib/env'
import { runExtractionJob, type JobDeps } from './job'
import { reclaimStaleExtractions, resumableRosters } from './repository'

/**
 * Il "worker": un solo giro alla volta, in-process, senza coda esterna.
 *
 * Un container e SQLite: la coda è la tabella `RosterBand`. Il giro recupera le
 * estrazioni il cui battito è vecchio (processo morto a metà) e riprende ogni
 * tabella autorizzata a cui manca una banda. Le estrazioni girano **in serie**,
 * perché SQLite non gestisce scritture concorrenti e perché il provider AI ha un
 * tetto di token al minuto.
 */

// Stato di processo: se il processo muore, muore anche questo — ed è esattamente
// il caso che `reclaimStaleExtractions` rimette in piedi al giro successivo.
let giroInCorso: Promise<string[]> | null = null

/** Quanto un battito può essere vecchio prima di considerare morto il processo. */
export function staleAfterMs(): number {
  const parsed = Number(optionalEnv('EXTRACTION_STALE_MS', ''))
  // Una banda può prendere qualche minuto fra pausa, retry e chiamata: la soglia
  // deve stare larga, o un job vivo verrebbe dichiarato morto mentre lavora.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60_000
}

export async function processResumableRosters(deps: JobDeps = {}): Promise<string[]> {
  const now = deps.now ?? (() => new Date())
  await reclaimStaleExtractions(now(), staleAfterMs())

  const fatte: string[] = []
  // Si rilegge l elenco a ogni giro: una tabella caricata mentre il worker lavora
  // viene raccolta senza aspettare la richiesta successiva.
  for (let giro = 0; giro < 50; giro += 1) {
    const riprendibili = await resumableRosters()
    const prossima = riprendibili.find((r) => !fatte.includes(r.id))
    if (!prossima) break

    fatte.push(prossima.id)
    try {
      await runExtractionJob(prossima.id, deps)
    } catch (error) {
      // Un job che esplode non deve fermare gli altri né il worker: lo stato della
      // tabella resta su SQLite e il giro successivo lo ritrova.
      console.error(`Estrazione della tabella ${prossima.id} interrotta:`, error)
    }
  }

  return fatte
}

/**
 * Avvia il giro se non è già in corso. Restituisce la promessa del giro, così i
 * test possono aspettarlo; il codice applicativo può ignorarla e rispondere subito.
 */
export function ensureExtractionWorker(deps: JobDeps = {}): Promise<string[]> {
  if (giroInCorso) return giroInCorso

  giroInCorso = processResumableRosters(deps).finally(() => {
    giroInCorso = null
  })
  return giroInCorso
}
