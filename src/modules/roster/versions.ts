import { prisma } from '@/lib/db'
import { normalizeColumn } from '@/modules/extract/schema'

/**
 * Le versioni della stessa tabella: stesso `(year, month, ward)`, `version` crescente.
 * Serve al diff (Fase 5) e al riporto delle conferme. Conta solo l ultima versione:
 * qui non si costruisce una storia, si trova «quella prima di questa».
 */
export interface RosterVersionRef {
  id: string
  year: number
  month: number
  ward: string
  version: number
  /**
   * `extracted` o `partial`: serve al diff per sapere se un `added` è davvero nuovo
   * o solo un turno che quella lettura non aveva visto.
   */
  status: string
}

/**
 * La versione precedente **letta** (`extracted` o `partial`) dello stesso
 * `(year, month, ward)`. Una versione caricata e mai letta (`uploaded`), fallita
 * (`failed`) o interrotta (`interrupted`) non ha celle: non è una base di
 * confronto valida né per il diff né per il riporto delle conferme.
 */
export async function previousVersionOf(rosterId: string): Promise<RosterVersionRef | null> {
  const corrente = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { year: true, month: true, ward: true, version: true },
  })
  if (!corrente) return null

  return prisma.roster.findFirst({
    where: {
      year: corrente.year,
      month: corrente.month,
      ward: corrente.ward,
      version: { lt: corrente.version },
      status: { in: ['extracted', 'partial'] },
    },
    orderBy: { version: 'desc' },
    select: { id: true, year: true, month: true, ward: true, version: true, status: true },
  })
}

/**
 * Tutte le versioni **lette** precedenti a questa, dalla più recente alla più
 * vecchia. Il riporto le guarda tutte, non solo l ultima: se una lettura parziale
 * salta la colonna di Sara, la versione dopo trova le sue conferme dove sono
 * rimaste — due versioni indietro — invece di lasciarle là per sempre.
 */
async function previousReadVersionsOf(rosterId: string): Promise<RosterVersionRef[]> {
  const corrente = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { year: true, month: true, ward: true, version: true },
  })
  if (!corrente) return []

  return prisma.roster.findMany({
    where: {
      year: corrente.year,
      month: corrente.month,
      ward: corrente.ward,
      version: { lt: corrente.version },
      status: { in: ['extracted', 'partial'] },
    },
    orderBy: { version: 'desc' },
    select: { id: true, year: true, month: true, ward: true, version: true, status: true },
  })
}

/** Le celle di una versione con i soli campi che il diff e il riporto usano. */
export async function cellsForDiff(rosterId: string) {
  return prisma.rosterCell.findMany({
    where: { rosterId },
    orderBy: [{ columnLabel: 'asc' }, { day: 'asc' }],
    select: {
      day: true,
      columnLabel: true,
      rawCode: true,
      code: true,
      correctedCode: true,
      correctedAt: true,
      correctedBy: true,
    },
  })
}

export interface CarryOverResult {
  movedAssignments: number
  carriedCorrections: number
  /** Utenti le cui assegnazioni sono rimaste sulla versione vecchia: la nuova non ha la loro colonna. */
  skippedUsers: string[]
}

/**
 * Le conferme seguono la versione nuova. Si **spostano** (cambia `rosterId`), non
 * si copiano: una riga sola per persona e giorno, sempre sull ultima versione, e
 * nessun rischio che due versioni litighino sullo stesso `eventId`.
 *
 * Per persona, e solo se la foto nuova contiene la sua colonna: se manca (lettura
 * parziale) le sue assegnazioni restano dove sono e lei continua a vedere la
 * versione vecchia, che è l unica in cui la sua colonna esiste.
 *
 * Le assegnazioni da riportare si cercano su **tutte** le versioni lette
 * precedenti, non solo sull ultima: una collega saltata da una lettura parziale ha
 * le conferme due versioni indietro, e guardando solo la precedente ci
 * resterebbero per sempre. Se la stessa persona ha una riga su più versioni vecchie
 * per lo stesso giorno — non dovrebbe, le righe si spostano sempre — vince quella
 * della versione più alta, che è la più recente.
 *
 * Le correzioni a mano si riportano alla cella omologa solo se il modello ha letto
 * la stessa cosa di prima: se il grezzo è cambiato è cambiato il foglio, e il
 * giudizio vecchio non vale più. Si vedrà nel diff.
 *
 * Non tocca Google e non cambia lo stato di nessuna assegnazione: un turno il cui
 * codice è cambiato resta confermato **con il codice vecchio**, ed è la griglia a
 * dire «va riconfermata» (regola invariante 1).
 *
 * Le letture qui dentro sono sicure fuori da una transazione **solo** perché ogni
 * scrittore di `Assignment` e `RosterCell` passa da `withWriteLock`, e il chiamante
 * (`finishExtraction`) la tiene già mentre chiama questa funzione. Questa funzione
 * **non deve** prendere il lock da sé: `withWriteLock` è una coda di promesse, e un
 * lock annidato è un deadlock.
 */
