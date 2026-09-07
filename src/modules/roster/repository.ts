import { prisma } from '@/lib/db'
import { listShiftCodes, matchCode } from '@/modules/codes'
import {
  normalizeColumn,
  storedExtractionSchema,
  type BandFailure,
  type ExtractedCell,
  type Extraction,
} from '@/modules/extract'
import { carryOverAssignments } from './versions'

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

/** Una banda del piano, come la vede il database: indice e giorni coperti. */
export interface BandSlot {
  index: number
  dayFrom: number
  dayTo: number
}

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
}): Promise<{ id: string; version: number }> {
  return withWriteLock(async () => {
    const version = await nextVersion(input.year, input.month, input.ward)
    return prisma.roster.create({
      data: { ...input, version, status: 'uploaded' },
      select: { id: true, version: true },
    })
  })
}

/**
 * Salva le celle risolvendo ogni codice letto con la legenda: il testo grezzo resta
 * sempre, il codice risolto è null quando la legenda non lo conosce — sarà l utente
 * a deciderlo, e non è un errore di estrazione.
 *
 * È il salvataggio **in un colpo solo**, quello che usa `npm run eval`: prende
 * l estrazione già fusa di tutte le bande. Il percorso applicativo passa invece da
 * `saveBandCells`, banda per banda, perché un estrazione lunga deve
 * poter riprendere dopo un riavvio.
 *
 * `meta.missingBands` sono le bande che il modello non ha letto, o ha letto solo
 * in parte (estrazione a ritagli): finiscono nel database come JSON e portano lo
 * stato a `partial`. Sono la ragione per cui questo stato esiste: tre celle non
 * lette per un problema tecnico non devono somigliare a tre celle vuote sul
 * foglio, perché una cella che manca in silenzio è un turno che scompare. Un
 * salvataggio senza buchi le **ripulisce**, altrimenti resterebbe la
 * dichiarazione di un buco che non c è più.
 *
 * `meta.conflicts` sono le celle che la fusione ha scartato o risolto: un
 * segnale che prima si fermava in memoria.
 *
 * L estrazione passa da `storedExtractionSchema` **prima** di toccare il database
 * (regola invariante 3): la fusione garantisce per costruzione due delle tre
 * invarianti, ma "per costruzione" è una proprietà del codice di oggi e non un
 * controllo, e questa è l ultima porta prima dei dati dell utente.
 */
export async function saveExtraction(
  rosterId: string,
  extraction: Extraction,
  meta: {
    provider: string
    rawOutput: string
    missingBands?: BandFailure[]
    conflicts?: number
  },
): Promise<{ cells: number; unresolved: number }> {
  const validata = storedExtractionSchema.parse(extraction)
  const legenda = await listShiftCodes()

  const celle = validata.cells
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

  const buchi = meta.missingBands ?? []
  const parziale = buchi.length > 0

  await prisma.$transaction([
    prisma.rosterCell.deleteMany({ where: { rosterId } }),
    // createMany in un unica istruzione invece di una create per cella: stesso esito
    // osservabile (niente skipDuplicates, inutile dopo la deleteMany), molto più
    // efficiente sulle ~240 celle di una tabella reale.
    prisma.rosterCell.createMany({ data: celle }),
    prisma.roster.update({
      where: { id: rosterId },
      data: {
        status: parziale ? 'partial' : 'extracted',
        provider: meta.provider,
        rawOutput: meta.rawOutput,
        missingBands: parziale ? JSON.stringify(buchi) : null,
        conflicts: meta.conflicts ?? 0,
      },
    }),
  ])

  return { cells: celle.length, unresolved: celle.filter((c) => c.code === null).length }
}

export async function setRosterImagePath(rosterId: string, imagePath: string): Promise<void> {
  await withWriteLock(async () => {
    await prisma.roster.update({ where: { id: rosterId }, data: { imagePath } })
  })
}

