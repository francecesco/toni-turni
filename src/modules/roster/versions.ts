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
}

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
    },
    orderBy: { version: 'desc' },
    select: { id: true, year: true, month: true, ward: true, version: true },
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
 * Le correzioni a mano si riportano alla cella omologa solo se il modello ha letto
 * la stessa cosa di prima: se il grezzo è cambiato è cambiato il foglio, e il
 * giudizio vecchio non vale più. Si vedrà nel diff.
 *
 * Non tocca Google e non cambia lo stato di nessuna assegnazione: un turno il cui
 * codice è cambiato resta confermato **con il codice vecchio**, ed è la griglia a
 * dire «va riconfermata» (regola invariante 1).
 */
export async function carryOverAssignments(newRosterId: string): Promise<CarryOverResult> {
  const nessuno: CarryOverResult = { movedAssignments: 0, carriedCorrections: 0, skippedUsers: [] }
  const precedente = await previousVersionOf(newRosterId)
  if (!precedente) return nessuno

  const vecchie = await prisma.assignment.findMany({ where: { rosterId: precedente.id } })
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
  for (const a of vecchie) {
    const colonne = colonnePerUtente.get(a.userId)
    const haColonna = colonne !== undefined && [...colonne].some((c) => colonneNuove.has(c))
    if (!haColonna) {
      skipped.add(a.userId)
      continue
    }
    if (giaSullaNuova.has(`${a.userId}:${a.day}`)) continue
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
