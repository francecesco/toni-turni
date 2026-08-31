import { prisma } from '@/lib/db'
import { listShiftCodes } from '@/modules/codes'
import {
  createRetryAfterPacer,
  extractionStrategyFromEnv,
  extractRosterByBands,
  type BandPacer,
  type ExtractionStrategy,
} from '@/modules/extract'
import {
  fallbackProviderFromEnv,
  providerFromEnv,
  type VisionProvider,
} from '@/modules/extract/providers'
import { cropRosterBands, cropRosterWhole, readRosterImage, type RosterBand } from '@/modules/ingest'
import {
  finishExtraction,
  markBandFailed,
  markExtractionFailed,
  pendingBands,
  prepareExtraction,
  saveBandCells,
  type ExtractionStatus,
} from './repository'

/**
 * Il job di estrazione. Sta **fuori** dalla richiesta HTTP dell upload: anche una
 * chiamata sola su una tabella intera sono decine di secondi, e il rilevamento
 * del riquadro piu il raddrizzamento ne aggiungono altri. L upload risponde
 * subito, questo gira dopo e lo stato vive su SQLite banda per banda, cosi un
 * riavvio riprende invece di ricominciare o, peggio, di lasciare la tabella in
 * un vicolo cieco.
 *
 * La geometria **non si chiede a nessuno**: arriva dal ritaglio, che rileva il
 * riquadro della tabella e i suoi confini di colonna sulla foto e la raddrizza.
 *
 * Il percorso e uno solo, con due configurazioni (`AI_STRATEGY`):
 *
 * - `whole`, il default: la tabella intera in **una banda sola**, cioe una
 *   chiamata. E la strategia veloce.
 * - `bands`: mezzo mese per due colonne, la pipeline misurata al 99,8% per cella
 *   (487 su 488). Piu chiamate, e il ripiego se la chiamata sola non regge.
 *
 * In entrambi i casi le bande si mandano **una alla volta**, perche ogni banda
 * letta deve finire su SQLite prima della successiva: e quello che rende
 * ripartibile il lavoro. Con `whole` la banda e una e la ripresa e tutto o
 * niente, che e una proprieta della strategia, non un difetto del job.
 */

export { extractionStrategyFromEnv, type ExtractionStrategy }

/**
 * Il ritaglio che la strategia richiede. Le due configurazioni escono dalla
 * stessa forma — un elenco di bande — quindi il resto del job non le distingue.
 */
function cropForStrategy(
  strategy: ExtractionStrategy,
): (image: Buffer, daysInMonth: number) => Promise<RosterBand[]> {
  if (strategy === 'bands') {
    return (image, giorni) => cropRosterBands(image, { daysInMonth: giorni })
  }
  return async (image, giorni) => [await cropRosterWhole(image, { daysInMonth: giorni })]
}

export interface JobDeps {
  provider?: VisionProvider
  fallback?: VisionProvider | null
  pace?: BandPacer
  now?: () => Date
  readImage?: (rosterId: string) => Promise<Buffer>
  cropBands?: (image: Buffer, daysInMonth: number) => Promise<RosterBand[]>
}