/**
 * Registra l autorizzazione della referente all invio della foto al provider AI e
 * crea le bande pendenti. È **idempotente**: richiamata su una ripresa lascia in
 * pace le bande già lette e non riscrive `requestedAt`, che è la traccia di quando
 * l invio è stato autorizzato la prima volta.
 *
 * Ogni banda porta i giorni che copre: le bande di questa pipeline coprono mezzo
 * mese ciascuna, quindi senza `dayFrom`/`dayTo` un buco si potrebbe dichiarare
 * solo per indice di banda — che per un infermiera non significa niente.
 *
 * Con `bands` vuoto registra la **sola autorizzazione**: è quello che fa la
 * richiesta HTTP, che non può permettersi di rilevare il riquadro sulla foto
 * prima di rispondere. Il piano vero arriva dal job, alla prima passata.
 */
export async function prepareExtraction(
  rosterId: string,
  bands: BandSlot[],
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
    const daCreare = bands.filter((banda) => !giaCreate.has(banda.index))
    if (daCreare.length > 0) {
      await prisma.rosterBand.createMany({
        data: daCreare.map((banda) => ({
          rosterId,
          index: banda.index,
          dayFrom: banda.dayFrom,
          dayTo: banda.dayTo,
        })),
      })
    }

    // I giorni coperti possono essere ignoti su una banda creata prima di questa
    // versione: si riallineano senza toccare lo stato di lettura.
    for (const banda of bands) {
      if (!giaCreate.has(banda.index)) continue
      await prisma.rosterBand.updateMany({
        where: { rosterId, index: banda.index, dayFrom: null },
        data: { dayFrom: banda.dayFrom, dayTo: banda.dayTo },
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

/** Indici delle bande ancora da leggere: pendenti, parziali e fallite. */
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
 * L etichetta di colonna si **canonizza** su quella già in tabella quando le due
 * hanno la stessa identità secondo `normalizeColumn`: la fusione delle bande
 * canonizza dentro la propria chiamata, ma qui le bande arrivano una alla volta, e
 * senza questo passaggio `SARA DP.` letto in una banda e `SARA DP` nell altra
 * diventerebbero due colonne da mezzo mese ciascuna — la stessa infermiera spaccata
 * in due, senza nemmeno un conflitto a dirlo.
 *
 * Le bande possono sovrapporsi, quindi la stessa cella può arrivare due volte. Se le
 * due letture coincidono, non succede nulla; se differiscono vince la **prima** e
 * la seconda resta scritta accanto come conflitto. La scelta è deterministica e non
 * usa la confidenza: sulla misura reale nessuna cella era sotto 0,8, comprese le
 * due sbagliate, quindi la confidenza non distingue nulla.
 *
 * `meta.partial` è la banda che ha risposto con **meno** celle di quelle chieste:
 * le celle lette si tengono, ma lo stato resta un buco dichiarato invece di
 * `done`, perché una banda letta a metà somiglia a un foglio con le celle vuote.
 */
export async function saveBandCells(
  rosterId: string,
  bandIndex: number,
  cells: ExtractedCell[],
  meta: { rawOutput: string | null; now: Date; partial?: string | null },
): Promise<{ saved: number; unresolved: number; conflicts: BandConflict[] }> {
  const legenda = await listShiftCodes()

  return withWriteLock(async () => {
    // Le celle già in tabella prodotte da *altre* bande: è con quelle che si
    // confronta. Rileggere la stessa banda invece sostituisce le proprie celle.
    const esistenti = await prisma.rosterCell.findMany({ where: { rosterId } })

    // Il canone delle etichette: chiave normalizzata -> etichetta già scritta.
    const canone = new Map<string, string>()
    for (const cella of esistenti) {
      const chiave = normalizeColumn(cella.columnLabel)
      if (!canone.has(chiave)) canone.set(chiave, cella.columnLabel)
    }

    const perChiave = new Map(
      esistenti.map((c) => [`${c.day}:${normalizeColumn(c.columnLabel)}`, c]),
    )

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

      const letta = cell.column.trim()
      const chiaveColonna = normalizeColumn(letta)
      const columnLabel = canone.get(chiaveColonna) ?? letta
      canone.set(chiaveColonna, columnLabel)

      const esistente = perChiave.get(`${cell.day}:${chiaveColonna}`)

      // Una cella corretta a mano non è più del modello: rileggere la banda non la
      // sovrascrive, e la rilettura non diventa nemmeno un conflitto — il conflitto è
      // fra due letture del modello, e qui una persona ha già deciso.
      if (esistente && esistente.correctedAt !== null) continue

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

    const parziale = meta.partial ?? null

    await prisma.$transaction([
      // Le celle di questa banda vengono rifatte da zero: una rilettura dopo un
      // fallimento non deve duplicare nulla né lasciare celle vecchie. Le correzioni a
      // mano no: quelle sopravvivono a qualunque rilettura, ed è il motivo per cui
      // esistono.
      prisma.rosterCell.deleteMany({ where: { rosterId, bandIndex, correctedAt: null } }),
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
          status: parziale === null ? 'done' : 'partial',
          error: parziale,
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
  meta: { provider: string; now: Date; conflicts?: number },
): Promise<ExtractionStatus> {
  return withWriteLock(async () => {
    const bande = await prisma.rosterBand.findMany({
      where: { rosterId },
      select: { status: true },
    })
    const lette = bande.filter((b) => b.status === 'done').length
    // una banda letta a metà ha comunque prodotto celle: conta come lettura
    // avvenuta per distinguere `partial` da `failed`, non come banda completa
    const conCelle = bande.filter((b) => b.status === 'done' || b.status === 'partial').length

    const status: ExtractionStatus =
      lette === bande.length && bande.length > 0
        ? 'extracted'
        : conCelle === 0
          ? 'failed'
          : 'partial'

    // Fase 5: le conferme della versione precedente seguono questa, se la sua lettura
    // è arrivata da qualche parte. Su `failed` non c è una foto nuova da cui
    // ripartire, e le conferme restano dove sono.
    //
    // Il riporto viene **prima** dello stato terminale, e l ordine conta: se lancia,
    // l errore risale con la tabella ancora `extracting`, `reclaimStaleExtractions` la
    // porta a `interrupted` e il worker richiama questa funzione, che riprova il
    // riporto. Scrivendo prima lo stato, una tabella «finita» senza conferme non
    // avrebbe nessuno che riprovi.
    if (status !== 'failed') await carryOverAssignments(rosterId)

    await prisma.roster.update({
      where: { id: rosterId },
      data: {
        status,
        provider: meta.provider,
        heartbeatAt: meta.now,
        ...(meta.conflicts === undefined ? {} : { conflicts: meta.conflicts }),
      },
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
 *
 * Anche una tabella **senza nessuna banda** va ripresa: l autorizzazione si
 * registra nella richiesta HTTP, il piano delle bande lo fa il job (deve
 * rilevare il riquadro sulla foto, che costa secondi). Fra i due momenti c è una
 * finestra in cui un riavvio lascerebbe la tabella autorizzata e ferma per
 * sempre, che è il vicolo cieco da cui `interrupted` esiste per uscire.
 */
export async function resumableRosters(): Promise<Array<{ id: string }>> {
  return prisma.roster.findMany({
    where: {
      status: { in: ['extracting', 'interrupted'] },
      requestedAt: { not: null },
      OR: [{ bands: { some: { status: { not: 'done' } } } }, { bands: { none: {} } }],
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
    select: { code: true, correctedAt: true, correctedCode: true, handCorrected: true, conflicted: true },
  })

  return {
    status: roster.status,
    requested: roster.requestedAt !== null,
    bandsTotal: bande.length,
    bandsDone: bande.filter((b) => b.status === 'done').length,
    bandsFailed: bande.filter((b) => b.status === 'failed' || b.status === 'partial').length,
    missingBands: bande.filter((b) => b.status !== 'done').map((b) => b.index),
    cells: celle.length,
    // Una cella corretta a mano ha un codice della legenda (o è dichiarata vuota): non
    // è un codice sconosciuto da risolvere.
    unknownCodes: celle.filter((c) => c.code === null && c.correctedAt === null).length,
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

/** Coordinate della tabella, senza le celle: mese e reparto per chi sincronizza. */
export async function getRosterMonth(rosterId: string): Promise<{
  id: string
  year: number
  month: number
  ward: string
  version: number
} | null> {
  return prisma.roster.findUnique({
    where: { id: rosterId },
    select: { id: true, year: true, month: true, ward: true, version: true },
  })
}

export async function getRosterWithCells(rosterId: string) {
  return prisma.roster.findUnique({
    where: { id: rosterId },
    include: { cells: { orderBy: [{ day: 'asc' }, { columnLabel: 'asc' }] } },
  })
}
