# Fase 5 — Versioni: riporto delle conferme e diff — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quando la referente carica una seconda foto dello stesso mese, le conferme già date
seguono la versione nuova, l'infermiera vede solo i giorni cambiati della sua colonna, e la referente
vede il diff di tutte le colonne.

**Architecture:** le assegnazioni (`Assignment`) vengono **spostate** sulla versione nuova alla
chiusura della lettura (`finishExtraction`), per persona e solo se la sua colonna c'è; le correzioni
a mano si riportano solo a grezzo uguale. Il diff è una funzione pura sulle celle delle due versioni,
calcolata al volo. La griglia deriva badge e riquadro dal diff; una pagina nuova, solo referente,
mostra il diff completo. Il modulo `calendar` non cambia.

**Tech Stack:** Next.js 16 App Router, Prisma/SQLite, Vitest. Test di logica pura importano i
sottomoduli (`@/modules/review/diff`), il codice applicativo le facciate (`@/modules/review`).

**Spec:** `docs/superpowers/specs/2026-09-06-fase-5-versioni-design.md`

## Global Constraints

- Node 22 (`nvm use 22`), poi `npm test`; `npm run lint` esegue anche `tsc --noEmit`.
- TDD: ogni passo scrive il test, lo vede **fallire** per il motivo giusto, poi implementa.
- Identificatori e messaggi di commit in inglese; testi UI, commenti e descrizioni dei test in italiano.
- Nessun trailer `Co-Authored-By` né riga «Generated with» nei commit.
- Identità di colonna: **solo** `normalizeColumn` (`@/modules/extract/schema`); colonne di servizio:
  **solo** `isColonnaDiServizio` (`@/modules/extract/band-schema`); confronto di codici: `compactCode`
  (`@/modules/codes/normalize`).
- Nessuna scrittura su Google senza conferma nuova; nessuna cancellazione automatica di eventi.
- Le facciate `index.ts` si allargano, non si aggirano.
- I test su database usano `createTestDb()` da `tests/helpers/db.ts`, impostano
  `process.env.DATABASE_URL`, cancellano `globalThis.prisma`, fanno `vi.resetModules()` **prima**
  dell'import dinamico (vedi `tests/modules/review/repository.test.ts` come modello).

---

### Task 1: `diffVersions`, il diff puro fra due versioni

**Files:**
- Create: `src/modules/review/diff.ts`
- Modify: `src/modules/review/index.ts`
- Test: `tests/modules/review/diff.test.ts`

**Interfaces:**
- Consumes: `normalizeColumn` da `@/modules/extract/schema`, `isColonnaDiServizio` da
  `@/modules/extract/band-schema`, `compactCode` da `@/modules/codes/normalize`.
- Produces:
  ```ts
  export type ChangeKind = 'changed' | 'added' | 'removed'
  export interface DiffCell {
    day: number
    columnLabel: string
    code: string | null
    correctedCode?: string | null
    correctedAt?: Date | null
  }
  export interface VersionChange {
    /** Etichetta come sta sul foglio nuovo (o su quello vecchio se la colonna è sparita). */
    columnLabel: string
    /** Chiave `normalizeColumn`, per raggruppare. */
    columnKey: string
    day: number
    kind: ChangeKind
    before: string | null
    after: string | null
  }
  export function effectiveCode(cell: DiffCell): string | null
  export function diffVersions(previous: DiffCell[], next: DiffCell[]): VersionChange[]
  ```
  Ordinamento dell'output: per `columnKey`, poi per `day`.

- [ ] **Step 1: scrivi il test rosso**

```ts
// tests/modules/review/diff.test.ts
import { describe, expect, it } from 'vitest'
import { diffVersions, effectiveCode, type DiffCell } from '@/modules/review/diff'

function cella(day: number, columnLabel: string, code: string | null, over: Partial<DiffCell> = {}): DiffCell {
  return { day, columnLabel, code, ...over }
}

describe('effectiveCode — il codice che conta su una cella', () => {
  it('senza correzione è la lettura del modello', () => {
    expect(effectiveCode(cella(1, 'MERY', 'M'))).toBe('M')
  })

  it('con una correzione a mano vince la correzione', () => {
    expect(effectiveCode(cella(1, 'MERY', 'M', { correctedCode: 'P', correctedAt: new Date() }))).toBe('P')
  })

  it('correzione a mano con codice null vuol dire «il foglio qui è vuoto»', () => {
    expect(effectiveCode(cella(1, 'MERY', 'M', { correctedCode: null, correctedAt: new Date() }))).toBeNull()
  })
})

describe('diffVersions — cosa è cambiato fra due foto dello stesso mese', () => {
  it('celle uguali non compaiono', () => {
    const prima = [cella(1, 'MERY', 'M'), cella(2, 'MERY', 'P')]
    const dopo = [cella(1, 'MERY', 'M'), cella(2, 'MERY', 'P')]
    expect(diffVersions(prima, dopo)).toEqual([])
  })

  it('un codice diverso è «changed», con prima e dopo', () => {
    expect(diffVersions([cella(5, 'MERY', 'M')], [cella(5, 'MERY', 'P')])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 5, kind: 'changed', before: 'M', after: 'P' },
    ])
  })

  it('una cella che prima non c era, o era vuota, è «added»', () => {
    expect(diffVersions([], [cella(12, 'MERY', 'M')])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 12, kind: 'added', before: null, after: 'M' },
    ])
    expect(diffVersions([cella(12, 'MERY', null)], [cella(12, 'MERY', 'M')])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 12, kind: 'added', before: null, after: 'M' },
    ])
  })

  it('una cella che c era e ora manca, o è vuota, è «removed»', () => {
    expect(diffVersions([cella(20, 'MERY', 'M')], [])).toEqual([
      { columnLabel: 'MERY', columnKey: 'MERY', day: 20, kind: 'removed', before: 'M', after: null },
    ])
  })

  it('confronta il codice effettivo: una correzione a mano sulla vecchia versione conta come il suo valore', () => {
    // La referente aveva corretto M → P sulla foto vecchia; la nuova legge P: nessun cambiamento.
    const prima = [cella(3, 'MERY', 'M', { correctedCode: 'P', correctedAt: new Date() })]
    const dopo = [cella(3, 'MERY', 'P')]
    expect(diffVersions(prima, dopo)).toEqual([])
  })

  it('una cella svuotata a mano sulla vecchia versione è vuota: se la nuova legge M è «added»', () => {
    const prima = [cella(3, 'MERY', 'M', { correctedCode: null, correctedAt: new Date() })]
    const dopo = [cella(3, 'MERY', 'M')]
    expect(diffVersions(prima, dopo).map((c) => c.kind)).toEqual(['added'])
  })

  it('le forme compatte dello stesso codice sono uguali: "M 2°P" e "M2°P"', () => {
    expect(diffVersions([cella(1, 'MERY', 'M 2°P')], [cella(1, 'MERY', 'M2°P')])).toEqual([])
  })

  it('l identità di colonna è normalizeColumn: "SARA DP." e "SARA DP" sono la stessa colonna', () => {
    expect(diffVersions([cella(1, 'SARA DP.', 'M')], [cella(1, 'SARA DP', 'M')])).toEqual([])
    expect(diffVersions([cella(1, 'SARA DP.', 'M')], [cella(1, 'SARA DP', 'P')])[0]).toMatchObject({
      columnLabel: 'SARA DP',
      columnKey: 'SARADP',
    })
  })

  it('le colonne di servizio e i totali non compaiono mai', () => {
    const prima = [cella(1, 'AIUTO MATT.', 'ANNA'), cella(1, 'TOT M', '3')]
    const dopo = [cella(1, 'AIUTO MATT.', 'LUCA'), cella(1, 'TOT M', '4')]
    expect(diffVersions(prima, dopo)).toEqual([])
  })

  it('ordina per colonna e poi per giorno', () => {
    const prima = [cella(9, 'MERY', 'M'), cella(2, 'ALEX', 'M'), cella(4, 'MERY', 'M')]
    const dopo = [cella(9, 'MERY', 'P'), cella(2, 'ALEX', 'P'), cella(4, 'MERY', 'P')]
    expect(diffVersions(prima, dopo).map((c) => `${c.columnKey}:${c.day}`)).toEqual([
      'ALEX:2',
      'MERY:4',
      'MERY:9',
    ])
  })
})
```

- [ ] **Step 2: eseguilo e vedilo fallire**

Run: `npx vitest run tests/modules/review/diff.test.ts`
Expected: FAIL con `Cannot find package '@/modules/review/diff'`.

- [ ] **Step 3: implementa**

