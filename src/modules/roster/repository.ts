import { prisma } from '@/lib/db'
import { listShiftCodes, matchCode } from '@/modules/codes'
import type { BandCell, Extraction } from '@/modules/extract'

/** Geometria delle bande dichiarata dalla referente al caricamento. */
export interface RosterGeometry {
  columnCount: number
  columnsPerBand: number
  dayColumnFraction: number
  area: { left: number; top: number; right: number; bottom: number }
}

export interface BandConflict {
  day: number
  columnLabel: string
  /** Testo tenuto: quello letto per primo. */
  kept: string
  /** Testo scartato, che resta scritto sulla cella come conflitto. */
  discarded: string
  bandIndex: number
}

export type ExtractionStatus = 'extracted' | 'partial' | 'failed'

/**
 * SQLite non gestisce scritture concorrenti: le operazioni di scrittura passano
 * tutte da qui, in coda una dietro l altra. Il carico reale è una foto al mese,
 * quindi il costo è nullo e il guadagno è non vedere mai "database is locked".
 */
let writeQueue: Promise<unknown> = Promise.resolve()

export function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  // Il `catch` sulla coda serve a non propagare un errore precedente al prossimo
  // in fila: chi ha sbagliato riceve il suo errore, gli altri continuano.
  const result = writeQueue.then(
    () => operation(),
    () => operation(),
  )
  writeQueue = result.catch(() => undefined)
  return result
}