export interface JobOutcome {
  status: ExtractionStatus | 'skipped'
  reason?: string
  bandsRun: number
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export async function runExtractionJob(
  rosterId: string,
  deps: JobDeps = {},
): Promise<JobOutcome> {
  const now = deps.now ?? (() => new Date())
  const readImage = deps.readImage ?? readRosterImage
  const cropBands = deps.cropBands ?? cropForStrategy(extractionStrategyFromEnv())

  const roster = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: {
      id: true,
      year: true,
      month: true,
      ward: true,
      status: true,
      requestedAt: true,
    },
  })

  if (!roster) return { status: 'skipped', reason: 'tabella inesistente', bandsRun: 0 }

  // Regola invariante 9: senza autorizzazione esplicita la foto non parte.
  if (roster.requestedAt === null) {
    return { status: 'skipped', reason: 'invio al provider AI non autorizzato', bandsRun: 0 }
  }
  if (roster.status === 'extracted') {
    return { status: 'skipped', reason: 'tabella già letta', bandsRun: 0 }
  }

  let image: Buffer
  try {
    image = await readImage(rosterId)
  } catch (error) {
    const messaggio = `Immagine della tabella non leggibile: ${(error as Error).message}`
    await markExtractionFailed(rosterId, null, messaggio)
    return { status: 'failed', reason: messaggio, bandsRun: 0 }
  }

  const giorni = daysInMonth(roster.year, roster.month)

  let bande: RosterBand[]
  try {
    bande = await cropBands(image, giorni)
  } catch (error) {
    // Un riquadro non trovato non è un errore da nascondere: un raddrizzamento a
    // caso produrrebbe turni attribuiti al giorno o alla persona sbagliata.
    const messaggio = `Non si riesce a ritagliare la tabella dalla foto: ${(error as Error).message}`
    await markExtractionFailed(rosterId, null, messaggio)
    return { status: 'failed', reason: messaggio, bandsRun: 0 }
  }

  await prepareExtraction(
    rosterId,
    bande.map((banda, index) => ({
      index,
      dayFrom: banda.spec.dayFrom,
      dayTo: banda.spec.dayTo,
    })),
    now(),
  )

  const daLeggere = (await pendingBands(rosterId)).filter((index) => index < bande.length)
  if (daLeggere.length === 0) {
    const status = await finishExtraction(rosterId, { provider: 'nessuno', now: now() })
    return { status, reason: 'nessuna banda da leggere', bandsRun: 0 }
  }

  const legenda = await listShiftCodes()
  const knownCodes = legenda.map((def) => def.code)
  const provider = deps.provider ?? providerFromEnv()
  const fallback = deps.fallback === undefined ? fallbackProviderFromEnv() : deps.fallback
  const pace = deps.pace ?? createRetryAfterPacer()
  const header = { year: roster.year, month: roster.month, ward: roster.ward }

  let conflitti = 0
  let providerUsato = provider.name
  let lette = 0

  try {
    for (const [posizione, index] of daLeggere.entries()) {
      if (posizione > 0) await pace(index)

      const esito = await extractRosterByBands({
        bands: [bande[index]],
        knownCodes,
        header,
        provider,
        fallback,
        pace,
      })

      lette += 1
      providerUsato = esito.provider
      const rawOutput = esito.rawOutputs[esito.rawOutputs.length - 1] ?? null
      // Su una banda sola `failures` ha al massimo una voce: con `cells` è una
      // banda letta a metà (le celle si tengono, il buco si dichiara), senza
      // `cells` è una banda che non ha prodotto niente di valido.
      const guasto = esito.failures[0]

      if (guasto !== undefined && guasto.cells === undefined) {
        await markBandFailed(rosterId, index, guasto.error, rawOutput, now())
        continue
      }

      const salvate = await saveBandCells(rosterId, index, esito.extraction.cells, {
        rawOutput,
        now: now(),
        partial: guasto?.error ?? null,
      })
      conflitti += salvate.conflicts.length + esito.conflicts
    }
  } catch (error) {
    // Un guasto imprevisto non deve lasciare la tabella in `extracting` per
    // sempre: le bande già salvate restano, il resto è dichiarato mancante.
    const messaggio = `Estrazione interrotta da un errore: ${(error as Error).message}`
    const status = await finishExtraction(rosterId, {
      provider: providerUsato,
      now: now(),
      conflicts: conflitti,
    })
    await prisma.roster.update({ where: { id: rosterId }, data: { error: messaggio } })
    return { status, reason: messaggio, bandsRun: lette }
  }

  const status = await finishExtraction(rosterId, {
    provider: providerUsato,
    now: now(),
    conflicts: conflitti,
  })
  return { status, bandsRun: lette }
}