```ts
// src/modules/review/diff.ts
import { compactCode } from '@/modules/codes/normalize'
import { isColonnaDiServizio } from '@/modules/extract/band-schema'
import { normalizeColumn } from '@/modules/extract/schema'

/**
 * Il diff fra due versioni della stessa tabella, calcolato **al volo** dalle celle:
 * nessuna tabella nuova, niente da tenere allineato. Confronta il codice
 * **effettivo** (la correzione a mano se c è, altrimenti la lettura) nella forma
 * compatta, perché `M 2°P` e `M2°P` sono lo stesso turno. Le colonne di servizio
 * e i totali non sono turni di nessuno e non compaiono.
 */
export type ChangeKind = 'changed' | 'added' | 'removed'

export interface DiffCell {
  day: number
  columnLabel: string
  code: string | null
  correctedCode?: string | null
  correctedAt?: Date | null
}

export interface VersionChange {
  /** Etichetta come sta sul foglio nuovo (o su quello vecchio se la colonna è sparita). */
  columnLabel: string
  /** Chiave `normalizeColumn`, per raggruppare. */
  columnKey: string
  day: number
  kind: ChangeKind
  before: string | null
  after: string | null
}

/** `correctedAt` valorizzato con `correctedCode` null significa «il foglio qui è vuoto». */
export function effectiveCode(cell: DiffCell): string | null {
  if ((cell.correctedAt ?? null) !== null) return cell.correctedCode ?? null
  return cell.code
}

function key(cell: DiffCell): string {
  return `${normalizeColumn(cell.columnLabel)}:${cell.day}`
}

function same(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return compactCode(a) === compactCode(b)
}

export function diffVersions(previous: DiffCell[], next: DiffCell[]): VersionChange[] {
  const prima = new Map(previous.filter((c) => !isColonnaDiServizio(c.columnLabel)).map((c) => [key(c), c]))
  const dopo = new Map(next.filter((c) => !isColonnaDiServizio(c.columnLabel)).map((c) => [key(c), c]))

  const changes: VersionChange[] = []
  for (const k of new Set([...prima.keys(), ...dopo.keys()])) {
    const p = prima.get(k) ?? null
    const n = dopo.get(k) ?? null
    const before = p ? effectiveCode(p) : null
    const after = n ? effectiveCode(n) : null
    if (same(before, after)) continue

    const riferimento = n ?? p
    if (!riferimento) continue
    changes.push({
      columnLabel: riferimento.columnLabel,
      columnKey: normalizeColumn(riferimento.columnLabel),
      day: riferimento.day,
      kind: before === null ? 'added' : after === null ? 'removed' : 'changed',
      before,
      after,
    })
  }

  return changes.sort((a, b) => a.columnKey.localeCompare(b.columnKey) || a.day - b.day)
}
```

Poi in `src/modules/review/index.ts` aggiungi:

```ts
export type { ChangeKind, DiffCell, VersionChange } from './diff'
export { diffVersions, effectiveCode } from './diff'
```

- [ ] **Step 4: verde**

Run: `npx vitest run tests/modules/review/diff.test.ts`
Expected: 12 passed.

- [ ] **Step 5: commit**

```bash
git add src/modules/review/diff.ts src/modules/review/index.ts tests/modules/review/diff.test.ts
git commit -m "feat(review): pure diff between two versions of the same roster"
```

---

### Task 2: `previousVersionOf` e `cellsForDiff` nel modulo roster

**Files:**
- Create: `src/modules/roster/versions.ts`
- Modify: `src/modules/roster/index.ts`
- Test: `tests/modules/roster/versions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RosterVersionRef { id: string; year: number; month: number; ward: string; version: number }
  export async function previousVersionOf(rosterId: string): Promise<RosterVersionRef | null>
  export async function cellsForDiff(rosterId: string): Promise<Array<{
    day: number; columnLabel: string; rawCode: string; code: string | null
    correctedCode: string | null; correctedAt: Date | null; correctedBy: string | null
  }>>
  ```
  `previousVersionOf` restituisce la versione **immediatamente inferiore** dello stesso
  `(year, month, ward)`, qualunque sia il suo stato; `null` sulla prima versione o se il roster non
  esiste.

- [ ] **Step 1: test rosso**

```ts
// tests/modules/roster/versions.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let versions: typeof import('@/modules/roster/versions')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  versions = await import('@/modules/roster/versions')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
})

async function tabella(version: number, over: { month?: number; ward?: string; status?: string } = {}) {
  return prisma.roster.create({
    data: {
      year: 2026,
      month: over.month ?? 9,
      ward: over.ward ?? '3°PIANO',
      version,
      imagePath: `v${version}.jpg`,
      status: over.status ?? 'extracted',
    },
  })
}

describe('previousVersionOf', () => {
  it('sulla prima versione non c è niente prima', async () => {
    const v1 = await tabella(1)
    expect(await versions.previousVersionOf(v1.id)).toBeNull()
  })

  it('restituisce la versione immediatamente inferiore dello stesso mese e reparto', async () => {
    const v1 = await tabella(1)
    await tabella(2)
    const v3 = await tabella(3)
    const prima = await versions.previousVersionOf(v3.id)
    expect(prima?.version).toBe(2)
    expect(prima?.id).not.toBe(v1.id)
  })

  it('non confonde un altro mese o un altro reparto', async () => {
    await tabella(1, { month: 8 })
    await tabella(1, { ward: '2°PIANO' })
    const v2 = await tabella(2)
    // v1 di settembre 3°PIANO non esiste: prima di v2 non c è niente
    expect(await versions.previousVersionOf(v2.id)).toBeNull()
  })

  it('con un id inesistente risponde null, non lancia', async () => {
    expect(await versions.previousVersionOf('non-esiste')).toBeNull()
  })
})

describe('cellsForDiff', () => {
  it('restituisce le celle con lettura, correzione a mano e provenienza', async () => {
    const v1 = await tabella(1)
    await prisma.rosterCell.create({
      data: {
        rosterId: v1.id,
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M',
        code: 'M',
        confidence: 0.9,
        correctedCode: 'P',
        correctedAt: new Date('2026-09-01T10:00:00Z'),
        correctedBy: 'anna',
      },
    })

    const celle = await versions.cellsForDiff(v1.id)

    expect(celle).toEqual([
      {
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M',
        code: 'M',
        correctedCode: 'P',
        correctedAt: new Date('2026-09-01T10:00:00Z'),
        correctedBy: 'anna',
      },
    ])
  })
})
```

- [ ] **Step 2: rosso**

Run: `npx vitest run tests/modules/roster/versions.test.ts`
Expected: FAIL, `Cannot find package '@/modules/roster/versions'`.

- [ ] **Step 3: implementa**

```ts
// src/modules/roster/versions.ts
import { prisma } from '@/lib/db'

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
```

In `src/modules/roster/index.ts` aggiungi:

```ts
export type { RosterVersionRef } from './versions'
export { cellsForDiff, previousVersionOf } from './versions'
```

- [ ] **Step 4: verde**

Run: `npx vitest run tests/modules/roster/versions.test.ts`
Expected: 5 passed.

- [ ] **Step 5: commit**

```bash
git add src/modules/roster/versions.ts src/modules/roster/index.ts tests/modules/roster/versions.test.ts
git commit -m "feat(roster): find the previous version of a roster and read its cells for the diff"
```

---

### Task 3: `carryOverAssignments`, il riporto delle conferme e delle correzioni