export async function nextVersion(year: number, month: number, ward: string): Promise<number> {
  const ultima = await prisma.roster.findFirst({
    where: { year, month, ward },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return (ultima?.version ?? 0) + 1
}

export async function createRoster(input: {
  year: number
  month: number
  ward: string
  imagePath: string
  geometry?: RosterGeometry
}): Promise<{ id: string; version: number }> {
  return withWriteLock(async () => {
    const version = await nextVersion(input.year, input.month, input.ward)
    return prisma.roster.create({
      data: {
        year: input.year,
        month: input.month,
        ward: input.ward,
        imagePath: input.imagePath,
        version,
        status: 'uploaded',
        columnCount: input.geometry?.columnCount ?? null,
        columnsPerBand: input.geometry?.columnsPerBand ?? null,
        dayColumnFraction: input.geometry?.dayColumnFraction ?? null,
        areaLeft: input.geometry?.area.left ?? null,
        areaTop: input.geometry?.area.top ?? null,
        areaRight: input.geometry?.area.right ?? null,
        areaBottom: input.geometry?.area.bottom ?? null,
      },
      select: { id: true, version: true },
    })
  })
}

/**
 * Salva le celle risolvendo ogni codice letto con la legenda: il testo grezzo resta
 * sempre, il codice risolto è null quando la legenda non lo conosce — sarà l utente
 * a deciderlo, e non è un errore di estrazione.
 */
export async function saveExtraction(
  rosterId: string,
  extraction: Extraction,
  meta: { provider: string; rawOutput: string },
): Promise<{ cells: number; unresolved: number }> {
  const legenda = await listShiftCodes()

  const celle = extraction.cells
    .filter((cell) => cell.code.trim() !== '')
    .map((cell) => {
      const risolto = matchCode(cell.code, legenda)
      return {
        rosterId,
        day: cell.day,
        columnLabel: cell.column,
        rawCode: cell.code,
        code: risolto?.code ?? null,
        confidence: cell.confidence,
        handCorrected: cell.handCorrected,
      }
    })

  await prisma.$transaction([
    prisma.rosterCell.deleteMany({ where: { rosterId } }),
    // createMany in un unica istruzione invece di una create per cella: stesso esito
    // osservabile (niente skipDuplicates, inutile dopo la deleteMany), molto più
    // efficiente sulle ~240 celle di una tabella reale.
    prisma.rosterCell.createMany({ data: celle }),
    prisma.roster.update({
      where: { id: rosterId },
      data: { status: 'extracted', provider: meta.provider, rawOutput: meta.rawOutput },
    }),
  ])

  return { cells: celle.length, unresolved: celle.filter((c) => c.code === null).length }
}

/**
 * Registra l autorizzazione della referente all invio della foto al provider AI e
 * crea le bande pendenti. È **idempotente**: richiamata su una ripresa lascia in
 * pace le bande già lette e non riscrive `requestedAt`, che è la traccia di quando
 * l invio è stato autorizzato la prima volta.
 */
export async function prepareExtraction(
  rosterId: string,
  bandCount: number,
  now: Date,
): Promise<void> {
  await withWriteLock(async () => {
    const roster = await prisma.roster.findUniqueOrThrow({
      where: { id: rosterId },
      select: { requestedAt: true },
    })

    // `skipDuplicates` non esiste su SQLite: si guarda cosa c è già e si creano
    // solo le bande mancanti, così una ripresa non perde le bande già lette.
    const esistenti = await prisma.rosterBand.findMany({
      where: { rosterId },
      select: { index: true },
    })
    const giaCreate = new Set(esistenti.map((b) => b.index))
    const daCreare = Array.from({ length: bandCount }, (_, index) => index).filter(
      (index) => !giaCreate.has(index),
    )
    if (daCreare.length > 0) {
      await prisma.rosterBand.createMany({
        data: daCreare.map((index) => ({ rosterId, index })),
      })
    }

    await prisma.roster.update({
      where: { id: rosterId },
      data: {
        status: 'extracting',
        requestedAt: roster.requestedAt ?? now,
        heartbeatAt: now,
        error: null,
      },
    })
  })
}

/** Indici delle bande ancora da leggere: pendenti e fallite. */
export async function pendingBands(rosterId: string): Promise<number[]> {
  const bande = await prisma.rosterBand.findMany({
    where: { rosterId, status: { not: 'done' } },
    orderBy: { index: 'asc' },
    select: { index: true },
  })
  return bande.map((b) => b.index)
}

/**
 * Salva le celle di **una** banda, risolvendo i codici con la legenda: il testo
 * grezzo resta sempre, il codice risolto è null quando la legenda non lo conosce —
 * sarà l utente a deciderlo, e non è un errore di estrazione.
 *
 * Le bande si sovrappongono, quindi la stessa cella può arrivare due volte. Se le
 * due letture coincidono, non succede nulla; se differiscono vince la **prima** e
 * la seconda resta scritta accanto come conflitto. La scelta è deterministica e non
 * usa la confidenza: sulla misura reale nessuna cella era sotto 0,8, comprese le
 * due sbagliate, quindi la confidenza non distingue nulla.
 */
export async function saveBandCells(
  rosterId: string,
  bandIndex: number,
  cells: BandCell[],
  meta: { rawOutput: string | null; now: Date },
): Promise<{ saved: number; unresolved: number; conflicts: BandConflict[] }> {
  const legenda = await listShiftCodes()

  return withWriteLock(async () => {
    // Le celle già in tabella prodotte da *altre* bande: è con quelle che si
    // confronta. Rileggere la stessa banda invece sostituisce le proprie celle.
    const esistenti = await prisma.rosterCell.findMany({ where: { rosterId } })
    const perChiave = new Map(esistenti.map((c) => [`${c.day}:${c.columnLabel}`, c]))

    const conflicts: BandConflict[] = []
    const daCreare: Array<{
      rosterId: string
      day: number
      columnLabel: string
      rawCode: string
      code: string | null
      confidence: number
      handCorrected: boolean
      bandIndex: number
    }> = []
    const daMarcareConflitto: Array<{ id: string; conflictWith: string }> = []

    for (const cell of cells) {
      const rawCode = cell.code.trim()
      if (rawCode === '') continue

      const columnLabel = cell.column.trim()
      const esistente = perChiave.get(`${cell.day}:${columnLabel}`)

      if (esistente && esistente.bandIndex !== bandIndex) {
        if (esistente.rawCode !== rawCode) {
          conflicts.push({
            day: cell.day,
            columnLabel,
            kept: esistente.rawCode,
            discarded: rawCode,
            bandIndex,
          })
          daMarcareConflitto.push({ id: esistente.id, conflictWith: rawCode })
        }
        continue
      }

      daCreare.push({
        rosterId,
        day: cell.day,
        columnLabel,
        rawCode,
        code: matchCode(rawCode, legenda)?.code ?? null,
        confidence: cell.confidence,
        handCorrected: cell.handCorrected,
        bandIndex,
      })
    }

    await prisma.$transaction([
      // Le celle di questa banda vengono rifatte da zero: una rilettura dopo un
      // fallimento non deve duplicare nulla né lasciare celle vecchie.
      prisma.rosterCell.deleteMany({ where: { rosterId, bandIndex } }),
      prisma.rosterCell.createMany({ data: daCreare }),
      ...daMarcareConflitto.map((c) =>
        prisma.rosterCell.update({
          where: { id: c.id },
          data: { conflicted: true, conflictWith: c.conflictWith },
        }),
      ),
      prisma.rosterBand.updateMany({
        where: { rosterId, index: bandIndex },
        data: {
          status: 'done',
          error: null,
          rawOutput: meta.rawOutput,
          attempts: { increment: 1 },
        },
      }),
      prisma.roster.update({ where: { id: rosterId }, data: { heartbeatAt: meta.now } }),
    ])

    return {
      saved: daCreare.length,
      unresolved: daCreare.filter((c) => c.code === null).length,
      conflicts,
    }
  })
}

/** Una banda non letta va dichiarata: un buco silenzioso è il guasto peggiore. */
export async function markBandFailed(
  rosterId: string,
  bandIndex: number,
  error: string,
  rawOutput: string | null,
  now: Date,
): Promise<void> {
  await withWriteLock(async () => {
    await prisma.$transaction([
      prisma.rosterBand.updateMany({
        where: { rosterId, index: bandIndex },
        data: { status: 'failed', error, rawOutput, attempts: { increment: 1 } },
      }),
      prisma.roster.update({ where: { id: rosterId }, data: { heartbeatAt: now } }),
    ])
  })
}

export async function finishExtraction(
  rosterId: string,
  meta: { provider: string; now: Date },
): Promise<ExtractionStatus> {
  return withWriteLock(async () => {
    const bande = await prisma.rosterBand.findMany({
      where: { rosterId },
      select: { status: true },
    })
    const lette = bande.filter((b) => b.status === 'done').length

    const status: ExtractionStatus =
      lette === bande.length && bande.length > 0 ? 'extracted' : lette === 0 ? 'failed' : 'partial'

    await prisma.roster.update({
      where: { id: rosterId },
      data: { status, provider: meta.provider, heartbeatAt: meta.now },
    })
    return status
  })
}

/**
 * Un estrazione interrotta da un riavvio resterebbe `extracting` per sempre, e per
 * l utente sarebbe un vicolo cieco: nessun avanzamento e nessun modo di riprendere.
 * Chi trova un battito vecchio la marca `interrupted`, da cui si riprende.
 */
export async function reclaimStaleExtractions(now: Date, staleMs: number): Promise<string[]> {
  return withWriteLock(async () => {
    const soglia = new Date(now.getTime() - staleMs)
    const ferme = await prisma.roster.findMany({
      where: {
        status: 'extracting',
        OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: soglia } }],
      },
      select: { id: true },
    })
    if (ferme.length === 0) return []

    await prisma.roster.updateMany({
      where: { id: { in: ferme.map((r) => r.id) } },
      data: { status: 'interrupted' },
    })
    return ferme.map((r) => r.id)
  })
}

