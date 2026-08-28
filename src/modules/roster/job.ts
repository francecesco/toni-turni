import { prisma } from '@/lib/db'
import { optionalEnv } from '@/lib/env'
import { listShiftCodes } from '@/modules/codes'
import {
  DEFAULT_BAND_PAUSE_MS,
  extractRosterByBands,
  type BandResult,
} from '@/modules/extract'
import {
  fallbackProviderFromEnv,
  providerFromEnv,
  type VisionProvider,
} from '@/modules/extract/providers'
import {
  DEFAULT_COLUMNS_PER_BAND,
  DEFAULT_DAY_COLUMN_FRACTION,
  DEFAULT_OVERLAP_FRACTION,
  cropRosterBands,
  imageDimensions,
  planBands,
  readRosterImage,
} from '@/modules/ingest'
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
 * una tabella sono 10-14 chiamate al provider con ~50 secondi di pausa fra l una
 * e l altra, cioè 10-20 minuti. L upload risponde subito, questo gira dopo e lo
 * stato vive su SQLite banda per banda, così un riavvio riprende invece di
 * ricominciare o, peggio, di lasciare la tabella in un vicolo cieco.
 */

export interface JobDeps {
  provider?: VisionProvider
  fallback?: VisionProvider | null
  sleep?: (ms: number) => Promise<void>
  pauseMs?: number
  now?: () => Date
  readImage?: (rosterId: string) => Promise<Buffer>
}

export interface JobOutcome {
  status: ExtractionStatus | 'skipped'
  reason?: string
  bandsRun: number
}

/** Pausa fra le bande: il piano gratuito di Groq ha un tetto di token al minuto. */
export function bandPauseMs(): number {
  const parsed = Number(optionalEnv('AI_BAND_PAUSE_MS', ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BAND_PAUSE_MS
}

function numeroDaEnv(name: string, fallback: number): number {
  const parsed = Number(optionalEnv(name, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

  const roster = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: {
      id: true,
      year: true,
      month: true,
      status: true,
      requestedAt: true,
      columnCount: true,
      columnsPerBand: true,
      dayColumnFraction: true,
      areaLeft: true,
      areaTop: true,
      areaRight: true,
      areaBottom: true,
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

  if (roster.columnCount === null) {
    const messaggio =
      'Numero di colonne della tabella non dichiarato: non si indovina la geometria delle bande'
    await markExtractionFailed(rosterId, null, messaggio)
    return { status: 'failed', reason: messaggio, bandsRun: 0 }
  }

  let piano
  try {
    const { width, height } = await imageDimensions(image)
    piano = planBands({
      width,
      height,
      columns: roster.columnCount,
      columnsPerBand: roster.columnsPerBand ?? DEFAULT_COLUMNS_PER_BAND,
      dayColumnFraction: roster.dayColumnFraction ?? DEFAULT_DAY_COLUMN_FRACTION,
      overlapFraction: numeroDaEnv('BAND_OVERLAP_FRACTION', DEFAULT_OVERLAP_FRACTION),
      area: {
        left: roster.areaLeft ?? 0,
        top: roster.areaTop ?? 0,
        right: roster.areaRight ?? 1,
        bottom: roster.areaBottom ?? 1,
      },
    })
  } catch (error) {
    const messaggio = `Geometria delle bande non valida: ${(error as Error).message}`
    await markExtractionFailed(rosterId, null, messaggio)
    return { status: 'failed', reason: messaggio, bandsRun: 0 }
  }

  await prepareExtraction(rosterId, piano.length, now())

  const daLeggere = await pendingBands(rosterId)
  if (daLeggere.length === 0) {
    const status = await finishExtraction(rosterId, { provider: 'nessuno', now: now() })
    return { status, reason: 'nessuna banda da leggere', bandsRun: 0 }
  }

  const ritagli = await cropRosterBands(
    image,
    piano.filter((banda) => daLeggere.includes(banda.index)),
  )

  const legenda = await listShiftCodes()
  const provider = deps.provider ?? providerFromEnv()
  const fallback = deps.fallback === undefined ? fallbackProviderFromEnv() : deps.fallback

  const salva = async (risultato: BandResult): Promise<void> => {
    if (risultato.ok && risultato.extraction) {
      await saveBandCells(rosterId, risultato.index, risultato.extraction.cells, {
        rawOutput: risultato.rawOutput,
        now: now(),
      })
    } else {
      await markBandFailed(
        rosterId,
        risultato.index,
        risultato.error ?? 'Banda non letta',
        risultato.rawOutput,
        now(),
      )
    }
  }

  let esito
  try {
    esito = await extractRosterByBands({
      bands: ritagli,
      knownCodes: legenda.map((def) => def.code),
      daysInMonth: daysInMonth(roster.year, roster.month),
      provider,
      fallback,
      pauseMs: deps.pauseMs ?? bandPauseMs(),
      sleep: deps.sleep,
      onBand: salva,
    })
  } catch (error) {
    // Un guasto imprevisto non deve lasciare la tabella in `extracting` per
    // sempre: le bande già salvate restano, il resto è dichiarato mancante.
    const messaggio = `Estrazione interrotta da un errore: ${(error as Error).message}`
    const status = await finishExtraction(rosterId, { provider: provider.name, now: now() })
    await prisma.roster.update({ where: { id: rosterId }, data: { error: messaggio } })
    return { status, reason: messaggio, bandsRun: ritagli.length }
  }

  const status = await finishExtraction(rosterId, { provider: esito.provider, now: now() })
  return { status, bandsRun: ritagli.length }
}
