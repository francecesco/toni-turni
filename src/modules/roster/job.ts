import { prisma } from '@/lib/db'
import { listShiftCodes } from '@/modules/codes'
import {
  createTokenPacer,
  extractRosterByBands,
  type BandPacer,
} from '@/modules/extract'
import {
  fallbackProviderFromEnv,
  providerFromEnv,
  type VisionProvider,
} from '@/modules/extract/providers'
import { cropRosterBands, readRosterImage, type RosterBand } from '@/modules/ingest'
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
 * Il job di estrazione. Sta **fuori** dalla richiesta HTTP dell upload: leggere
 * una tabella sono 10-14 chiamate al provider distanziate dal tetto di token al
 * minuto, cioè 10-20 minuti. L upload risponde subito, questo gira dopo e lo
 * stato vive su SQLite banda per banda, così un riavvio riprende invece di
 * ricominciare o, peggio, di lasciare la tabella in un vicolo cieco.
 *
 * La geometria delle bande **non si chiede a nessuno**: arriva da
 * `cropRosterBands`, che rileva il riquadro della tabella e i suoi confini di
 * colonna sulla foto e la raddrizza. È la pipeline misurata al 99,8% per cella
 * (487 su 488) contro il 18,5% della tabella intera.
 *
 * Le bande si mandano **una alla volta**, non tutte in una chiamata sola, perché
 * ogni banda letta deve finire su SQLite prima della successiva: è quello che
 * rende ripartibile un lavoro da venti minuti. Il distanziamento resta uno solo
 * per tutto il job (`createTokenPacer`), condiviso anche con il ritentativo che
 * `extractRosterByBands` fa quando il provider risponde 429.
 */

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
  const cropBands =
    deps.cropBands ?? ((image: Buffer, giorni: number) => cropRosterBands(image, { daysInMonth: giorni }))

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
  const pace = deps.pace ?? createTokenPacer()
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