/**
 * Le tabelle da riprendere: solo quelle per cui la referente aveva autorizzato
 * l invio (`requestedAt`) e a cui manca almeno una banda. Senza autorizzazione
 * nessuna foto viene mandata da nessuna parte, nemmeno dopo un riavvio.
 */
export async function resumableRosters(): Promise<Array<{ id: string }>> {
  return prisma.roster.findMany({
    where: {
      status: { in: ['extracting', 'interrupted'] },
      requestedAt: { not: null },
      bands: { some: { status: { not: 'done' } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
}

export interface RosterProgress {
  status: string
  requested: boolean
  bandsTotal: number
  bandsDone: number
  bandsFailed: number
  missingBands: number[]
  cells: number
  unknownCodes: number
  handCorrected: number
  conflicted: number
  heartbeatAt: Date | null
  error: string | null
}

export async function rosterProgress(rosterId: string): Promise<RosterProgress> {
  const roster = await prisma.roster.findUniqueOrThrow({
    where: { id: rosterId },
    select: { status: true, requestedAt: true, heartbeatAt: true, error: true },
  })
  const bande = await prisma.rosterBand.findMany({
    where: { rosterId },
    orderBy: { index: 'asc' },
    select: { index: true, status: true },
  })
  const celle = await prisma.rosterCell.findMany({
    where: { rosterId },
    select: { code: true, handCorrected: true, conflicted: true },
  })

  return {
    status: roster.status,
    requested: roster.requestedAt !== null,
    bandsTotal: bande.length,
    bandsDone: bande.filter((b) => b.status === 'done').length,
    bandsFailed: bande.filter((b) => b.status === 'failed').length,
    missingBands: bande.filter((b) => b.status !== 'done').map((b) => b.index),
    cells: celle.length,
    unknownCodes: celle.filter((c) => c.code === null).length,
    handCorrected: celle.filter((c) => c.handCorrected).length,
    conflicted: celle.filter((c) => c.conflicted).length,
    heartbeatAt: roster.heartbeatAt,
    error: roster.error,
  }
}

export async function markExtractionFailed(
  rosterId: string,
  rawOutput: string | null,
  error?: string,
): Promise<void> {
  await withWriteLock(async () => {
    await prisma.roster.update({
      where: { id: rosterId },
      data: { status: 'failed', rawOutput, ...(error === undefined ? {} : { error }) },
    })
  })
}

export async function getRosterWithCells(rosterId: string) {
  return prisma.roster.findUnique({
    where: { id: rosterId },
    include: { cells: { orderBy: [{ day: 'asc' }, { columnLabel: 'asc' }] } },
  })
}