export async function carryOverAssignments(newRosterId: string): Promise<CarryOverResult> {
  const nessuno: CarryOverResult = { movedAssignments: 0, carriedCorrections: 0, skippedUsers: [] }
  const precedenti = await previousReadVersionsOf(newRosterId)
  // La più recente delle versioni lette: è la base del riporto delle correzioni a
  // mano (lo stesso valore che `previousVersionOf` restituisce).
  const precedente = precedenti[0]
  if (!precedente) return nessuno

  const versionePerRoster = new Map(precedenti.map((p) => [p.id, p.version]))
  const vecchie = (
    await prisma.assignment.findMany({ where: { rosterId: { in: precedenti.map((p) => p.id) } } })
  ).sort((a, b) => (versionePerRoster.get(b.rosterId) ?? 0) - (versionePerRoster.get(a.rosterId) ?? 0))
  const [celleNuove, celleVecchie] = await Promise.all([cellsForDiff(newRosterId), cellsForDiff(precedente.id)])
  if (vecchie.length === 0 && celleVecchie.every((c) => c.correctedAt === null)) return nessuno

  const colonneNuove = new Set(celleNuove.map((c) => normalizeColumn(c.columnLabel)))
  const alias = await prisma.columnAlias.findMany({
    where: { ignored: false, userId: { not: null } },
    select: { label: true, userId: true },
  })
  const colonnePerUtente = new Map<string, Set<string>>()
  for (const a of alias) {
    if (!a.userId) continue
    const set = colonnePerUtente.get(a.userId) ?? new Set<string>()
    set.add(normalizeColumn(a.label))
    colonnePerUtente.set(a.userId, set)
  }

  const giaSullaNuova = new Set(
    (await prisma.assignment.findMany({ where: { rosterId: newRosterId }, select: { userId: true, day: true } })).map(
      (a) => `${a.userId}:${a.day}`,
    ),
  )

  const daSpostare: string[] = []
  const skipped = new Set<string>()
  // `vecchie` è ordinata dalla versione più alta alla più bassa: la prima riga che si
  // incontra per una coppia (persona, giorno) è la più recente, e le altre restano
  // dove sono. Spostarle tutte violerebbe l unicità `(userId, rosterId, day)`.
  const gia = new Set(giaSullaNuova)
  for (const a of vecchie) {
    const colonne = colonnePerUtente.get(a.userId)
    const haColonna = colonne !== undefined && [...colonne].some((c) => colonneNuove.has(c))
    if (!haColonna) {
      skipped.add(a.userId)
      continue
    }
    const chiave = `${a.userId}:${a.day}`
    if (gia.has(chiave)) continue
    gia.add(chiave)
    daSpostare.push(a.id)
  }

  const nuovePerChiave = new Map(celleNuove.map((c) => [`${normalizeColumn(c.columnLabel)}:${c.day}`, c]))
  const correzioni = celleVecchie
    .filter((c) => c.correctedAt !== null)
    .map((vecchia) => ({ vecchia, nuova: nuovePerChiave.get(`${normalizeColumn(vecchia.columnLabel)}:${vecchia.day}`) }))
    .filter(({ vecchia, nuova }) => nuova !== undefined && nuova.correctedAt === null && nuova.rawCode === vecchia.rawCode)

  await prisma.$transaction(async (tx) => {
    if (daSpostare.length > 0) {
      await tx.assignment.updateMany({ where: { id: { in: daSpostare } }, data: { rosterId: newRosterId } })
    }
    for (const { vecchia, nuova } of correzioni) {
      if (!nuova) continue
      await tx.rosterCell.updateMany({
        where: { rosterId: newRosterId, day: nuova.day, columnLabel: nuova.columnLabel },
        data: { correctedCode: vecchia.correctedCode, correctedAt: vecchia.correctedAt, correctedBy: vecchia.correctedBy },
      })
    }
  })

  return {
    movedAssignments: daSpostare.length,
    carriedCorrections: correzioni.length,
    skippedUsers: [...skipped],
  }
}