**Files:**
- Modify: `src/modules/roster/versions.ts`
- Modify: `src/modules/roster/repository.ts` (dentro `finishExtraction`, dopo l'`update` dello stato)
- Modify: `src/modules/roster/index.ts`
- Test: `tests/modules/roster/versions.test.ts` (aggiungi un `describe`)
- Test: `tests/modules/roster/bands-repository.test.ts` (un caso in `finishExtraction`)

**Interfaces:**
- Consumes: `previousVersionOf`, `cellsForDiff` (Task 2); `normalizeColumn` da
  `@/modules/extract/schema`.
- Produces:
  ```ts
  export interface CarryOverResult { movedAssignments: number; carriedCorrections: number; skippedUsers: string[] }
  export async function carryOverAssignments(newRosterId: string): Promise<CarryOverResult>
  ```
  Chiamata da `finishExtraction` quando lo stato finale è `extracted` o `partial` (non `failed`).
  Idempotente: senza assegnazioni sulla versione precedente non fa niente.

Regole (dalla spec §4):
1. Per ogni utente con assegnazioni sulla versione precedente: se la versione nuova ha almeno una
   cella di una colonna a lui associata (`ColumnAlias` con `userId` = lui, `ignored = false`,
   confronto con `normalizeColumn`), le sue assegnazioni passano alla nuova con tutti i campi
   intatti; altrimenti restano dove sono e il suo id finisce in `skippedUsers`.
2. Se sulla nuova esiste già un'assegnazione `(userId, rosterId, day)`, quella della nuova vince e la
   riga vecchia non si tocca.
3. Una cella vecchia con `correctedAt` si riporta alla cella nuova omologa (stessa `columnKey`,
   stesso `day`) solo se `rawCode` coincide; si copiano `correctedCode`, `correctedAt`, `correctedBy`.
4. Tutto in `prisma.$transaction`.

- [ ] **Step 1: test rosso** — aggiungi in fondo a `tests/modules/roster/versions.test.ts`:

```ts
describe('carryOverAssignments — le conferme seguono la versione nuova', () => {
  let cristina: { id: string }
  let sara: { id: string }

  beforeEach(async () => {
    await prisma.assignment.deleteMany()
    await prisma.columnAlias.deleteMany()
    await prisma.user.deleteMany()
    cristina = await prisma.user.create({ data: { email: 'cri@example.com', displayName: 'Cristina' } })
    sara = await prisma.user.create({ data: { email: 'sara@example.com', displayName: 'Sara' } })
    await prisma.columnAlias.createMany({
      data: [
        { label: 'CRISTINA', userId: cristina.id, ignored: false },
        { label: 'SARADP', userId: sara.id, ignored: false },
      ],
    })
  })

  async function cella(rosterId: string, columnLabel: string, day: number, rawCode: string, over: Record<string, unknown> = {}) {
    return prisma.rosterCell.create({
      data: { rosterId, day, columnLabel, rawCode, code: rawCode, confidence: 0.9, ...over },
    })
  }

  async function assegnazione(rosterId: string, userId: string, day: number, over: Record<string, unknown> = {}) {
    return prisma.assignment.create({
      data: {
        rosterId,
        userId,
        day,
        code: 'M',
        columnLabel: 'CRISTINA',
        confirmedAt: new Date('2026-09-01T08:00:00Z'),
        eventId: `ev-${day}`,
        syncState: 'synced',
        syncedAt: new Date('2026-09-01T08:05:00Z'),
        ...over,
      },
    })
  }

  it('sposta le assegnazioni sulla versione nuova con tutti i campi intatti', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v2.id, 'CRISTINA', 1, 'M')
    await assegnazione(v1.id, cristina.id, 1)

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(1)
    const righe = await prisma.assignment.findMany({ where: { userId: cristina.id } })
    expect(righe).toHaveLength(1)
    expect(righe[0]).toMatchObject({
      rosterId: v2.id,
      day: 1,
      code: 'M',
      eventId: 'ev-1',
      syncState: 'synced',
      confirmedAt: new Date('2026-09-01T08:00:00Z'),
      syncedAt: new Date('2026-09-01T08:05:00Z'),
    })
  })

  it('non sposta quelle di chi non ha la colonna nella foto nuova: resta sulla vecchia', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v1.id, 'SARA DP.', 1, 'P')
    await cella(v2.id, 'CRISTINA', 1, 'M') // la foto nuova non ha SARA DP.
    await assegnazione(v1.id, cristina.id, 1)
    await assegnazione(v1.id, sara.id, 1, { code: 'P', columnLabel: 'SARA DP.' })

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(1)
    expect(esito.skippedUsers).toEqual([sara.id])
    const diSara = await prisma.assignment.findFirstOrThrow({ where: { userId: sara.id } })
    expect(diSara.rosterId).toBe(v1.id)
  })

  it('l identità di colonna è normalizeColumn: "SARA DP." nella foto vale per l alias "SARADP"', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'SARA DP.', 1, 'P')
    await cella(v2.id, 'SARA DP', 1, 'P')
    await assegnazione(v1.id, sara.id, 1, { code: 'P', columnLabel: 'SARA DP.' })

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(1)
    expect(esito.skippedUsers).toEqual([])
  })

  it('se la versione nuova ha già un assegnazione per quel giorno, vince quella e la vecchia resta', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v2.id, 'CRISTINA', 1, 'M')
    await assegnazione(v1.id, cristina.id, 1)
    await assegnazione(v2.id, cristina.id, 1, { eventId: 'ev-nuovo', syncState: 'confirmed' })

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.movedAssignments).toBe(0)
    const suV2 = await prisma.assignment.findFirstOrThrow({ where: { userId: cristina.id, rosterId: v2.id } })
    expect(suV2.eventId).toBe('ev-nuovo')
    expect(await prisma.assignment.count({ where: { rosterId: v1.id } })).toBe(1)
  })

  it('riporta una correzione a mano solo se il modello ha letto la stessa cosa di prima', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    const quando = new Date('2026-09-02T09:00:00Z')
    // giorno 1: stessa lettura M, corretta in P → si riporta
    await cella(v1.id, 'CRISTINA', 1, 'M', { correctedCode: 'P', correctedAt: quando, correctedBy: 'anna' })
    await cella(v2.id, 'CRISTINA', 1, 'M')
    // giorno 2: la lettura è cambiata (M → RP): il foglio è cambiato, la correzione non vale più
    await cella(v1.id, 'CRISTINA', 2, 'M', { correctedCode: 'P', correctedAt: quando, correctedBy: 'anna' })
    await cella(v2.id, 'CRISTINA', 2, 'RP')
    await assegnazione(v1.id, cristina.id, 1)

    const esito = await versions.carryOverAssignments(v2.id)

    expect(esito.carriedCorrections).toBe(1)
    const g1 = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: v2.id, day: 1 } })
    expect(g1).toMatchObject({ correctedCode: 'P', correctedAt: quando, correctedBy: 'anna' })
    const g2 = await prisma.rosterCell.findFirstOrThrow({ where: { rosterId: v2.id, day: 2 } })
    expect(g2.correctedAt).toBeNull()
  })

  it('è idempotente: senza niente da riportare non tocca nulla', async () => {
    const v1 = await tabella(1)
    const v2 = await tabella(2)
    await cella(v1.id, 'CRISTINA', 1, 'M')
    await cella(v2.id, 'CRISTINA', 1, 'M')

    expect(await versions.carryOverAssignments(v2.id)).toEqual({
      movedAssignments: 0,
      carriedCorrections: 0,
      skippedUsers: [],
    })
    // e sulla prima versione non c è niente prima: nessun errore
    expect(await versions.carryOverAssignments(v1.id)).toEqual({
      movedAssignments: 0,
      carriedCorrections: 0,
      skippedUsers: [],
    })
  })
})
```

- [ ] **Step 2: rosso**

Run: `npx vitest run tests/modules/roster/versions.test.ts`
Expected: i 6 casi nuovi FAIL con `versions.carryOverAssignments is not a function`.

- [ ] **Step 3: implementa** — aggiungi in fondo a `src/modules/roster/versions.ts`:

```ts
import { normalizeColumn } from '@/modules/extract/schema'

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
```

Sposta l'`import { normalizeColumn }` in cima al file insieme all'altro import. Poi in
`src/modules/roster/index.ts`:

```ts
export type { CarryOverResult, RosterVersionRef } from './versions'
export { carryOverAssignments, cellsForDiff, previousVersionOf } from './versions'
```

- [ ] **Step 4: verde**

Run: `npx vitest run tests/modules/roster/versions.test.ts`
Expected: 11 passed.

- [ ] **Step 5: test rosso per il gancio in `finishExtraction`** — aggiungi in
`tests/modules/roster/bands-repository.test.ts`, dentro il `describe('finishExtraction — …')`
esistente (usa gli stessi helper del file per creare la tabella `r` con le bande):

```ts
  it('alla chiusura di una versione nuova riporta le conferme dalla precedente', async () => {
    // La v1: una cella e una conferma. La v2: stessa cella, bande tutte lette.
    const v1 = await prisma.roster.create({
      data: { year: 2026, month: 9, ward: '3°PIANO', version: 1, imagePath: 'v1.jpg', status: 'extracted' },
    })
    const utente = await prisma.user.create({ data: { email: 'cri@example.com', displayName: 'Cristina' } })
    await prisma.columnAlias.create({ data: { label: 'CRISTINA', userId: utente.id, ignored: false } })
    await prisma.rosterCell.create({
      data: { rosterId: v1.id, day: 1, columnLabel: 'CRISTINA', rawCode: 'M', code: 'M', confidence: 0.9 },
    })
    await prisma.assignment.create({
      data: { rosterId: v1.id, userId: utente.id, day: 1, code: 'M', confirmedAt: new Date(), syncState: 'confirmed' },
    })

    const v2 = await prisma.roster.create({
      data: { year: 2026, month: 9, ward: '3°PIANO', version: 2, imagePath: 'v2.jpg', status: 'extracting' },
    })
    await prisma.rosterBand.create({ data: { rosterId: v2.id, index: 0, status: 'done', dayFrom: 1, dayTo: 30 } })
    await prisma.rosterCell.create({
      data: { rosterId: v2.id, day: 1, columnLabel: 'CRISTINA', rawCode: 'M', code: 'M', confidence: 0.9 },
    })

    const stato = await repo.finishExtraction(v2.id, { provider: 'gemini', now: ORA })

    expect(stato).toBe('extracted')
    const conferma = await prisma.assignment.findFirstOrThrow({ where: { userId: utente.id } })
    expect(conferma.rosterId).toBe(v2.id)
  })
```

Se il `beforeEach` di quel file non svuota `assignment`, `columnAlias` e `user`, aggiungi le tre
`deleteMany` in testa al `beforeEach` (l'ordine: `assignment`, `columnAlias`, poi `user`).

- [ ] **Step 6: rosso**

Run: `npx vitest run tests/modules/roster/bands-repository.test.ts`
Expected: il caso nuovo FAIL con `expected '<id v1>' to be '<id v2>'`.

- [ ] **Step 7: il gancio** — in `src/modules/roster/repository.ts`, dentro `finishExtraction`,
subito dopo `await prisma.roster.update({ ... })` e prima di `return status`:

```ts
    // Fase 5: le conferme della versione precedente seguono questa, se la sua lettura
    // è arrivata da qualche parte. Su `failed` non c è una foto nuova da cui
    // ripartire, e le conferme restano dove sono.
    if (status !== 'failed') await carryOverAssignments(rosterId)
```

con in cima al file `import { carryOverAssignments } from './versions'`. Attenzione al ciclo di
import: `versions.ts` importa solo `@/lib/db` e `@/modules/extract/schema`, non `repository.ts`.

- [ ] **Step 8: verde e suite**

Run: `npx vitest run tests/modules/roster/` poi `npm test`
Expected: tutto verde.

- [ ] **Step 9: commit**

```bash
git add src/modules/roster tests/modules/roster
git commit -m "feat(roster): carry confirmations and hand corrections over to a new roster version"
```

---

### Task 4: `removeAssignment` e la sua server action

**Files:**
- Modify: `src/modules/review/confirm.ts` (dopo `unconfirmDays`)
- Modify: `src/modules/review/index.ts`
- Modify: `src/app/rosters/[id]/review/actions.ts`
- Test: `tests/modules/review/repository.test.ts` (nuovo `describe`)
- Test: `tests/app/rosters/actions-auth.test.ts` (due casi; usa l'harness del file)

**Interfaces:**
- Consumes: `requireOwnColumn(viewer, columnLabel, azione)` e `withWriteLock` già in `confirm.ts`.
- Produces:
  ```ts
  export async function removeAssignment(viewer: Viewer, input: ColumnTarget & { day: number }): Promise<{ removed: number }>
  // actions.ts
  export async function removeAssignmentAction(form: FormData): Promise<void>  // campi: rosterId, columnLabel, day
  ```

- [ ] **Step 1: test rosso** — in `tests/modules/review/repository.test.ts` aggiungi un `describe`
(il file ha già `cristina`, `sara`, `anna`, `rosterId`, `aliases`, `confirm` e crea la tabella nel
`beforeEach`; assicurati che esista `await aliases.assignColumnToUser('CRISTINA', cristina.id)` nel
`beforeEach` o fallo all'inizio di ogni caso):

```ts
describe('removeAssignment — il turno tolto dal foglio nuovo si toglie con un gesto', () => {
  async function orfana() {
    // Un assegnazione senza cella: il foglio nuovo non ha più quel turno.
    await aliases.assignColumnToUser('CRISTINA', cristina.id)
    return prisma.assignment.create({
      data: {
        rosterId,
        userId: cristina.id,
        day: 20,
        code: 'M',
        columnLabel: 'CRISTINA',
        confirmedAt: new Date(),
        eventId: 'ev-20',
        syncState: 'synced',
      },
    })
  }

  it('chi possiede la colonna la cancella: il prossimo sync toglierà l evento', async () => {
    await orfana()

    const esito = await confirm.removeAssignment(
      { id: cristina.id, role: 'NURSE' },
      { rosterId, columnLabel: 'CRISTINA', day: 20 },
    )

    expect(esito).toEqual({ removed: 1 })
    expect(await prisma.assignment.count({ where: { userId: cristina.id } })).toBe(0)
  })

  it('un altra infermiera no', async () => {
    await orfana()
    await expect(
      confirm.removeAssignment({ id: sara.id, role: 'NURSE' }, { rosterId, columnLabel: 'CRISTINA', day: 20 }),
    ).rejects.toBeInstanceOf(confirm.ReviewForbiddenError)
    expect(await prisma.assignment.count({ where: { userId: cristina.id } })).toBe(1)
  })

  it('nemmeno la referente: il calendario è della persona', async () => {
    await orfana()
    await expect(
      confirm.removeAssignment({ id: anna.id, role: 'REFERENTE' }, { rosterId, columnLabel: 'CRISTINA', day: 20 }),
    ).rejects.toBeInstanceOf(confirm.ReviewForbiddenError)
  })
})
```

- [ ] **Step 2: rosso**

Run: `npx vitest run tests/modules/review/repository.test.ts`
Expected: 3 FAIL, `confirm.removeAssignment is not a function`.

- [ ] **Step 3: implementa** — in `src/modules/review/confirm.ts`, dopo `unconfirmDays`:

```ts
/**
 * Toglie un assegnazione. Serve per il turno che il foglio **nuovo** non ha più:
 * la riga è vuota ma l assegnazione (e l evento su Google) esistono ancora. Senza
 * assegnazione la chiave non è più protetta e il prossimo sync cancella l evento
 * (`planSync`). È un gesto della persona, non un automatismo: un turno che
 * sparisce dal calendario da solo è il tipo di sorpresa che fa perdere la fiducia.
 */
export async function removeAssignment(
  viewer: Viewer,
  input: ColumnTarget & { day: number },
): Promise<{ removed: number }> {
  const userId = await requireOwnColumn(viewer, input.columnLabel, 'toglierne un turno dal calendario')

  return withWriteLock(async () => {
    const esito = await prisma.assignment.deleteMany({
      where: { userId, rosterId: input.rosterId, day: input.day },
    })
    return { removed: esito.count }
  })
}
```

In `src/modules/review/index.ts` aggiungi `removeAssignment` all'elenco esportato da `./confirm`.

- [ ] **Step 4: verde**

Run: `npx vitest run tests/modules/review/repository.test.ts`
Expected: tutto verde.

- [ ] **Step 5: test rosso per l'azione** — in `tests/app/rosters/actions-auth.test.ts`, seguendo
l'harness del file (sessione con `session.openSessionCookie`, `redirect` mockato che lancia
`REDIRECT:<url>`), aggiungi:

```ts
describe('removeAssignmentAction', () => {
  it('senza sessione manda al login', async () => {
    const form = new FormData()
    form.set('rosterId', rosterId)
    form.set('columnLabel', 'CRISTINA')
    form.set('day', '20')
    await expect(reviewActions.removeAssignmentAction(form)).rejects.toThrow('REDIRECT:/login')
  })

  it('un altra infermiera riceve un errore leggibile e non cancella niente', async () => {
    await prisma.assignment.create({
      data: { rosterId, userId: cristina.id, day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' },
    })
    await session.openSessionCookie(sara.id)
    const form = new FormData()
    form.set('rosterId', rosterId)
    form.set('columnLabel', 'CRISTINA')
    form.set('day', '20')

    await expect(reviewActions.removeAssignmentAction(form)).rejects.toThrow(/REDIRECT:.*error=/)
    expect(await prisma.assignment.count({ where: { userId: cristina.id } })).toBe(1)
  })
})
```

Adatta i nomi (`reviewActions`, `session`, `cristina`, `sara`, `rosterId`) a quelli che il file
usa davvero: leggilo prima. Se il file non crea un alias `CRISTINA` → `cristina`, crealo nel caso.

- [ ] **Step 6: rosso**

Run: `npx vitest run tests/app/rosters/actions-auth.test.ts`
Expected: FAIL, `removeAssignmentAction is not a function`.

- [ ] **Step 7: l'azione** — in `src/app/rosters/[id]/review/actions.ts`, importa `removeAssignment`
dalla facciata `@/modules/review` (aggiungilo all'import esistente) e aggiungi dopo
`unconfirmDayAction`:

```ts
/**
 * «Togli dal calendario»: il foglio nuovo non ha più questo turno, ma l assegnazione
 * e l evento su Google ci sono ancora. Cancella l assegnazione; l evento lo toglie il
 * prossimo sync. Stessa barriera della conferma: solo chi possiede la colonna.
 */
export async function removeAssignmentAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const rosterId = text(form, 'rosterId')
  const columnLabel = text(form, 'columnLabel')
  const day = Number(text(form, 'day'))

  if (rosterId === '' || columnLabel === '' || !Number.isInteger(day)) {
    tornaCon(rosterId, columnLabel, { error: 'Richiesta incompleta' })
  }

  try {
    await removeAssignment(user, { rosterId, columnLabel, day })
    revalidatePath(`/rosters/${rosterId}/review`)
    tornaCon(rosterId, columnLabel, {
      ok: `Giorno ${day} tolto: al prossimo invio l evento sparisce dal calendario.`,
    })
  } catch (errore) {
    if (errore instanceof ReviewForbiddenError) {
      tornaCon(rosterId, columnLabel, { error: errore.message })
    }
    throw errore
  }
}
```

- [ ] **Step 8: verde**

Run: `npx vitest run tests/app/rosters/actions-auth.test.ts tests/modules/review/repository.test.ts`
Expected: verde.

- [ ] **Step 9: commit**

```bash
git add src/modules/review/confirm.ts src/modules/review/index.ts "src/app/rosters/[id]/review/actions.ts" tests/modules/review/repository.test.ts tests/app/rosters/actions-auth.test.ts
git commit -m "feat(review): remove an orphan assignment so the next sync drops its event"
```

---

### Task 5: la griglia sa cosa è cambiato

**Files:**
- Modify: `src/modules/review/grid.ts`
- Test: `tests/modules/review/grid.test.ts`

**Interfaces:**
- Consumes: `VersionChange` (Task 1).
- Produces, su `buildColumnGrid`: nuovo input opzionale `changes?: VersionChange[]` (il diff, anche
  di tutte le colonne: la griglia filtra per `columnKey`). Su `GridRow`:
  ```ts
  changed: ChangeKind | null
  previousCode: string | null        // il codice effettivo della versione precedente, solo se changed !== null
  orphanAssignment: boolean          // riga vuota che porta un assegnazione: il foglio nuovo non ha più il turno
  ```
  Su `GridSummary`: `changed: number` (righe con `changed !== null`).
  `attentionReasons` riceve `cambiato rispetto alla foto precedente: era M` / `nuovo rispetto alla foto precedente` /
  `il foglio nuovo non ha più questo turno`.

- [ ] **Step 1: test rosso** — in `tests/modules/review/grid.test.ts` aggiungi (usa gli helper
`cella` e `griglia` del file; `griglia` accetta `cells` e `assignments`: estendila con un terzo
parametro `changes` passato a `buildColumnGrid`):

```ts
describe('buildColumnGrid — cosa è cambiato rispetto alla foto precedente', () => {
  const cambio = (day: number, kind: 'changed' | 'added' | 'removed', before: string | null, after: string | null) => ({
    columnLabel: 'RENATA',
    columnKey: 'RENATA',
    day,
    kind,
    before,
    after,
  })

  it('senza diff nessuna riga è cambiata e il riassunto conta zero', () => {
    const righe = griglia([cella(1)])
    expect(righe[0].changed).toBeNull()
    expect(righe[0].previousCode).toBeNull()
    expect(gridSummary(righe).changed).toBe(0)
  })

  it('una riga del diff porta il tipo di cambiamento e il codice di prima', () => {
    const righe = griglia([cella(5, { rawCode: 'P', code: 'P' })], [], [cambio(5, 'changed', 'M', 'P')])
    expect(righe[4].changed).toBe('changed')
    expect(righe[4].previousCode).toBe('M')
    expect(righe[4].attention).toBe(true)
    expect(righe[4].attentionReasons).toContain('cambiato rispetto alla foto precedente: era M')
    expect(gridSummary(righe).changed).toBe(1)
  })

  it('un giorno nuovo lo dice', () => {
    const righe = griglia([cella(12)], [], [cambio(12, 'added', null, 'M')])
    expect(righe[11].changed).toBe('added')
    expect(righe[11].attentionReasons).toContain('nuovo rispetto alla foto precedente')
  })

  it('un giorno tolto con un assegnazione ancora viva è orfano: il foglio nuovo non ha più il turno', () => {
    const righe = griglia(
      [],
      [{ day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' }],
      [cambio(20, 'removed', 'M', null)],
    )
    expect(righe[19].empty).toBe(true)
    expect(righe[19].orphanAssignment).toBe(true)
    expect(righe[19].changed).toBe('removed')
    expect(righe[19].attentionReasons).toContain('il foglio nuovo non ha più questo turno')
  })

  it('un assegnazione su una riga vuota è orfana anche senza diff (prima versione, cella svuotata)', () => {
    const righe = griglia([], [{ day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' }])
    expect(righe[19].orphanAssignment).toBe(true)
  })

  it('ignora i cambiamenti di altre colonne', () => {
    const righe = griglia([cella(5)], [], [{ ...cambio(5, 'changed', 'M', 'P'), columnLabel: 'MERY', columnKey: 'MERY' }])
    expect(righe[4].changed).toBeNull()
  })
})
```

Aggiorna anche il test esistente `conta turni, conferme, celle da rileggere e codici sconosciuti`
aggiungendo `changed: 0` all'oggetto atteso del `toEqual`.

- [ ] **Step 2: rosso**

Run: `npx vitest run tests/modules/review/grid.test.ts`
Expected: FAIL sui casi nuovi (`changed` undefined) e sul `toEqual` del riassunto.

- [ ] **Step 3: implementa** — in `src/modules/review/grid.ts`:

1. Importa il tipo: `import type { ChangeKind, VersionChange } from './diff'`.
2. In `GridRow` aggiungi, dopo `synced`/`syncFailed`:
   ```ts
     /** Rispetto alla versione precedente della tabella: `null` se uguale o se è la prima versione. */
     changed: ChangeKind | null
     /** Il codice effettivo della versione precedente, solo quando `changed` non è null. */
     previousCode: string | null
     /** Riga vuota che porta ancora un assegnazione: il foglio nuovo non ha più questo turno. */
     orphanAssignment: boolean
   ```
3. In `buildColumnGrid` aggiungi l'input opzionale `changes?: VersionChange[]` e, dopo
   `const conferme = ...`:
   ```ts
     const cambi = new Map(
       (input.changes ?? [])
         .filter((c) => c.columnKey === chiaveColonna)
         .map((c) => [c.day, c]),
     )
   ```
4. Nel ciclo, dopo `const changedSinceConfirm = ...`:
   ```ts
       const cambio = cambi.get(day) ?? null
       const orphanAssignment = empty && assegnazione !== null
   ```
   e in fondo alla costruzione di `attentionReasons`:
   ```ts
       if (cambio?.kind === 'changed') attentionReasons.push(`cambiato rispetto alla foto precedente: era ${cambio.before}`)
       if (cambio?.kind === 'added') attentionReasons.push('nuovo rispetto alla foto precedente')
       if (orphanAssignment) attentionReasons.push('il foglio nuovo non ha più questo turno')
   ```
   Attenzione: `cambiato dopo la conferma: era M` (già presente) e `cambiato rispetto alla foto
   precedente: era M` possono comparire insieme sulla stessa riga, e va bene: dicono due cose diverse
   (la conferma è vecchia; il foglio è cambiato).
5. Nel `righe.push({...})` aggiungi:
   ```ts
       changed: cambio?.kind ?? null,
       previousCode: cambio ? cambio.before : null,
       orphanAssignment,
   ```
6. In `GridSummary` aggiungi `changed: number` e in `gridSummary`:
   `changed: rows.filter((r) => r.changed !== null).length,`.

- [ ] **Step 4: verde e suite**

Run: `npx vitest run tests/modules/review/grid.test.ts` poi `npm test`
Expected: verde. Se `tests/app/rosters/column-summary.test.ts` costruisce un `GridSummary` a mano,
aggiungi `changed: 0` al suo oggetto.

- [ ] **Step 5: commit**

```bash
git add src/modules/review/grid.ts tests/modules/review/grid.test.ts tests/app/rosters/column-summary.test.ts
git commit -m "feat(review): grid rows know what changed since the previous version, and which are orphans"
```

---

### Task 6: la griglia mostra i cambiamenti all'infermiera

**Files:**
- Create: `src/app/rosters/[id]/review/changes-box.tsx`
- Modify: `src/app/rosters/[id]/review/page.tsx`
- Modify: `src/app/rosters/[id]/review/day-row.tsx`
- Test: `tests/app/rosters/changes-box.test.ts`
- Test: `tests/app/rosters/review-page.test.ts`

**Interfaces:**
- Consumes: `diffVersions`, `VersionChange` da `@/modules/review`; `previousVersionOf`,
  `cellsForDiff` da `@/modules/roster`; `removeAssignmentAction` (Task 4); `GridRow.changed`,
  `previousCode`, `orphanAssignment`, `synced` (Task 5).
- Produces: `ChangesBox({ changes }: { changes: VersionChange[] })` — server component puro, `null`
  con elenco vuoto; `describeChange(change: VersionChange): string` esportata (es. `5 (M → P)`,
  `12 nuovo`, `20 tolto`).

- [ ] **Step 1: test rosso per il riquadro**

```ts
// tests/app/rosters/changes-box.test.ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChangesBox, describeChange } from '@/app/rosters/[id]/review/changes-box'
import type { VersionChange } from '@/modules/review/diff'

const cambio = (day: number, kind: VersionChange['kind'], before: string | null, after: string | null): VersionChange => ({
  columnLabel: 'CRISTINA',
  columnKey: 'CRISTINA',
  day,
  kind,
  before,
  after,
})

describe('describeChange', () => {
  it('descrive i tre tipi in una parola o due', () => {
    expect(describeChange(cambio(5, 'changed', 'M', 'P'))).toBe('5 (M → P)')
    expect(describeChange(cambio(12, 'added', null, 'M'))).toBe('12 nuovo (M)')
    expect(describeChange(cambio(20, 'removed', 'M', null))).toBe('20 tolto (era M)')
  })
})

describe('ChangesBox', () => {
  it('con diff vuoto non disegna niente: un avviso sempre presente insegna a ignorarlo', () => {
    expect(renderToStaticMarkup(createElement(ChangesBox, { changes: [] }))).toBe('')
  })

  it('dice quanti giorni sono cambiati e quali', () => {
    const html = renderToStaticMarkup(
      createElement(ChangesBox, {
        changes: [cambio(5, 'changed', 'M', 'P'), cambio(12, 'added', null, 'M'), cambio(20, 'removed', 'M', null)],
      }),
    )
    expect(html).toContain('3 giorni')
    expect(html).toContain('5 (M → P)')
    expect(html).toContain('12 nuovo (M)')
    expect(html).toContain('20 tolto (era M)')
  })

  it('al singolare dice «1 giorno»', () => {
    const html = renderToStaticMarkup(createElement(ChangesBox, { changes: [cambio(5, 'changed', 'M', 'P')] }))
    expect(html).toContain('1 giorno')
    expect(html).not.toContain('1 giorni')
  })
})
```

- [ ] **Step 2: rosso**

Run: `npx vitest run tests/app/rosters/changes-box.test.ts`
Expected: FAIL, modulo mancante.

- [ ] **Step 3: il riquadro**

```tsx
// src/app/rosters/[id]/review/changes-box.tsx
import { Banner } from '@/components/banner'
import type { VersionChange } from '@/modules/review'

/** `5 (M → P)`, `12 nuovo (M)`, `20 tolto (era M)`. */
export function describeChange(change: VersionChange): string {
  if (change.kind === 'changed') return `${change.day} (${change.before} → ${change.after})`
  if (change.kind === 'added') return `${change.day} nuovo (${change.after})`
  return `${change.day} tolto (era ${change.before})`
}

/**
 * Il riquadro «rispetto alla foto precedente». Solo i giorni cambiati della colonna
 * (decisione del proprietario), e **solo se ce ne sono**: un avviso che compare su
 * ogni tabella insegna a ignorarlo. Le righe corrispondenti portano il badge.
 */
export function ChangesBox({ changes }: { changes: VersionChange[] }) {
  if (changes.length === 0) return null
  const n = changes.length
  return (
    <Banner variant="warn" title={`Rispetto alla foto precedente ${n === 1 ? 'è cambiato 1 giorno' : `sono cambiati ${n} giorni`}`}>
      <p className="tabular">{changes.map(describeChange).join(' · ')}</p>
      <p className="mt-1 text-xs">
        Un turno cambiato che avevi già confermato resta sul calendario com’era finché non lo
        riconfermi. Un turno tolto resta finché non premi «Togli dal calendario».
      </p>
    </Banner>
  )
}
```

- [ ] **Step 4: verde**

Run: `npx vitest run tests/app/rosters/changes-box.test.ts`
Expected: 4 passed.

- [ ] **Step 5: test rosso sulla pagina** — in `tests/app/rosters/review-page.test.ts` aggiungi un
`describe` (il file ha `renderReview`, `trovaElemento`, `infermiera`, `rosterId` che è una tabella
`version 1` di agosto 2026, e importa i componenti dinamicamente dopo `vi.resetModules()`; aggiungi
`let ChangesBox: typeof import('@/app/rosters/[id]/review/changes-box').ChangesBox` e il suo import
nel `beforeAll`):

```ts
describe('la griglia dice cosa è cambiato rispetto alla foto precedente', () => {
  let v2: string

  beforeEach(async () => {
    await prisma.columnAlias.create({ data: { label: 'CRISTINA', userId: infermiera.id, ignored: false } })
    // v1 (rosterId, già creata dal beforeEach del file): giorno 5 = M
    await prisma.rosterCell.create({
      data: { rosterId, day: 5, columnLabel: 'CRISTINA', rawCode: 'M', code: 'M', confidence: 0.9 },
    })
    // v2: giorno 5 = P
    const nuova = await prisma.roster.create({
      data: { year: 2026, month: 8, ward: '3°PIANO', version: 2, imagePath: 'v2.jpg', status: 'extracted' },
    })
    v2 = nuova.id
    await prisma.rosterCell.create({
      data: { rosterId: v2, day: 5, columnLabel: 'CRISTINA', rawCode: 'P', code: 'P', confidence: 0.9 },
    })
  })

  async function renderReviewDi(id: string, userId: string): Promise<ReactNode> {
    await session.openSessionCookie(userId)
    return ReviewPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ colonna: 'CRISTINA' }) })
  }

  it('sulla versione 2 il riquadro dei cambiamenti riceve il diff della colonna', async () => {
    const pagina = await renderReviewDi(v2, infermiera.id)
    const box = trovaElemento<{ changes: unknown[]; children?: ReactNode }>(pagina, ChangesBox)
    expect(box).toBeDefined()
    expect(box?.props.changes).toEqual([
      expect.objectContaining({ day: 5, kind: 'changed', before: 'M', after: 'P' }),
    ])
  })

  it('sulla prima versione il riquadro riceve un diff vuoto', async () => {
    const pagina = await renderReviewDi(rosterId, infermiera.id)
    const box = trovaElemento<{ changes: unknown[]; children?: ReactNode }>(pagina, ChangesBox)
    expect(box).toBeDefined()
    expect(box?.props.changes).toEqual([])
  })
})
```

- [ ] **Step 6: rosso**

Run: `npx vitest run tests/app/rosters/review-page.test.ts`
Expected: FAIL, `box` undefined.

- [ ] **Step 7: la pagina** — in `src/app/rosters/[id]/review/page.tsx`:

1. Import: `import { ChangesBox } from './changes-box'`; dalla facciata `@/modules/review` aggiungi
   `diffVersions`; dalla facciata `@/modules/roster` aggiungi `cellsForDiff, previousVersionOf`
   (se la pagina non importa ancora da `@/modules/roster`, aggiungi l'import).
2. Dopo il calcolo di `righe`... no: **prima**, perché `buildColumnGrid` riceve `changes`. Dopo
   `const [assegnazioni, celle] = await Promise.all([...])` aggiungi:
   ```ts
     // Fase 5: il diff con la versione precedente, calcolato al volo. Sulla prima
     // versione è vuoto e il riquadro non si disegna.
     const precedente = await previousVersionOf(id)
     const cambiamenti = precedente
       ? diffVersions(await cellsForDiff(precedente.id), celle)
       : []
     const cambiamentiDellaColonna = cambiamenti.filter(
       (c) => c.columnKey === normalizeColumn(scelta),
     )
   ```
   `normalizeColumn` viene da `@/modules/extract` (facciata). Passa `changes: cambiamenti` a
   `buildColumnGrid`.
3. Nel JSX, subito dopo `<ColumnSummary … />`, aggiungi `<ChangesBox changes={cambiamentiDellaColonna} />`.

- [ ] **Step 8: verde**

Run: `npx vitest run tests/app/rosters/review-page.test.ts`
Expected: verde.

- [ ] **Step 9: la riga** — in `src/app/rosters/[id]/review/day-row.tsx` (nessun test automatico
possibile per il markup client: verifica a occhio nel browser al passo 11):

1. Import `removeAssignmentAction` insieme alle altre azioni.
2. Nel `<p className="flex flex-wrap items-center gap-2">` dei badge, dopo `corretta a mano`:
   ```tsx
                   {row.changed === 'changed' && <Badge variant="secondary">cambiato</Badge>}
                   {row.changed === 'added' && <Badge variant="secondary">nuovo</Badge>}
   ```
3. Nel ramo `row.empty`, sostituisci il `<p>` con:
   ```tsx
               <div className="flex flex-col gap-1">
                 <p className="text-muted-foreground text-sm">
                   {row.orphanAssignment
                     ? 'il foglio nuovo non ha più questo turno'
                     : row.declaredEmpty
                       ? 'vuota — svuotata a mano'
                       : 'nessun turno letto'}
                 </p>
                 {row.orphanAssignment && row.synced && (
                   <p className="text-warn-soft-foreground text-xs font-medium">
                     sul calendario c’è ancora {row.confirmedCode ?? 'il turno di prima'}
                   </p>
                 )}
                 {row.orphanAssignment && canConfirm && (
                   <form action={removeAssignmentAction}>
                     <input type="hidden" name="rosterId" value={rosterId} />
                     <input type="hidden" name="columnLabel" value={columnLabel} />
                     <input type="hidden" name="day" value={row.day} />
                     <Button type="submit" size="touch" variant="outline" className="min-w-24">
                       Togli dal calendario
                     </Button>
                   </form>
                 )}
               </div>
   ```
4. Sotto la riga `già sul tuo calendario` (dove c'è `row.confirmed && row.synced`), aggiungi il caso
   «cambiato ma sul calendario c'è ancora il vecchio»:
   ```tsx
         {row.changedSinceConfirm && row.synced && (
           <p className="text-warn-soft-foreground mt-2 text-xs font-medium">
             sul calendario c’è ancora {row.confirmedCode}: riconferma per aggiornarlo
           </p>
         )}
   ```
   Nota: `row.synced` con `changedSinceConfirm` è vero solo se l'assegnazione è `synced` e il codice
   letto è cambiato: esattamente il caso «foglio cambiato dopo l'invio».

- [ ] **Step 10: suite e lint**

Run: `npm test && npm run lint`
Expected: verde, pulito.

- [ ] **Step 11: controllo a occhio** (dev server acceso: `env -u APP_URL npm run dev -- -p 3001`):
carica una seconda foto di settembre da `/rosters/upload` (stessa `fixtures/roster-2026-09-3piano.jpeg`
va bene: diff vuoto, riquadro assente, conferme riportate), oppure, per vedere il riquadro, cambia a
mano una cella della v1 da `/rosters/<v1>/review` **prima** di caricare la v2. Verifica: riquadro,
badge «cambiato», frase «sul calendario c'è ancora», bottone «Togli dal calendario» su una riga orfana.

- [ ] **Step 12: commit**

```bash
git add "src/app/rosters/[id]/review" tests/app/rosters/changes-box.test.ts tests/app/rosters/review-page.test.ts
git commit -m "feat(review): show the nurse what changed since the previous photo, and let her drop removed shifts"
```

---

### Task 7: la pagina del diff per la referente

**Files:**
- Create: `src/app/rosters/[id]/diff/page.tsx`
- Modify: `src/app/rosters/[id]/review/page.tsx` (voce di menu)
- Test: `tests/app/rosters/diff-page.test.ts`
- Test: `tests/app/rosters/review-page.test.ts` (voce di menu)

**Interfaces:**
- Consumes: `requireReferente` (`@/modules/auth`), `previousVersionOf`, `cellsForDiff`,
  `getRosterMonth` (`@/modules/roster`), `diffVersions` (`@/modules/review`), `AppHeader`,
  `Banner`, `EmptyState`.
- Produces: la route `/rosters/[id]/diff`; nella griglia, voce `{ href: '/rosters/<id>/diff', label: 'Cosa è cambiato' }`
  solo per `REFERENTE` e solo con `roster.version > 1`.

- [ ] **Step 1: test rosso**

```ts
// tests/app/rosters/diff-page.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { ReactElement, ReactNode } from 'react'
import { createTestDb } from '../../helpers/db'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let DiffPage: typeof import('@/app/rosters/[id]/diff/page').default
let EmptyState: typeof import('@/components/empty-state').EmptyState

let referente: { id: string }
let infermiera: { id: string }

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  session = await import('@/modules/auth/session')
  DiffPage = (await import('@/app/rosters/[id]/diff/page')).default
  EmptyState = (await import('@/components/empty-state')).EmptyState
})

afterAll(() => db.cleanup())

beforeEach(async () => {
  cookieStore.clear()
  await prisma.assignment.deleteMany()
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.user.deleteMany()
  referente = await prisma.user.create({ data: { email: 'anna@esempio.it', displayName: 'Anna', role: 'REFERENTE' } })
  infermiera = await prisma.user.create({ data: { email: 'cri@esempio.it', displayName: 'Cristina', role: 'NURSE' } })
})

function trovaElemento<P extends { children?: ReactNode }>(node: ReactNode, tipo: unknown): ReactElement<P> | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const figlio of node) {
      const trovato = trovaElemento<P>(figlio, tipo)
      if (trovato) return trovato
    }
    return undefined
  }
  const elemento = node as ReactElement<P>
  if (elemento.type === tipo) return elemento
  return trovaElemento<P>(elemento.props?.children, tipo)
}

/** Tutto il testo letterale dell albero, per cercare frasi senza rendere i componenti. */
function testo(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(testo).join(' ')
  const el = node as ReactElement<{ children?: ReactNode }>
  return testo(el.props?.children)
}

async function versione(version: number, celle: Array<{ day: number; column: string; code: string }>) {
  const roster = await prisma.roster.create({
    data: { year: 2026, month: 9, ward: '3°PIANO', version, imagePath: `v${version}.jpg`, status: 'extracted' },
  })
  await prisma.rosterCell.createMany({
    data: celle.map((c) => ({ rosterId: roster.id, day: c.day, columnLabel: c.column, rawCode: c.code, code: c.code, confidence: 0.9 })),
  })
  return roster
}

async function render(id: string, userId: string) {
  await session.openSessionCookie(userId)
  return DiffPage({ params: Promise.resolve({ id }) })
}

describe('/rosters/[id]/diff — solo la referente', () => {
  it('a un infermiera rimanda alla home: il controllo è lato server', async () => {
    const v1 = await versione(1, [])
    await expect(render(v1.id, infermiera.id)).rejects.toThrow('REDIRECT:/')
  })

  it('senza sessione rimanda al login', async () => {
    const v1 = await versione(1, [])
    await expect(render(v1.id, '')).rejects.toThrow(/REDIRECT:\/login/)
  })
})

describe('/rosters/[id]/diff — cosa mostra', () => {
  it('sulla prima versione dice che non c è una foto precedente', async () => {
    const v1 = await versione(1, [{ day: 1, column: 'CRISTINA', code: 'M' }])
    const pagina = await render(v1.id, referente.id)
    expect(trovaElemento(pagina, EmptyState)).toBeDefined()
    expect(testo(pagina)).toMatch(/prima foto|foto precedente/i)
  })

  it('con diff vuoto dice che non ci sono differenze', async () => {
    await versione(1, [{ day: 1, column: 'CRISTINA', code: 'M' }])
    const v2 = await versione(2, [{ day: 1, column: 'CRISTINA', code: 'M' }])
    const pagina = await render(v2.id, referente.id)
    expect(testo(pagina)).toMatch(/nessuna differenza/i)
  })

  it('elenca i cambiamenti per colonna e giorno, e dice se la persona ha già riconfermato', async () => {
    await versione(1, [
      { day: 5, column: 'CRISTINA', code: 'M' },
      { day: 7, column: 'MERY', code: 'P' },
    ])
    const v2 = await versione(2, [
      { day: 5, column: 'CRISTINA', code: 'P' },
      { day: 7, column: 'MERY', code: 'P' },
      { day: 9, column: 'MERY', code: 'M' },
    ])
    // Cristina ha già riconfermato il P del giorno 5
    await prisma.assignment.create({
      data: { rosterId: v2.id, userId: infermiera.id, day: 5, code: 'P', columnLabel: 'CRISTINA', confirmedAt: new Date(), syncState: 'confirmed' },
    })
    await prisma.columnAlias.deleteMany()
    await prisma.columnAlias.create({ data: { label: 'CRISTINA', userId: infermiera.id, ignored: false } })

    const t = testo(await render(v2.id, referente.id))
    expect(t).toContain('CRISTINA')
    expect(t).toContain('5 (M → P)')
    expect(t).toContain('MERY')
    expect(t).toContain('9 nuovo (M)')
    expect(t).toMatch(/riconfermato/i)
  })
})
```

- [ ] **Step 2: rosso**

Run: `npx vitest run tests/app/rosters/diff-page.test.ts`
Expected: FAIL, modulo `@/app/rosters/[id]/diff/page` mancante.

- [ ] **Step 3: la pagina**

```tsx
// src/app/rosters/[id]/diff/page.tsx
import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/empty-state'
import { prisma } from '@/lib/db'
import { monthLabel } from '@/lib/time'
import { requireReferente } from '@/modules/auth'
import { compactCode } from '@/modules/codes'
import { cellsForDiff, previousVersionOf } from '@/modules/roster'
import { diffVersions, listColumnAliases, type VersionChange } from '@/modules/review'
import { describeChange } from '../review/changes-box'

export const dynamic = 'force-dynamic'

/**
 * Il diff completo fra questa versione e la precedente: tutte le colonne, per
 * giorno, con «prima → dopo» e se la persona ha già riconfermato il valore
 * nuovo. Solo la referente (decisione del proprietario): `requireReferente`
 * rimanda alla home chiunque altro, lato server. Le versioni vecchie non si
 * consultano: conta solo l ultima, e questa pagina dice cosa è cambiato per
 * arrivarci.
 */
export default async function DiffPage({ params }: { params: Promise<{ id: string }> }) {
  await requireReferente()
  const { id } = await params

  const roster = await prisma.roster.findUnique({
    where: { id },
    select: { id: true, year: true, month: true, ward: true, version: true },
  })
  if (!roster) notFound()

  const header = (
    <AppHeader
      title="Cosa è cambiato"
      subtitle={`${monthLabel(roster.year, roster.month)} · ${roster.ward} · versione ${roster.version}`}
      backHref={`/rosters/${roster.id}/review`}
    />
  )

  const precedente = await previousVersionOf(roster.id)
  if (!precedente) {
    return (
      <>
        {header}
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-6">
          <EmptyState title="Questa è la prima foto del mese">
            Non c’è una foto precedente con cui confrontarla. Quando ne caricherai un’altra dello
            stesso mese, qui vedrai le differenze.
          </EmptyState>
        </main>
      </>
    )
  }

  const [celleNuove, cellePrecedenti, aliases, assegnazioni] = await Promise.all([
    cellsForDiff(roster.id),
    cellsForDiff(precedente.id),
    listColumnAliases(),
    prisma.assignment.findMany({
      where: { rosterId: roster.id, confirmedAt: { not: null } },
      select: { userId: true, day: true, code: true },
    }),
  ])
  const cambiamenti = diffVersions(cellePrecedenti, celleNuove)

  // «Ha già riconfermato»: la persona della colonna ha un assegnazione confermata
  // per quel giorno con il codice nuovo.
  const utentePerColonna = new Map(aliases.filter((a) => !a.ignored && a.userId).map((a) => [a.label, a.userId as string]))
  const confermaPer = (c: VersionChange): boolean => {
    const userId = utentePerColonna.get(c.columnKey)
    if (!userId || c.after === null) return false
    return assegnazioni.some((a) => a.userId === userId && a.day === c.day && compactCode(a.code) === compactCode(c.after ?? ''))
  }

  const perColonna = new Map<string, VersionChange[]>()
  for (const c of cambiamenti) {
    const lista = perColonna.get(c.columnLabel) ?? []
    lista.push(c)
    perColonna.set(c.columnLabel, lista)
  }

  return (
    <>
      {header}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-6">
        <p className="text-muted-foreground text-sm">
          Confronto con la versione {precedente.version}. Le colonne di servizio e i totali non
          compaiono.
        </p>
        {cambiamenti.length === 0 ? (
          <EmptyState title="Nessuna differenza rispetto alla foto precedente">
            Le due letture coincidono cella per cella. Le conferme già date sono passate a questa
            versione.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...perColonna.entries()].map(([colonna, lista]) => (
              <li key={colonna} className="bg-card border-border rounded-2xl border px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold">{colonna}</span>
                  <Badge variant="secondary">
                    {lista.length} {lista.length === 1 ? 'giorno' : 'giorni'}
                  </Badge>
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {lista.map((c) => (
                    <li key={`${c.columnKey}:${c.day}`} className="flex items-center justify-between gap-2 text-sm tabular">
                      <span>{describeChange(c)}</span>
                      {confermaPer(c) ? (
                        <Badge variant="default">riconfermato</Badge>
                      ) : (
                        <Badge variant="outline">da riconfermare</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
```

Se `compactCode` non è esportato dalla facciata `@/modules/codes`, aggiungilo all'`index.ts` di
quel modulo. `listColumnAliases()` restituisce righe con `label` (già normalizzata: è la chiave),
`userId`, `ignored`: verifica il tipo `ColumnAliasRow` in `src/modules/review/aliases.ts`.

- [ ] **Step 4: verde**

Run: `npx vitest run tests/app/rosters/diff-page.test.ts`
Expected: 5 passed.

- [ ] **Step 5: test rosso per la voce di menu** — in `tests/app/rosters/review-page.test.ts`
aggiungi al `describe('la griglia di conferma ridà alla referente la strada per le colonne', …)`:

```ts
  it('alla referente mostra «Cosa è cambiato» solo da una seconda versione in su', async () => {
    const prime = await menuVoci(referente.id)
    expect(prime.some((v) => v.label === 'Cosa è cambiato')).toBe(false)

    const v2 = await prisma.roster.create({
      data: { year: 2026, month: 8, ward: '3°PIANO', version: 2, imagePath: 'v2.jpg', status: 'extracted' },
    })
    await session.openSessionCookie(referente.id)
    const pagina = await ReviewPage({ params: Promise.resolve({ id: v2.id }), searchParams: Promise.resolve({}) })
    const header = trovaElemento<{ menuItems?: { href: string; label: string }[]; children?: ReactNode }>(pagina, AppHeader)
    expect(header?.props.menuItems).toContainEqual({ href: `/rosters/${v2.id}/diff`, label: 'Cosa è cambiato' })
  })

  it('a un infermiera non la mostra mai', async () => {
    const v2 = await prisma.roster.create({
      data: { year: 2026, month: 8, ward: '3°PIANO', version: 2, imagePath: 'v2.jpg', status: 'extracted' },
    })
    await session.openSessionCookie(infermiera.id)
    const pagina = await ReviewPage({ params: Promise.resolve({ id: v2.id }), searchParams: Promise.resolve({}) })
    const header = trovaElemento<{ menuItems?: { href: string; label: string }[]; children?: ReactNode }>(pagina, AppHeader)
    expect(header).toBeDefined()
    expect((header?.props.menuItems ?? []).some((v) => v.label === 'Cosa è cambiato')).toBe(false)
  })
```

- [ ] **Step 6: rosso**

Run: `npx vitest run tests/app/rosters/review-page.test.ts`
Expected: il primo caso nuovo FAIL (`toContainEqual`).

- [ ] **Step 7: la voce** — in `src/app/rosters/[id]/review/page.tsx` sostituisci il calcolo di
`menuItems` con:

```ts
  const menuItems =
    user.role === 'REFERENTE'
      ? [
          ...menuItemsFor(user),
          { href: `/rosters/${roster.id}/columns`, label: 'Colonne e persone' },
          // Solo da una seconda versione: sulla prima non c è niente con cui confrontare.
          ...(roster.version > 1 ? [{ href: `/rosters/${roster.id}/diff`, label: 'Cosa è cambiato' }] : []),
        ]
      : menuItemsFor(user)
```

- [ ] **Step 8: verde, suite, lint, typegen**

Run: `npx next typegen && npm test && npm run lint`
Expected: verde, pulito (`typegen` registra la route nuova nei tipi, altrimenti `tsc` non la conosce).

- [ ] **Step 9: commit**

```bash
git add "src/app/rosters/[id]/diff" "src/app/rosters/[id]/review/page.tsx" tests/app/rosters/diff-page.test.ts tests/app/rosters/review-page.test.ts src/modules/codes/index.ts
git commit -m "feat(review): a referente-only page listing what changed between two versions"
```

---

### Task 8: documentazione e chiusura

**Files:**
- Modify: `CLAUDE.md` (banner: Fase 5 fatta; trappole: due voci)
- Modify: `docs/superpowers/specs/2026-09-06-fase-5-versioni-design.md` (riga di stato)

- [ ] **Step 1: il banner** — in `CLAUDE.md` sostituisci la frase «**Non** sono implementati il diff
fra versioni della stessa tabella (Fase 5) né la rifinitura UI (Fase 6).» con:

```
> La **Fase 5** è implementata: una seconda foto dello stesso mese **sposta** le conferme sulla versione
> nuova alla chiusura della lettura (`carryOverAssignments`, per persona e solo se la sua colonna c'è),
> riporta le correzioni a mano a grezzo uguale, e la griglia mostra solo i giorni cambiati
> (`diffVersions`, puro). La referente ha `/rosters/[id]/diff`. Resta la rifinitura UI (Fase 6).
```

- [ ] **Step 2: due trappole** — in `CLAUDE.md`, sezione «Trappole note», aggiungi prima della voce
«**Solo la persona associata a una colonna può confermarla**»:

```
- **Le conferme vivono sulla versione, e una versione nuova le sposta, non le copia.** `Assignment.rosterId`
  cambia alla chiusura della lettura della versione N+1 (`finishExtraction` → `carryOverAssignments`).
  Una riga sola per persona e giorno, sempre sull'ultima versione: due copie con lo stesso `eventId`
  farebbero litigare due sync. Se la foto nuova **non ha la colonna** di una persona, le sue conferme
  restano sulla N e lei continua a vedere la N — non è un bug, è la sola versione in cui esiste.
- **Un turno tolto dal foglio nuovo non sparisce dal calendario da solo.** La riga resta con
  l'assegnazione «orfana» e il bottone «Togli dal calendario» (`removeAssignment`); solo dopo quel gesto
  il sync cancella l'evento, perché una giornata senza assegnazione non protegge la chiave. Un turno
  cambiato dopo l'invio resta sul calendario com'era finché non viene riconfermato: regola invariante 1.
```

- [ ] **Step 3: la spec** — cambia la riga «Stato: design approvato in chat dal proprietario, da
trasformare in piano.» in «Stato: implementata (piano `docs/superpowers/plans/2026-09-06-fase-5-versioni.md`).»

- [ ] **Step 4: suite intera, lint, commit**

Run: `npm test && npm run lint`

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-06-fase-5-versioni-design.md
git commit -m "docs: phase 5 is in — versions carry confirmations, the grid shows what changed"
```

---

## Self-review (fatta scrivendo il piano)

- **Copertura della spec:** §4 riporto → Task 3; §5 diff → Task 1 (+ Task 2 per le letture); §6
  infermiera → Task 5 e 6 (riquadro, badge, frasi, «Togli dal calendario» via Task 4); §7 referente →
  Task 7; §8 confini → ogni task allarga la facciata del suo modulo; §9 «cosa non si fa» → nessun task
  tocca `calendar`; §10 test → ogni task ne porta; l'ultimo punto di §10 (test sul sync che documenta
  la cancellazione a giornata senza assegnazione) è già coperto da `planSync` in `sync.test.ts`
  («quello che non si tocca»): verificarlo leggendo, non duplicarlo.
- **Coerenza dei nomi:** `diffVersions`, `effectiveCode`, `VersionChange{columnLabel, columnKey, day, kind, before, after}`,
  `previousVersionOf`, `cellsForDiff`, `carryOverAssignments`, `removeAssignment`,
  `removeAssignmentAction`, `GridRow.changed/previousCode/orphanAssignment`, `GridSummary.changed`,
  `ChangesBox`, `describeChange` — usati con lo stesso nome in ogni task.
- **Placeholder:** nessuno; dove un dettaglio dipende da un file esistente (nomi dell'harness in
  `actions-auth.test.ts`, `ColumnAliasRow`), il passo dice di leggerlo prima.
