# Fase 2A — Pipeline di estrazione: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dalla foto di una tabella turni a un'estrazione validata e salvata sul database, con un comando che misura l'accuratezza cella per cella sulle due foto reali.

**Architecture:** Tre moduli nuovi sotto `src/modules/`: `ingest` normalizza la foto, `extract` la manda a un provider vision dietro un'interfaccia sostituibile e valida l'output con Zod, `roster` lo persiste risolvendo i codici con la legenda già esistente. Nessuna interfaccia web in questa fase: il valore consegnato è `npm run eval`, che dice quanto è accurata l'estrazione prima che qualcuno costruisca schermate sopra.

**Tech Stack:** TypeScript, `sharp`, Zod, Groq API (OpenAI-compatibile, via `fetch`), `@anthropic-ai/sdk` come provider alternativo, Prisma/SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-toni-turni-design.md`

## Global Constraints

- **Node 22**, npm. **La shell di default ha Node 18.17.0: `nvm use 22` prima di npm e dei test.** Target: ZimaBoard x86_64, 8 GB → nessuna dipendenza pesante senza motivo.
- **TDD obbligatorio:** nessun codice di produzione senza un test rosso che lo giustifichi; nessun "fatto" senza aver eseguito la suite e letto l'output.
- **Identificatori e messaggi di commit in inglese; testi UI, commenti di codice e descrizioni dei test in italiano.** I codici turno restano come sulla carta.
- **L'output del modello non è mai fidato:** passa sempre da Zod prima di toccare il database, e il testo grezzo va conservato in `Roster.rawOutput` per debug.
- **La confidenza per cella si propaga fino alla persistenza.** Non scartarla nei livelli intermedi: è ciò che dirà all'infermiera quali celle rileggere.
- **Un codice sconosciuto non è un errore:** viene salvato come `rawCode` con `code = null`, e lo risolverà l'utente nella Fase 3.
- **Nessuna chiamata di rete nei test.** I provider si testano con `fetch`/SDK mockati; l'unico comando che parla col provider reale è `npm run eval`, che non gira in CI.
- **Nessun segreto nel repository.** `GROQ_API_KEY` e `ANTHROPIC_API_KEY` solo da env.
- **Le foto sono dati personali** (nella realtà, non nelle fixture): restano sul volume locale, e l'invio al provider avviene solo su azione esplicita.
- **Un commit per task**, test e implementazione insieme.

## Decisioni già prese

| Tema | Decisione |
|---|---|
| Provider primario | **Groq**, modello da `GROQ_MODEL` con default `qwen/qwen3.8-27b` (131K contesto, 20 MB per immagine, base64 supportato) |
| Provider alternativo | **Anthropic** (`claude-opus-5`), selezionabile con `AI_PROVIDER=anthropic` |
| Strategia di estrazione | **Una chiamata per tabella intera.** Groq conta 2048 token per immagine: se l'accuratezza misurata sarà bassa, la mossa successiva è una chiamata per colonna (8 chiamate), ma non si costruisce prima di aver misurato |
| Formato di scambio | JSON, richiesto con la modalità JSON del provider dove esiste, e comunque validato con Zod |
| Verità di riferimento | I due `*.expected.json` in `fixtures/`, trascritti a mano dal controller e **da confermare dal proprietario**: sono la verità contro cui si misura, non un output del sistema |

## File Structure

| File | Responsabilità |
|---|---|
| `prisma/schema.prisma` | Aggiunge `Roster` e `RosterCell` |
| `src/modules/ingest/normalize.ts` | Foto → JPEG raddrizzato e ridimensionato (sharp) |
| `src/modules/ingest/storage.ts` | Scrittura/lettura/cancellazione dell'immagine sul volume |
| `src/modules/ingest/index.ts` | Facciata del modulo |
| `src/modules/extract/schema.ts` | Schema Zod dell'estrazione + parsing del testo del modello |
| `src/modules/extract/prompt.ts` | Costruzione del prompt di estrazione e di quello di riparazione |
| `src/modules/extract/providers/types.ts` | Interfaccia `VisionProvider` |
| `src/modules/extract/providers/groq.ts` | Provider Groq |
| `src/modules/extract/providers/anthropic.ts` | Provider Anthropic |
| `src/modules/extract/providers/index.ts` | Selezione del provider da env |
| `src/modules/extract/extract.ts` | Orchestrazione: chiamata, validazione, riparazione, fallback |
| `src/modules/extract/index.ts` | Facciata del modulo |
| `src/modules/roster/repository.ts` | Persistenza di `Roster` e celle, con risoluzione dei codici |
| `src/modules/roster/index.ts` | Facciata del modulo |
| `fixtures/*.expected.json` | Trascrizione di riferimento delle due foto |
| `scripts/eval-extraction.ts` | Misura l'accuratezza per cella contro le fixture (provider reale) |

---

### Task 1: Modello dati della tabella

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_roster/migration.sql` (generata)
- Test: `tests/modules/roster/schema.test.ts`

**Interfaces:**
- Consumes: `createTestDb()` da `tests/helpers/db`
- Produces: modelli `Roster` (id, year, month, ward, version, imagePath, status, provider, rawOutput, createdAt) e `RosterCell` (id, rosterId, day, columnLabel, rawCode, code, confidence, handCorrected), con `@@unique([year, month, ward, version])` su `Roster` e `@@unique([rosterId, day, columnLabel])` su `RosterCell`

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `tests/modules/roster/schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient

beforeAll(() => {
  db = createTestDb()
  prisma = db.prisma
})

afterAll(async () => {
  await db.cleanup()
})

function roster(overrides: Record<string, unknown> = {}) {
  return {
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    imagePath: 'uploads/x.jpg',
    status: 'uploaded',
    ...overrides,
  }
}

describe('Roster', () => {
  it('nasce alla versione 1 con stato uploaded', async () => {
    const created = await prisma.roster.create({ data: roster() })
    expect(created.version).toBe(1)
    expect(created.status).toBe('uploaded')
    expect(created.rawOutput).toBeNull()
  })

  it('permette due versioni dello stesso mese e reparto', async () => {
    await prisma.roster.create({ data: roster({ month: 9 }) })
    const seconda = await prisma.roster.create({ data: roster({ month: 9, version: 2 }) })
    expect(seconda.version).toBe(2)
  })

  it('rifiuta due volte la stessa versione dello stesso mese e reparto', async () => {
    await prisma.roster.create({ data: roster({ month: 10 }) })
    await expect(prisma.roster.create({ data: roster({ month: 10 }) })).rejects.toThrow()
  })
})

describe('RosterCell', () => {
  it('conserva codice grezzo, codice risolto, confidenza e correzione a penna', async () => {
    const r = await prisma.roster.create({ data: roster({ month: 11 }) })
    const cell = await prisma.rosterCell.create({
      data: {
        rosterId: r.id,
        day: 3,
        columnLabel: 'MERY',
        rawCode: 'M 1°P',
        code: 'M1°P',
        confidence: 0.42,
        handCorrected: true,
      },
    })
    expect(cell.rawCode).toBe('M 1°P')
    expect(cell.code).toBe('M1°P')
    expect(cell.confidence).toBeCloseTo(0.42)
    expect(cell.handCorrected).toBe(true)
  })

  it('accetta un codice non risolto', async () => {
    const r = await prisma.roster.create({ data: roster({ month: 12 }) })
    const cell = await prisma.rosterCell.create({
      data: { rosterId: r.id, day: 1, columnLabel: 'ALEX', rawCode: '???', confidence: 0.1, handCorrected: false },
    })
    expect(cell.code).toBeNull()
  })

  it('rifiuta due celle per lo stesso giorno e la stessa colonna', async () => {
    const r = await prisma.roster.create({ data: roster({ year: 2027 }) })
    const data = { rosterId: r.id, day: 5, columnLabel: 'RENATA', rawCode: 'M', confidence: 1, handCorrected: false }
    await prisma.rosterCell.create({ data })
    await expect(prisma.rosterCell.create({ data })).rejects.toThrow()
  })

  it('cancella le celle insieme alla tabella', async () => {
    const r = await prisma.roster.create({ data: roster({ year: 2028 }) })
    await prisma.rosterCell.create({
      data: { rosterId: r.id, day: 1, columnLabel: 'F', rawCode: 'M', confidence: 1, handCorrected: false },
    })

    await prisma.roster.delete({ where: { id: r.id } })

    expect(await prisma.rosterCell.count({ where: { rosterId: r.id } })).toBe(0)
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/modules/roster/schema.test.ts`
Expected: FAIL — `prisma.roster` non esiste sul client.

- [ ] **Step 3: Estendere lo schema**

Aggiungi a `prisma/schema.prisma`:

```prisma
model Roster {
  id        String   @id @default(cuid())
  year      Int
  month     Int
  ward      String
  version   Int      @default(1)
  imagePath String
  // uploaded | extracting | extracted | failed
  status    String   @default("uploaded")
  // nome del provider che ha prodotto l estrazione, per capire i confronti a posteriori
  provider  String?
  // testo grezzo del modello: serve a capire un estrazione andata male
  rawOutput String?
  createdAt DateTime @default(now())
  cells     RosterCell[]

  @@unique([year, month, ward, version])
}

model RosterCell {
  id            String  @id @default(cuid())
  rosterId      String
  roster        Roster  @relation(fields: [rosterId], references: [id], onDelete: Cascade)
  day           Int
  columnLabel   String
  // testo letto dalla foto, senza normalizzazione
  rawCode       String
  // codice risolto in ShiftCode, null quando la legenda non lo conosce
  code          String?
  confidence    Float
  // il modello ha visto una correzione a penna o col correttore
  handCorrected Boolean @default(false)

  @@unique([rosterId, day, columnLabel])
}
```

- [ ] **Step 4: Generare la migrazione**

```bash
DATABASE_URL="file:./data/turni.db" npx prisma migrate dev --name roster
```

- [ ] **Step 5: Eseguire i test**

Run: `npx vitest run tests/modules/roster/schema.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add roster and roster cell models"
```

---

### Task 2: Normalizzazione della foto

**Files:**
- Create: `src/modules/ingest/normalize.ts`
- Test: `tests/modules/ingest/normalize.test.ts`

**Interfaces:**
- Consumes: `sharp`
- Produces: da `@/modules/ingest/normalize`: `interface NormalizedImage { data: Buffer; width: number; height: number; bytes: number }` e `normalizeRosterPhoto(input: Buffer, options?: { maxEdge?: number; quality?: number }): Promise<NormalizedImage>`

- [ ] **Step 1: Installare sharp**

```bash
npm install sharp
```

- [ ] **Step 2: Scrivere i test che falliscono**

Crea `tests/modules/ingest/normalize.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { normalizeRosterPhoto } from '@/modules/ingest/normalize'

const FIXTURE = join(process.cwd(), 'fixtures', 'roster-2026-08-3piano.jpeg')

describe('normalizeRosterPhoto', () => {
  it('restituisce un JPEG', async () => {
    const result = await normalizeRosterPhoto(readFileSync(FIXTURE))
    // magic bytes di un JPEG
    expect(result.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(await sharp(result.data).metadata()).toMatchObject({ format: 'jpeg' })
  })

  it('non supera il lato massimo richiesto', async () => {
    const result = await normalizeRosterPhoto(readFileSync(FIXTURE), { maxEdge: 800 })
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(800)
  })

  it('riporta dimensioni e peso coerenti con l immagine prodotta', async () => {
    const result = await normalizeRosterPhoto(readFileSync(FIXTURE), { maxEdge: 600 })
    const meta = await sharp(result.data).metadata()
    expect(result.width).toBe(meta.width)
    expect(result.height).toBe(meta.height)
    expect(result.bytes).toBe(result.data.byteLength)
  })

  it('non ingrandisce un immagine più piccola del lato massimo', async () => {
    const small = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer()

    const result = await normalizeRosterPhoto(small, { maxEdge: 2000 })

    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
  })

  it('applica l orientamento EXIF invece di ignorarlo', async () => {
    // orientation 6 = ruotata di 90°: la normalizzazione deve scambiare i lati
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#ffffff' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    const result = await normalizeRosterPhoto(rotated, { maxEdge: 2000 })

    expect(result.width).toBe(100)
    expect(result.height).toBe(200)
  })

  it('riduce il peso di una foto da smartphone', async () => {
    const original = readFileSync(FIXTURE)
    const result = await normalizeRosterPhoto(original, { maxEdge: 1200, quality: 80 })
    expect(result.bytes).toBeLessThan(original.byteLength)
  })

  it('rifiuta un buffer che non è un immagine', async () => {
    await expect(normalizeRosterPhoto(Buffer.from('non sono una foto'))).rejects.toThrow(
      /immagine/i,
    )
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/ingest/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/ingest/normalize"`.

- [ ] **Step 4: Implementare**

Crea `src/modules/ingest/normalize.ts`:

```ts
import sharp from 'sharp'

export interface NormalizedImage {
  data: Buffer
  width: number
  height: number
  bytes: number
}

const DEFAULT_MAX_EDGE = 2000
const DEFAULT_QUALITY = 85

/**
 * Prepara la foto per il modello vision: applica l orientamento EXIF (le foto da
 * telefono arrivano ruotate e il modello leggerebbe la tabella di traverso), riduce
 * il lato lungo e ricomprime in JPEG.
 */
export async function normalizeRosterPhoto(
  input: Buffer,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<NormalizedImage> {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE
  const quality = options.quality ?? DEFAULT_QUALITY

  try {
    const { data, info } = await sharp(input)
      .rotate() // senza argomenti applica l orientamento EXIF
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })

    return { data, width: info.width, height: info.height, bytes: data.byteLength }
  } catch (cause) {
    throw new Error("Il file caricato non è un immagine leggibile", { cause })
  }
}
```

- [ ] **Step 5: Eseguire i test**

Run: `npx vitest run tests/modules/ingest/normalize.test.ts`
Expected: PASS, 7 test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: normalise roster photos before extraction"
```

---

### Task 3: Archiviazione dell'immagine

**Files:**
- Create: `src/modules/ingest/storage.ts`, `src/modules/ingest/index.ts`
- Test: `tests/modules/ingest/storage.test.ts`

**Interfaces:**
- Consumes: `optionalEnv` da `@/lib/env`
- Produces: da `@/modules/ingest`: `normalizeRosterPhoto`, `NormalizedImage`, `uploadDir(): string`, `rosterImagePath(rosterId: string): string`, `saveRosterImage(rosterId: string, data: Buffer): Promise<string>`, `readRosterImage(rosterId: string): Promise<Buffer>`, `deleteRosterImage(rosterId: string): Promise<void>`, `pruneOldImages(retentionDays: number, now: Date): Promise<string[]>`

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/ingest/storage.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir: string
let storage: typeof import('@/modules/ingest/storage')

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'turni-uploads-'))
  process.env.UPLOAD_DIR = dir
  vi.resetModules()
  storage = await import('@/modules/ingest/storage')
})

afterEach(() => {
  delete process.env.UPLOAD_DIR
})

describe('saveRosterImage / readRosterImage', () => {
  it('scrive il file e lo rilegge identico', async () => {
    const data = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02])

    const path = await storage.saveRosterImage('abc123', data)

    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path)).toEqual(data)
    expect(await storage.readRosterImage('abc123')).toEqual(data)
  })

  it('crea la cartella se non esiste ancora', async () => {
    process.env.UPLOAD_DIR = join(dir, 'annidata', 'ancora')
    vi.resetModules()
    const fresh = await import('@/modules/ingest/storage')

    const path = await fresh.saveRosterImage('xyz', Buffer.from([1]))

    expect(existsSync(path)).toBe(true)
  })

  it('usa un nome derivato dall id, dentro la cartella configurata', () => {
    expect(storage.rosterImagePath('abc123')).toBe(join(dir, 'abc123.jpg'))
  })

  it('rifiuta un id che tenta di uscire dalla cartella', async () => {
    await expect(storage.saveRosterImage('../fuori', Buffer.from([1]))).rejects.toThrow(
      /identificativo/i,
    )
    expect(() => storage.rosterImagePath('a/b')).toThrow(/identificativo/i)
  })

  it('solleva un errore leggibile se l immagine non esiste', async () => {
    await expect(storage.readRosterImage('mancante')).rejects.toThrow(/non trovata/i)
  })
})

describe('deleteRosterImage', () => {
  it('cancella il file', async () => {
    const path = await storage.saveRosterImage('da-cancellare', Buffer.from([1]))
    await storage.deleteRosterImage('da-cancellare')
    expect(existsSync(path)).toBe(false)
  })

  it('non protesta se il file non c è già più', async () => {
    await expect(storage.deleteRosterImage('mai-esistito')).resolves.toBeUndefined()
  })
})

describe('pruneOldImages', () => {
  it('cancella solo le immagini più vecchie della retention', async () => {
    const vecchia = await storage.saveRosterImage('vecchia', Buffer.from([1]))
    const recente = await storage.saveRosterImage('recente', Buffer.from([1]))

    const cento = new Date('2026-01-01T00:00:00Z')
    const centoGiorniPrima = new Date(cento.getTime() - 100 * 86_400_000)
    utimesSync(vecchia, centoGiorniPrima, centoGiorniPrima)
    utimesSync(recente, cento, cento)

    const cancellate = await storage.pruneOldImages(90, cento)

    expect(cancellate).toEqual(['vecchia.jpg'])
    expect(existsSync(vecchia)).toBe(false)
    expect(existsSync(recente)).toBe(true)
  })

  it('non fa nulla se la cartella non esiste', async () => {
    process.env.UPLOAD_DIR = join(dir, 'inesistente')
    vi.resetModules()
    const fresh = await import('@/modules/ingest/storage')

    await expect(fresh.pruneOldImages(90, new Date())).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/ingest/storage.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

Crea `src/modules/ingest/storage.ts`:

```ts
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { optionalEnv } from '@/lib/env'

// Gli id sono cuid: lettere e cifre. Tutto il resto è rifiutato, così un id
// malevolo non può far scrivere fuori dalla cartella delle foto.
const SAFE_ID = /^[A-Za-z0-9_-]+$/

export function uploadDir(): string {
  return optionalEnv('UPLOAD_DIR', './data/uploads')
}

function assertSafeId(rosterId: string): void {
  if (!SAFE_ID.test(rosterId)) {
    throw new Error(`Identificativo della tabella non valido: ${rosterId}`)
  }
}

export function rosterImagePath(rosterId: string): string {
  assertSafeId(rosterId)
  return join(uploadDir(), `${rosterId}.jpg`)
}

export async function saveRosterImage(rosterId: string, data: Buffer): Promise<string> {
  const path = rosterImagePath(rosterId)
  await mkdir(uploadDir(), { recursive: true })
  await writeFile(path, data)
  return path
}

export async function readRosterImage(rosterId: string): Promise<Buffer> {
  const path = rosterImagePath(rosterId)
  try {
    return await readFile(path)
  } catch (cause) {
    throw new Error(`Immagine della tabella non trovata: ${rosterId}`, { cause })
  }
}

export async function deleteRosterImage(rosterId: string): Promise<void> {
  try {
    await unlink(rosterImagePath(rosterId))
  } catch (error) {
    // Già cancellata: per il chiamante il risultato è lo stesso.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Cancella le immagini più vecchie della retention e restituisce i nomi rimossi. */
export async function pruneOldImages(retentionDays: number, now: Date): Promise<string[]> {
  const dir = uploadDir()
  const soglia = now.getTime() - retentionDays * 86_400_000

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const rimosse: string[] = []
  for (const entry of entries) {
    const info = await stat(join(dir, entry))
    if (info.mtimeMs < soglia) {
      await unlink(join(dir, entry))
      rimosse.push(entry)
    }
  }
  return rimosse
}
```

Crea `src/modules/ingest/index.ts`:

```ts
export type { NormalizedImage } from './normalize'
export { normalizeRosterPhoto } from './normalize'
export {
  deleteRosterImage,
  pruneOldImages,
  readRosterImage,
  rosterImagePath,
  saveRosterImage,
  uploadDir,
} from './storage'
```

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/modules/ingest`
Expected: PASS, 16 test (7 di normalizzazione, 9 di archiviazione).

- [ ] **Step 5: Aggiungere `UPLOAD_DIR` a `.env.example`**

```dotenv
# Cartella delle foto caricate (nel container: /data/uploads)
UPLOAD_DIR=./data/uploads
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: store roster images on the volume with retention pruning"
```

---

### Task 4: Schema dell'estrazione e parsing dell'output

**Files:**
- Create: `src/modules/extract/schema.ts`
- Test: `tests/modules/extract/schema.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces: da `@/modules/extract/schema`: `extractionSchema` (Zod), `type Extraction`, `type ExtractedCell`, `parseExtraction(raw: string): { ok: true; value: Extraction } | { ok: false; error: string }`

- [ ] **Step 1: Installare Zod**

```bash
npm install zod
```

**Nota su `cause`:** in questo task e nei successivi si usa `new Error(messaggio, { cause })`, che
richiede `lib` almeno `ES2022` in `tsconfig.json`. Se `tsc --noEmit` protesta, aggiungi `ES2022` alla
lista `lib` invece di rinunciare a `cause`: l'errore originale è ciò che rende diagnosticabile un
guasto del provider.

- [ ] **Step 2: Scrivere i test che falliscono**

Crea `tests/modules/extract/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseExtraction } from '@/modules/extract/schema'

const valida = {
  year: 2026,
  month: 8,
  ward: '3°PIANO',
  columns: ['RENATA', 'KHADIJA'],
  cells: [
    { day: 1, column: 'RENATA', code: 'M', confidence: 0.98, handCorrected: false },
    { day: 1, column: 'KHADIJA', code: 'F', confidence: 0.4, handCorrected: true },
  ],
}

describe('parseExtraction', () => {
  it('accetta un output valido', () => {
    const result = parseExtraction(JSON.stringify(valida))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.month).toBe(8)
      expect(result.value.cells).toHaveLength(2)
    }
  })

  it('estrae il JSON anche se il modello lo circonda di testo e di recinti markdown', () => {
    const raw = 'Ecco la tabella:\n```json\n' + JSON.stringify(valida) + '\n```\nSpero sia utile!'
    const result = parseExtraction(raw)
    expect(result.ok).toBe(true)
  })

  it('rifiuta un testo senza JSON', () => {
    const result = parseExtraction('non ho capito la richiesta')
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/JSON/i) })
  })

  it('rifiuta un JSON sintatticamente rotto', () => {
    const result = parseExtraction('{"year": 2026, "month":}')
    expect(result.ok).toBe(false)
  })

  it('rifiuta un mese fuori intervallo', () => {
    const result = parseExtraction(JSON.stringify({ ...valida, month: 13 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/month/)
  })

  it('rifiuta un giorno fuori intervallo', () => {
    const cells = [{ day: 32, column: 'RENATA', code: 'M', confidence: 1, handCorrected: false }]
    expect(parseExtraction(JSON.stringify({ ...valida, cells })).ok).toBe(false)
  })

  it('rifiuta una confidenza fuori da 0..1', () => {
    const cells = [{ day: 1, column: 'RENATA', code: 'M', confidence: 42, handCorrected: false }]
    expect(parseExtraction(JSON.stringify({ ...valida, cells })).ok).toBe(false)
  })

  it('rifiuta una cella la cui colonna non è fra quelle dichiarate', () => {
    const cells = [{ day: 1, column: 'SCONOSCIUTA', code: 'M', confidence: 1, handCorrected: false }]
    const result = parseExtraction(JSON.stringify({ ...valida, cells }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/SCONOSCIUTA/)
  })

  it('accetta una cella vuota come stringa vuota', () => {
    const cells = [{ day: 1, column: 'RENATA', code: '', confidence: 0.9, handCorrected: false }]
    expect(parseExtraction(JSON.stringify({ ...valida, cells })).ok).toBe(true)
  })

  it('rifiuta due celle per lo stesso giorno e la stessa colonna', () => {
    const cells = [
      { day: 1, column: 'RENATA', code: 'M', confidence: 1, handCorrected: false },
      { day: 1, column: 'RENATA', code: 'P', confidence: 1, handCorrected: false },
    ]
    const result = parseExtraction(JSON.stringify({ ...valida, cells }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/duplicat/i)
  })

  it('rifiuta un elenco di colonne vuoto', () => {
    expect(parseExtraction(JSON.stringify({ ...valida, columns: [], cells: [] })).ok).toBe(false)
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/extract/schema.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 4: Implementare**

Crea `src/modules/extract/schema.ts`:

```ts
import { z } from 'zod'

export const extractedCellSchema = z.object({
  day: z.number().int().min(1).max(31),
  column: z.string().min(1).max(60),
  /** Testo della cella come letto dalla foto; vuoto se la cella è vuota. */
  code: z.string().max(20),
  confidence: z.number().min(0).max(1),
  /** Il modello ha visto una correzione a penna o col correttore. */
  handCorrected: z.boolean(),
})

export const extractionSchema = z
  .object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    ward: z.string().min(1).max(60),
    columns: z.array(z.string().min(1).max(60)).min(1).max(40),
    cells: z.array(extractedCellSchema),
  })
  .superRefine((value, ctx) => {
    const dichiarate = new Set(value.columns)
    const viste = new Set<string>()

    for (const cell of value.cells) {
      if (!dichiarate.has(cell.column)) {
        // 'custom' come stringa funziona sia in Zod 3 sia in Zod 4, dove
        // z.ZodIssueCode non esiste più.
        ctx.addIssue({
          code: 'custom',
          message: `La cella cita una colonna non dichiarata: ${cell.column}`,
        })
      }

      const chiave = `${cell.day}:${cell.column}`
      if (viste.has(chiave)) {
        ctx.addIssue({
          code: 'custom',
          message: `Cella duplicata per giorno e colonna: ${chiave}`,
        })
      }
      viste.add(chiave)
    }
  })

export type Extraction = z.infer<typeof extractionSchema>
export type ExtractedCell = z.infer<typeof extractedCellSchema>

/** Isola il primo oggetto JSON bilanciato presente nel testo. */
function sliceJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i]

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }

  return null
}

/**
 * I modelli aggiungono spesso una frase di cortesia o dei recinti markdown attorno
 * al JSON: si isola l oggetto invece di pretendere una risposta pulita.
 */
export function parseExtraction(
  raw: string,
): { ok: true; value: Extraction } | { ok: false; error: string } {
  const candidate = sliceJsonObject(raw)
  if (candidate === null) {
    return { ok: false, error: 'Nessun oggetto JSON trovato nella risposta del modello' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (error) {
    return { ok: false, error: `JSON non valido: ${(error as Error).message}` }
  }

  const result = extractionSchema.safeParse(parsed)
  if (!result.success) {
    const messaggi = result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'radice'}: ${issue.message}`,
    )
    return { ok: false, error: messaggi.join('; ') }
  }

  return { ok: true, value: result.data }
}
```

- [ ] **Step 5: Eseguire i test**

Run: `npx vitest run tests/modules/extract/schema.test.ts`
Expected: PASS, 11 test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: validate model extraction output with a Zod schema"
```

---

### Task 5: Prompt di estrazione e di riparazione

**Files:**
- Create: `src/modules/extract/prompt.ts`
- Test: `tests/modules/extract/prompt.test.ts`

**Interfaces:**
- Consumes: niente
- Produces: da `@/modules/extract/prompt`: `buildExtractionPrompt(knownCodes: string[]): string`, `buildRepairPrompt(previousOutput: string, validationError: string): string`

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/extract/prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildExtractionPrompt, buildRepairPrompt } from '@/modules/extract/prompt'

describe('buildExtractionPrompt', () => {
  const prompt = buildExtractionPrompt(['M', 'P', 'NOTTE', 'M1°P'])

  it('elenca i codici noti, così il modello non li inventa', () => {
    for (const code of ['M', 'P', 'NOTTE', 'M1°P']) {
      expect(prompt).toContain(code)
    }
  })

  it('descrive tutti i campi che lo schema pretende', () => {
    for (const field of ['year', 'month', 'ward', 'columns', 'cells', 'day', 'column', 'code', 'confidence', 'handCorrected']) {
      expect(prompt).toContain(field)
    }
  })

  it('chiede esplicitamente di segnalare le correzioni a penna', () => {
    expect(prompt).toMatch(/penna|corretto|correttore/i)
  })

  it('chiede di non inventare celle illeggibili', () => {
    expect(prompt).toMatch(/confidenza bassa|non inventare|illeggibil/i)
  })

  it('dice di ignorare le colonne di aiuto e i totali', () => {
    expect(prompt).toMatch(/AIUTO/)
    expect(prompt).toMatch(/TOT/)
  })

  it('non contiene istruzioni contraddittorie sul formato', () => {
    expect(prompt).toMatch(/solo JSON|soltanto JSON|esclusivamente JSON/i)
  })

  it('funziona anche senza codici noti', () => {
    expect(() => buildExtractionPrompt([])).not.toThrow()
    expect(buildExtractionPrompt([])).toContain('cells')
  })
})

describe('buildRepairPrompt', () => {
  it('include l output precedente e l errore da correggere', () => {
    const prompt = buildRepairPrompt('{"year": 2026}', 'cells: campo obbligatorio')
    expect(prompt).toContain('{"year": 2026}')
    expect(prompt).toContain('cells: campo obbligatorio')
  })

  it('tronca un output precedente enorme invece di rimandarlo tutto', () => {
    const enorme = 'x'.repeat(20_000)
    const prompt = buildRepairPrompt(enorme, 'errore')
    expect(prompt.length).toBeLessThan(10_000)
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/extract/prompt.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

Crea `src/modules/extract/prompt.ts`:

```ts
const MAX_PREVIOUS_OUTPUT = 4000

/**
 * Prompt in italiano: la tabella, i nomi e i codici sono italiani, e chiedere al
 * modello di ragionare nella stessa lingua dell immagine riduce le ambiguità.
 */
export function buildExtractionPrompt(knownCodes: string[]): string {
  const elencoCodici =
    knownCodes.length > 0
      ? knownCodes.map((code) => `"${code}"`).join(', ')
      : '(nessun codice noto: riporta esattamente quello che leggi)'

  return `Leggi la fotografia di una tabella turni infermieristica e restituisci **esclusivamente JSON**, senza testo prima o dopo.

La tabella è organizzata così:
- in alto ci sono il reparto (per esempio "3°PIANO"), il mese e l anno;
- ogni **riga** è un giorno del mese, indicato dal numero e dal giorno della settimana abbreviato (lun, mar, mer, gio, ven, sab, dom);
- ogni **colonna** è una persona, con il nome in maiuscolo nell intestazione;
- ogni **cella** contiene il codice del turno che quella persona fa in quel giorno.

Codici turno che il reparto usa: ${elencoCodici}. Se leggi qualcosa che non è in questo elenco, riportalo comunque come lo vedi: non sostituirlo con il codice più somigliante.

Regole importanti:
1. **Ignora** le colonne di aiuto ("AIUTO MATT.", "AIUTO POM.") e le colonne dei totali ("TOT M", "TOT P"): non sono turni di una persona della tabella.
2. Se una cella è **vuota**, restituisci "code": "".
3. Se una cella è stata **corretta a penna**, coperta con il correttore e riscritta, o comunque modificata a mano, metti "handCorrected": true. È l informazione più preziosa che puoi darmi: quelle celle verranno rilette da una persona.
4. La "confidence" è quanto sei sicuro di quella cella, da 0 a 1. Usa **valori bassi quando non sei sicuro**: è molto meglio una confidenza bassa che un codice inventato. Non inventare mai il contenuto di una cella illeggibile.
5. Restituisci una cella per **ogni** incrocio giorno/persona che riesci a leggere, anche quando il codice si ripete.

Formato JSON richiesto:
{
  "year": 2026,
  "month": 8,
  "ward": "3°PIANO",
  "columns": ["RENATA", "KHADIJA"],
  "cells": [
    { "day": 1, "column": "RENATA", "code": "M", "confidence": 0.97, "handCorrected": false },
    { "day": 1, "column": "KHADIJA", "code": "F", "confidence": 0.55, "handCorrected": true }
  ]
}

Ogni valore di "column" dentro "cells" deve comparire in "columns".`
}

export function buildRepairPrompt(previousOutput: string, validationError: string): string {
  const troncato =
    previousOutput.length > MAX_PREVIOUS_OUTPUT
      ? `${previousOutput.slice(0, MAX_PREVIOUS_OUTPUT)}\n[...troncato...]`
      : previousOutput

  return `La risposta precedente non rispetta il formato richiesto.

Errore di validazione: ${validationError}

Risposta precedente:
${troncato}

Correggila e restituisci **esclusivamente** il JSON valido, senza testo prima o dopo e senza recinti markdown.`
}
```

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/modules/extract/prompt.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: build the extraction and repair prompts"
```

---

### Task 6: Provider Groq

**Files:**
- Create: `src/modules/extract/providers/types.ts`, `src/modules/extract/providers/groq.ts`
- Test: `tests/modules/extract/providers/groq.test.ts`

**Interfaces:**
- Consumes: `requireEnv`, `optionalEnv` da `@/lib/env`
- Produces: da `@/modules/extract/providers/types`: `interface VisionRequest { image: Buffer; prompt: string; previousTurns?: Array<{ role: 'assistant' | 'user'; text: string }> }`, `interface VisionResult { raw: string; model: string; provider: string }`, `interface VisionProvider { readonly name: string; extract(request: VisionRequest): Promise<VisionResult> }`, `class VisionProviderError extends Error`
- Produces: da `@/modules/extract/providers/groq`: `createGroqProvider(fetchImpl?: typeof fetch): VisionProvider`, `GROQ_DEFAULT_MODEL`

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/extract/providers/groq.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGroqProvider, GROQ_DEFAULT_MODEL } from '@/modules/extract/providers/groq'
import { VisionProviderError } from '@/modules/extract/providers/types'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0x42])

function risposta(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  process.env.GROQ_API_KEY = 'gsk-di-test'
})

afterEach(() => {
  delete process.env.GROQ_API_KEY
  delete process.env.GROQ_MODEL
})

describe('createGroqProvider', () => {
  it('restituisce il testo del modello', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{"year":2026}'))

    const result = await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'leggi' })

    expect(result.raw).toBe('{"year":2026}')
    expect(result.provider).toBe('groq')
    expect(result.model).toBe(GROQ_DEFAULT_MODEL)
  })

  it('manda l immagine come data URL base64 insieme al prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'leggi la tabella' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('api.groq.com')
    const body = JSON.parse(String((init as RequestInit).body))
    const content = body.messages[0].content
    expect(content[0]).toEqual({ type: 'text', text: 'leggi la tabella' })
    expect(content[1].image_url.url).toBe(`data:image/jpeg;base64,${IMAGE.toString('base64')}`)
  })

  it('chiede al provider la modalità JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))
    await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('manda la chiave nell header di autorizzazione e non nel corpo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))
    await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk-di-test')
    expect(String(init.body)).not.toContain('gsk-di-test')
  })

  it('rispetta GROQ_MODEL quando è impostato', async () => {
    process.env.GROQ_MODEL = 'qwen/qwen3.6-27b'
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    const result = await createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' })

    expect(result.model).toBe('qwen/qwen3.6-27b')
  })

  it('riporta i turni precedenti quando si chiede una riparazione', async () => {
    const fetchMock = vi.fn().mockResolvedValue(risposta('{}'))

    await createGroqProvider(fetchMock).extract({
      image: IMAGE,
      prompt: 'ripara',
      previousTurns: [
        { role: 'assistant', text: 'output sbagliato' },
        { role: 'user', text: 'errore di validazione' },
      ],
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.messages).toHaveLength(3)
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'output sbagliato' })
    expect(body.messages[2]).toEqual({ role: 'user', content: 'errore di validazione' })
  })

  it('solleva un VisionProviderError se la chiave manca', async () => {
    delete process.env.GROQ_API_KEY
    const fetchMock = vi.fn()

    await expect(
      createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('solleva un VisionProviderError su risposta HTTP di errore, riportando lo stato', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota esaurita', { status: 429 }))

    await expect(
      createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(/429/)
  })

  it('solleva un VisionProviderError se la risposta non contiene contenuto', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    )

    await expect(
      createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })

  it('non mette la chiave nel messaggio di errore', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('errore con gsk-di-test', { status: 500 }))

    await expect(
      createGroqProvider(fetchMock).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(expect.not.stringContaining?.('gsk-di-test') ?? /500/)
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/extract/providers/groq.test.ts`
Expected: FAIL — moduli inesistenti.

- [ ] **Step 3: Implementare l'interfaccia**

Crea `src/modules/extract/providers/types.ts`:

```ts
export interface VisionRequest {
  image: Buffer
  prompt: string
  /** Turni precedenti, usati per chiedere la riparazione di un output non valido. */
  previousTurns?: Array<{ role: 'assistant' | 'user'; text: string }>
}

export interface VisionResult {
  raw: string
  model: string
  provider: string
}

export interface VisionProvider {
  readonly name: string
  extract(request: VisionRequest): Promise<VisionResult>
}

export class VisionProviderError extends Error {}
```

- [ ] **Step 4: Implementare il provider Groq**

Crea `src/modules/extract/providers/groq.ts`:

```ts
import { optionalEnv, requireEnv } from '@/lib/env'
import { VisionProviderError, type VisionProvider, type VisionRequest } from './types'

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.8-27b'

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export function createGroqProvider(fetchImpl: typeof fetch = fetch): VisionProvider {
  return {
    name: 'groq',

    async extract(request: VisionRequest) {
      let apiKey: string
      try {
        apiKey = requireEnv('GROQ_API_KEY')
      } catch (cause) {
        throw new VisionProviderError('GROQ_API_KEY non configurata', { cause })
      }

      const model = optionalEnv('GROQ_MODEL', GROQ_DEFAULT_MODEL)

      const messages: unknown[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${request.image.toString('base64')}` },
            },
          ],
        },
        ...(request.previousTurns ?? []).map((turn) => ({ role: turn.role, content: turn.text })),
      ]

      const response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          // La modalità JSON riduce i casi in cui il modello aggiunge testo attorno.
          response_format: { type: 'json_object' },
          temperature: 0,
        }),
      })

      if (!response.ok) {
        // Il corpo dell errore non viene incluso: può contenere l eco della richiesta.
        throw new VisionProviderError(`Groq ha risposto con stato ${response.status}`)
      }

      const payload = (await response.json()) as GroqResponse
      const raw = payload.choices?.[0]?.message?.content
      if (typeof raw !== 'string' || raw.trim() === '') {
        throw new VisionProviderError('Groq ha restituito una risposta senza contenuto')
      }

      return { raw, model, provider: 'groq' }
    },
  }
}
```

- [ ] **Step 5: Eseguire i test**

Run: `npx vitest run tests/modules/extract/providers/groq.test.ts`
Expected: PASS, 10 test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add the Groq vision provider"
```

---

### Task 7: Provider Anthropic

**Files:**
- Create: `src/modules/extract/providers/anthropic.ts`, `src/modules/extract/providers/index.ts`
- Test: `tests/modules/extract/providers/anthropic.test.ts`, `tests/modules/extract/providers/selection.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk`, `optionalEnv`/`requireEnv` da `@/lib/env`
- Produces: `createAnthropicProvider(client?: MessageCreator): VisionProvider` e `ANTHROPIC_DEFAULT_MODEL` da `@/modules/extract/providers/anthropic`; `providerFromEnv(): VisionProvider` e `fallbackProviderFromEnv(): VisionProvider | null` da `@/modules/extract/providers`

**Nota sul modello:** usa `claude-opus-5` come default (`ANTHROPIC_MODEL` per sovrascriverlo). Non aggiungere suffissi di data al nome del modello, e non impostare `temperature` né `budget_tokens`: su questo modello vengono rifiutati.

- [ ] **Step 1: Installare l'SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Scrivere i test che falliscono**

Crea `tests/modules/extract/providers/anthropic.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from '@/modules/extract/providers/anthropic'
import { VisionProviderError } from '@/modules/extract/providers/types'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0x42])

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-di-test'
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_MODEL
})

describe('createAnthropicProvider', () => {
  it('restituisce il testo dei blocchi di tipo text', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"year":2026}' },
      ],
    })

    const result = await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'leggi' })

    expect(result.raw).toBe('{"year":2026}')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe(ANTHROPIC_DEFAULT_MODEL)
  })

  it('manda l immagine come blocco base64 prima del testo', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'leggi la tabella' })

    const params = create.mock.calls[0][0]
    const content = params.messages[0].content
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: IMAGE.toString('base64') },
    })
    expect(content[1]).toEqual({ type: 'text', text: 'leggi la tabella' })
  })

  it('non usa parametri rifiutati da questo modello', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' })

    const params = create.mock.calls[0][0]
    expect(params.temperature).toBeUndefined()
    expect(params.thinking?.budget_tokens).toBeUndefined()
    expect(params.max_tokens).toBeGreaterThanOrEqual(16000)
  })

  it('riporta i turni precedenti per la riparazione', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    await createAnthropicProvider(create).extract({
      image: IMAGE,
      prompt: 'ripara',
      previousTurns: [
        { role: 'assistant', text: 'sbagliato' },
        { role: 'user', text: 'ecco l errore' },
      ],
    })

    const params = create.mock.calls[0][0]
    expect(params.messages).toHaveLength(3)
    expect(params.messages[1]).toEqual({ role: 'assistant', content: 'sbagliato' })
  })

  it('rispetta ANTHROPIC_MODEL', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5'
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{}' }] })

    const result = await createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' })

    expect(result.model).toBe('claude-sonnet-5')
  })

  it('solleva un VisionProviderError se la risposta non ha blocchi di testo', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'thinking', thinking: '' }] })

    await expect(
      createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })

  it('traduce un errore dell SDK in VisionProviderError', async () => {
    const create = vi.fn().mockRejectedValue(new Error('rate limited'))

    await expect(
      createAnthropicProvider(create).extract({ image: IMAGE, prompt: 'x' }),
    ).rejects.toThrow(VisionProviderError)
  })
})
```

Crea `tests/modules/extract/providers/selection.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { fallbackProviderFromEnv, providerFromEnv } from '@/modules/extract/providers'

afterEach(() => {
  delete process.env.AI_PROVIDER
  delete process.env.AI_FALLBACK_PROVIDER
})

describe('providerFromEnv', () => {
  it('usa Groq per default', () => {
    expect(providerFromEnv().name).toBe('groq')
  })

  it('usa Anthropic quando AI_PROVIDER lo chiede', () => {
    process.env.AI_PROVIDER = 'anthropic'
    expect(providerFromEnv().name).toBe('anthropic')
  })

  it('rifiuta un provider sconosciuto invece di ripiegare in silenzio', () => {
    process.env.AI_PROVIDER = 'inventato'
    expect(() => providerFromEnv()).toThrow(/inventato/)
  })
})

describe('fallbackProviderFromEnv', () => {
  it('non c è nessun fallback se non lo si configura', () => {
    expect(fallbackProviderFromEnv()).toBeNull()
  })

  it('restituisce il provider alternativo configurato', () => {
    process.env.AI_FALLBACK_PROVIDER = 'anthropic'
    expect(fallbackProviderFromEnv()?.name).toBe('anthropic')
  })

  it('ignora un fallback identico al provider principale', () => {
    process.env.AI_PROVIDER = 'groq'
    process.env.AI_FALLBACK_PROVIDER = 'groq'
    expect(fallbackProviderFromEnv()).toBeNull()
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/extract/providers`
Expected: FAIL sui due file nuovi (groq resta verde).

- [ ] **Step 4: Implementare il provider Anthropic**

Crea `src/modules/extract/providers/anthropic.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv } from '@/lib/env'
import { VisionProviderError, type VisionProvider, type VisionRequest } from './types'

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5'
const MAX_TOKENS = 16000

/** Firma minima che ci serve dell SDK: permette di iniettarne un finto nei test. */
export type MessageCreator = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>
}>

function defaultCreator(): MessageCreator {
  const client = new Anthropic()
  return (params) =>
    client.messages.create(params as never) as unknown as ReturnType<MessageCreator>
}

export function createAnthropicProvider(create?: MessageCreator): VisionProvider {
  return {
    name: 'anthropic',

    async extract(request: VisionRequest) {
      const model = optionalEnv('ANTHROPIC_MODEL', ANTHROPIC_DEFAULT_MODEL)
      const createMessage = create ?? defaultCreator()

      let response: Awaited<ReturnType<MessageCreator>>
      try {
        response = await createMessage({
          model,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: request.image.toString('base64'),
                  },
                },
                { type: 'text', text: request.prompt },
              ],
            },
            ...(request.previousTurns ?? []).map((turn) => ({
              role: turn.role,
              content: turn.text,
            })),
          ],
        })
      } catch (cause) {
        throw new VisionProviderError('Chiamata ad Anthropic non riuscita', { cause })
      }

      const raw = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')

      if (raw.trim() === '') {
        throw new VisionProviderError('Anthropic ha restituito una risposta senza testo')
      }

      return { raw, model, provider: 'anthropic' }
    },
  }
}
```

Crea `src/modules/extract/providers/index.ts`:

```ts
import { optionalEnv } from '@/lib/env'
import { createAnthropicProvider } from './anthropic'
import { createGroqProvider } from './groq'
import type { VisionProvider } from './types'

export type { VisionProvider, VisionRequest, VisionResult } from './types'
export { VisionProviderError } from './types'
export { createGroqProvider, GROQ_DEFAULT_MODEL } from './groq'
export { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from './anthropic'

function byName(name: string): VisionProvider {
  switch (name) {
    case 'groq':
      return createGroqProvider()
    case 'anthropic':
      return createAnthropicProvider()
    default:
      throw new Error(`Provider AI non riconosciuto: ${name}`)
  }
}

export function providerFromEnv(): VisionProvider {
  return byName(optionalEnv('AI_PROVIDER', 'groq'))
}

/** Provider di riserva, usato solo se il principale non produce un output valido. */
export function fallbackProviderFromEnv(): VisionProvider | null {
  const fallback = optionalEnv('AI_FALLBACK_PROVIDER', '')
  const primary = optionalEnv('AI_PROVIDER', 'groq')
  if (fallback === '' || fallback === primary) return null
  return byName(fallback)
}
```

- [ ] **Step 5: Eseguire i test**

Run: `npx vitest run tests/modules/extract/providers`
Expected: PASS, 20 test (10 Groq, 7 Anthropic, 6 selezione — verifica il conteggio effettivo e riportalo).

- [ ] **Step 6: Aggiungere le variabili a `.env.example`**

```dotenv
AI_PROVIDER=groq              # groq | anthropic
AI_FALLBACK_PROVIDER=         # opzionale: provider di riserva
GROQ_MODEL=qwen/qwen3.8-27b
ANTHROPIC_MODEL=claude-opus-5
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add the Anthropic vision provider and env-based selection"
```

---

### Task 8: Orchestrazione dell'estrazione

**Files:**
- Create: `src/modules/extract/extract.ts`, `src/modules/extract/index.ts`
- Test: `tests/modules/extract/extract.test.ts`

**Interfaces:**
- Consumes: `parseExtraction` da `./schema`, i prompt da `./prompt`, i provider da `./providers`
- Produces: da `@/modules/extract`: `extractRoster(input: { image: Buffer; knownCodes: string[]; provider?: VisionProvider; fallback?: VisionProvider | null }): Promise<ExtractionOutcome>` dove `type ExtractionOutcome = { ok: true; extraction: Extraction; rawOutput: string; provider: string; model: string; attempts: number } | { ok: false; error: string; rawOutput: string | null; attempts: number }`

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/extract/extract.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { extractRoster } from '@/modules/extract'
import { VisionProviderError, type VisionProvider } from '@/modules/extract/providers'

const IMAGE = Buffer.from([0xff, 0xd8, 0xff])

const VALIDA = JSON.stringify({
  year: 2026,
  month: 8,
  ward: '3°PIANO',
  columns: ['RENATA'],
  cells: [{ day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false }],
})

function provider(name: string, ...risposte: Array<string | Error>): VisionProvider {
  const extract = vi.fn()
  for (const risposta of risposte) {
    if (risposta instanceof Error) extract.mockRejectedValueOnce(risposta)
    else extract.mockResolvedValueOnce({ raw: risposta, model: `${name}-model`, provider: name })
  }
  return { name, extract }
}

describe('extractRoster', () => {
  it('restituisce l estrazione validata al primo tentativo', async () => {
    const result = await extractRoster({
      image: IMAGE,
      knownCodes: ['M'],
      provider: provider('groq', VALIDA),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.extraction.month).toBe(8)
      expect(result.attempts).toBe(1)
      expect(result.provider).toBe('groq')
      expect(result.rawOutput).toBe(VALIDA)
    }
  })

  it('chiede una riparazione quando il primo output non è valido, e riesce', async () => {
    const p = provider('groq', '{"year": 2026}', VALIDA)

    const result = await extractRoster({ image: IMAGE, knownCodes: [], provider: p })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.attempts).toBe(2)
    expect(p.extract).toHaveBeenCalledTimes(2)
  })

  it('nella riparazione rimanda l output sbagliato e l errore di validazione', async () => {
    const p = provider('groq', 'non è JSON', VALIDA)

    await extractRoster({ image: IMAGE, knownCodes: [], provider: p })

    const secondaChiamata = vi.mocked(p.extract).mock.calls[1][0]
    expect(secondaChiamata.previousTurns?.[0]).toEqual({
      role: 'assistant',
      text: 'non è JSON',
    })
    expect(secondaChiamata.previousTurns?.[1].text).toMatch(/JSON/i)
  })

  it('passa al provider di riserva se il principale non si corregge', async () => {
    const primario = provider('groq', 'spazzatura', 'ancora spazzatura')
    const riserva = provider('anthropic', VALIDA)

    const result = await extractRoster({
      image: IMAGE,
      knownCodes: [],
      provider: primario,
      fallback: riserva,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.provider).toBe('anthropic')
    expect(primario.extract).toHaveBeenCalledTimes(2)
    expect(riserva.extract).toHaveBeenCalledTimes(1)
  })

  it('fallisce riportando l ultimo output grezzo quando nessuno produce JSON valido', async () => {
    const result = await extractRoster({
      image: IMAGE,
      knownCodes: [],
      provider: provider('groq', 'a', 'b'),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rawOutput).toBe('b')
      expect(result.error).toMatch(/JSON/i)
      expect(result.attempts).toBe(2)
    }
  })

  it('non riprova se il provider stesso è in errore: non è un problema di formato', async () => {
    const p = provider('groq', new VisionProviderError('quota esaurita'))

    const result = await extractRoster({ image: IMAGE, knownCodes: [], provider: p })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/quota esaurita/)
      expect(result.rawOutput).toBeNull()
    }
    expect(p.extract).toHaveBeenCalledTimes(1)
  })

  it('prova la riserva anche quando il principale va in errore di provider', async () => {
    const result = await extractRoster({
      image: IMAGE,
      knownCodes: [],
      provider: provider('groq', new VisionProviderError('quota esaurita')),
      fallback: provider('anthropic', VALIDA),
    })

    expect(result.ok).toBe(true)
  })

  it('include i codici noti nel prompt che manda al provider', async () => {
    const p = provider('groq', VALIDA)

    await extractRoster({ image: IMAGE, knownCodes: ['M', 'NOTTE'], provider: p })

    const prompt = vi.mocked(p.extract).mock.calls[0][0].prompt
    expect(prompt).toContain('NOTTE')
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/extract/extract.test.ts`
Expected: FAIL — `@/modules/extract` non esiste.

- [ ] **Step 3: Implementare**

Crea `src/modules/extract/extract.ts`:

```ts
import { buildExtractionPrompt, buildRepairPrompt } from './prompt'
import { parseExtraction, type Extraction } from './schema'
import { VisionProviderError, type VisionProvider } from './providers'

export type ExtractionOutcome =
  | {
      ok: true
      extraction: Extraction
      rawOutput: string
      provider: string
      model: string
      attempts: number
    }
  | { ok: false; error: string; rawOutput: string | null; attempts: number }

interface ProviderAttempt {
  ok: boolean
  extraction?: Extraction
  rawOutput: string | null
  model?: string
  error?: string
  attempts: number
}

/**
 * Un provider ha due possibilità: la prima chiamata e, se l output non passa la
 * validazione, una richiesta di riparazione con l errore in mano. Un errore del
 * provider (quota, rete) non è un problema di formato: non si riprova, si passa
 * eventualmente alla riserva.
 */
async function tryProvider(
  provider: VisionProvider,
  image: Buffer,
  prompt: string,
): Promise<ProviderAttempt> {
  let attempts = 0
  let lastRaw: string | null = null
  let lastError = 'Estrazione non riuscita'

  for (let round = 0; round < 2; round += 1) {
    attempts += 1

    let result
    try {
      result = await provider.extract({
        image,
        prompt: round === 0 ? prompt : buildRepairPrompt(lastRaw ?? '', lastError),
        previousTurns:
          round === 0
            ? undefined
            : [
                { role: 'assistant' as const, text: lastRaw ?? '' },
                { role: 'user' as const, text: buildRepairPrompt(lastRaw ?? '', lastError) },
              ],
      })
    } catch (error) {
      const message = error instanceof VisionProviderError ? error.message : String(error)
      return { ok: false, rawOutput: lastRaw, error: message, attempts }
    }

    lastRaw = result.raw
    const parsed = parseExtraction(result.raw)
    if (parsed.ok) {
      return {
        ok: true,
        extraction: parsed.value,
        rawOutput: result.raw,
        model: result.model,
        attempts,
      }
    }
    lastError = parsed.error
  }

  return { ok: false, rawOutput: lastRaw, error: lastError, attempts }
}

export async function extractRoster(input: {
  image: Buffer
  knownCodes: string[]
  provider: VisionProvider
  fallback?: VisionProvider | null
}): Promise<ExtractionOutcome> {
  const prompt = buildExtractionPrompt(input.knownCodes)

  const primary = await tryProvider(input.provider, input.image, prompt)
  if (primary.ok && primary.extraction && primary.rawOutput !== null) {
    return {
      ok: true,
      extraction: primary.extraction,
      rawOutput: primary.rawOutput,
      provider: input.provider.name,
      model: primary.model ?? 'sconosciuto',
      attempts: primary.attempts,
    }
  }

  if (input.fallback) {
    const secondary = await tryProvider(input.fallback, input.image, prompt)
    if (secondary.ok && secondary.extraction && secondary.rawOutput !== null) {
      return {
        ok: true,
        extraction: secondary.extraction,
        rawOutput: secondary.rawOutput,
        provider: input.fallback.name,
        model: secondary.model ?? 'sconosciuto',
        attempts: primary.attempts + secondary.attempts,
      }
    }
    return {
      ok: false,
      error: secondary.error ?? 'Estrazione non riuscita',
      rawOutput: secondary.rawOutput,
      attempts: primary.attempts + secondary.attempts,
    }
  }

  return {
    ok: false,
    error: primary.error ?? 'Estrazione non riuscita',
    rawOutput: primary.rawOutput,
    attempts: primary.attempts,
  }
}
```

Crea `src/modules/extract/index.ts`:

```ts
export type { Extraction, ExtractedCell } from './schema'
export { extractionSchema, parseExtraction } from './schema'
export { buildExtractionPrompt, buildRepairPrompt } from './prompt'
export type { ExtractionOutcome } from './extract'
export { extractRoster } from './extract'
export * from './providers'
```

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/modules/extract`
Expected: PASS, 8 test nuovi in questo file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: orchestrate extraction with repair and provider fallback"
```

---

### Task 9: Persistenza dell'estrazione

**Files:**
- Create: `src/modules/roster/repository.ts`, `src/modules/roster/index.ts`
- Test: `tests/modules/roster/repository.test.ts`

**Interfaces:**
- Consumes: `prisma` da `@/lib/db`; `matchCode`, `listShiftCodes` da `@/modules/codes`; `Extraction` da `@/modules/extract`
- Produces: da `@/modules/roster`: `createRoster(input: { year: number; month: number; ward: string; imagePath: string }): Promise<{ id: string; version: number }>`, `saveExtraction(rosterId: string, extraction: Extraction, meta: { provider: string; rawOutput: string }): Promise<{ cells: number; unresolved: number }>`, `markExtractionFailed(rosterId: string, rawOutput: string | null): Promise<void>`, `getRosterWithCells(rosterId: string)`, `nextVersion(year: number, month: number, ward: string): Promise<number>`

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/modules/roster/repository.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import type { Extraction } from '@/modules/extract/schema'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let repo: typeof import('@/modules/roster/repository')

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()
  repo = await import('@/modules/roster/repository')
})

afterAll(async () => {
  await db.cleanup()
})

beforeEach(async () => {
  await prisma.rosterCell.deleteMany()
  await prisma.roster.deleteMany()
  await prisma.shiftCode.deleteMany()
  await prisma.shiftCode.createMany({
    data: [
      { code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' },
      { code: 'M RSF', label: 'Mattino RSF', kind: 'work', startTime: '07:00', endTime: '14:00' },
    ],
  })
})

function estrazione(cells: Extraction['cells']): Extraction {
  return { year: 2026, month: 8, ward: '3°PIANO', columns: ['RENATA', 'MERY'], cells }
}

describe('createRoster', () => {
  it('crea la prima versione', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    expect(r.version).toBe(1)
  })

  it('incrementa la versione per lo stesso mese e reparto', async () => {
    await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    const seconda = await repo.createRoster({
      year: 2026,
      month: 8,
      ward: '3°PIANO',
      imagePath: 'b.jpg',
    })
    expect(seconda.version).toBe(2)
  })
})

describe('saveExtraction', () => {
  it('salva le celle risolvendo i codici con la legenda', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    const esito = await repo.saveExtraction(
      r.id,
      estrazione([
        { day: 1, column: 'RENATA', code: 'M', confidence: 0.99, handCorrected: false },
        { day: 2, column: 'RENATA', code: 'm rsf', confidence: 0.7, handCorrected: false },
      ]),
      { provider: 'groq', rawOutput: '{...}' },
    )

    expect(esito).toEqual({ cells: 2, unresolved: 0 })
    const celle = await prisma.rosterCell.findMany({ orderBy: { day: 'asc' } })
    expect(celle[0].code).toBe('M')
    // il codice grezzo resta come letto, quello risolto è la forma canonica
    expect(celle[1].rawCode).toBe('m rsf')
    expect(celle[1].code).toBe('M RSF')
  })

  it('lascia il codice non risolto quando la legenda non lo conosce, senza fallire', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    const esito = await repo.saveExtraction(
      r.id,
      estrazione([{ day: 1, column: 'MERY', code: 'XYZ', confidence: 0.3, handCorrected: true }]),
      { provider: 'groq', rawOutput: '{...}' },
    )

    expect(esito).toEqual({ cells: 1, unresolved: 1 })
    const cella = await prisma.rosterCell.findFirstOrThrow()
    expect(cella.rawCode).toBe('XYZ')
    expect(cella.code).toBeNull()
    expect(cella.handCorrected).toBe(true)
  })

  it('salta le celle vuote invece di crearle', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    const esito = await repo.saveExtraction(
      r.id,
      estrazione([
        { day: 1, column: 'RENATA', code: '', confidence: 0.9, handCorrected: false },
        { day: 2, column: 'RENATA', code: '  ', confidence: 0.9, handCorrected: false },
      ]),
      { provider: 'groq', rawOutput: '{}' },
    )

    expect(esito.cells).toBe(0)
    expect(await prisma.rosterCell.count()).toBe(0)
  })

  it('porta la tabella nello stato extracted e conserva provider e output grezzo', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    await repo.saveExtraction(r.id, estrazione([]), { provider: 'groq', rawOutput: 'RAW' })

    const salvata = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvata.status).toBe('extracted')
    expect(salvata.provider).toBe('groq')
    expect(salvata.rawOutput).toBe('RAW')
  })

  it('è ripetibile: rieseguirla sostituisce le celle invece di duplicarle', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    const cells = [{ day: 1, column: 'RENATA', code: 'M', confidence: 0.9, handCorrected: false }]

    await repo.saveExtraction(r.id, estrazione(cells), { provider: 'groq', rawOutput: 'a' })
    await repo.saveExtraction(r.id, estrazione(cells), { provider: 'groq', rawOutput: 'b' })

    expect(await prisma.rosterCell.count({ where: { rosterId: r.id } })).toBe(1)
  })
})

describe('markExtractionFailed', () => {
  it('porta la tabella nello stato failed conservando l output grezzo', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })

    await repo.markExtractionFailed(r.id, 'output illeggibile')

    const salvata = await prisma.roster.findUniqueOrThrow({ where: { id: r.id } })
    expect(salvata.status).toBe('failed')
    expect(salvata.rawOutput).toBe('output illeggibile')
  })
})

describe('getRosterWithCells', () => {
  it('restituisce la tabella con le celle ordinate per giorno e colonna', async () => {
    const r = await repo.createRoster({ year: 2026, month: 8, ward: '3°PIANO', imagePath: 'a.jpg' })
    await repo.saveExtraction(
      r.id,
      estrazione([
        { day: 2, column: 'MERY', code: 'M', confidence: 1, handCorrected: false },
        { day: 1, column: 'RENATA', code: 'M', confidence: 1, handCorrected: false },
      ]),
      { provider: 'groq', rawOutput: '{}' },
    )

    const caricata = await repo.getRosterWithCells(r.id)

    expect(caricata?.cells.map((c) => c.day)).toEqual([1, 2])
  })

  it('restituisce null per un id inesistente', async () => {
    expect(await repo.getRosterWithCells('non-esiste')).toBeNull()
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npx vitest run tests/modules/roster/repository.test.ts`
Expected: FAIL — modulo inesistente.

- [ ] **Step 3: Implementare**

Crea `src/modules/roster/repository.ts`:

```ts
import { prisma } from '@/lib/db'
import { listShiftCodes, matchCode } from '@/modules/codes'
import type { Extraction } from '@/modules/extract/schema'

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
  const version = await nextVersion(input.year, input.month, input.ward)
  const created = await prisma.roster.create({
    data: { ...input, version, status: 'uploaded' },
    select: { id: true, version: true },
  })
  return created
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
    ...celle.map((data) => prisma.rosterCell.create({ data })),
    prisma.roster.update({
      where: { id: rosterId },
      data: { status: 'extracted', provider: meta.provider, rawOutput: meta.rawOutput },
    }),
  ])

  return { cells: celle.length, unresolved: celle.filter((c) => c.code === null).length }
}

export async function markExtractionFailed(
  rosterId: string,
  rawOutput: string | null,
): Promise<void> {
  await prisma.roster.update({
    where: { id: rosterId },
    data: { status: 'failed', rawOutput },
  })
}

export async function getRosterWithCells(rosterId: string) {
  return prisma.roster.findUnique({
    where: { id: rosterId },
    include: { cells: { orderBy: [{ day: 'asc' }, { columnLabel: 'asc' }] } },
  })
}
```

Crea `src/modules/roster/index.ts`:

```ts
export {
  createRoster,
  getRosterWithCells,
  markExtractionFailed,
  nextVersion,
  saveExtraction,
} from './repository'
```

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/modules/roster`
Expected: PASS, 8 dello schema + 10 del repository.

- [ ] **Step 5: Eseguire tutta la suite e il lint**

Run: `npm test && npm run lint`
Expected: PASS (il totale sarà oltre 180 test: riporta il numero esatto).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: persist extracted rosters resolving codes against the legend"
```

---

### Task 10: Misura dell'accuratezza sulle foto reali

**Files:**
- Create: `scripts/eval-extraction.ts`
- Modify: `package.json` (script `eval`)
- Test: `tests/scripts/accuracy.test.ts`
- Fornite dal controller: `fixtures/roster-2026-08-3piano.expected.json`, `fixtures/roster-2026-09-3piano.expected.json`

**Interfaces:**
- Consumes: `normalizeRosterPhoto` da `@/modules/ingest`, `extractRoster`/`providerFromEnv`/`fallbackProviderFromEnv` da `@/modules/extract`, `compactCode` da `@/modules/codes`
- Produces: da `scripts/accuracy.ts`: `compareExtraction(expected: ExpectedRoster, actual: Extraction): AccuracyReport` con `interface AccuracyReport { total: number; correct: number; missing: number; spurious: number; wrong: Array<{ day: number; column: string; expected: string; actual: string }>; byColumn: Record<string, { total: number; correct: number }> }`

**Nota importante:** i due file `*.expected.json` sono la **verità di riferimento**, trascritti a mano dal controller leggendo le foto e da confermare dal proprietario. Non generarli né modificarli con l'output del modello: sarebbe come farsi correggere il compito da chi lo ha scritto.

- [ ] **Step 1: Scrivere i test del confronto (falliscono)**

Crea `tests/scripts/accuracy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compareExtraction } from '../../scripts/accuracy'

const expected = {
  year: 2026,
  month: 8,
  ward: '3°PIANO',
  cells: [
    { day: 1, column: 'RENATA', code: 'M' },
    { day: 2, column: 'RENATA', code: 'RP' },
    { day: 1, column: 'MERY', code: 'M/P' },
  ],
}

function actual(cells: Array<{ day: number; column: string; code: string }>) {
  return {
    year: 2026,
    month: 8,
    ward: '3°PIANO',
    columns: ['RENATA', 'MERY'],
    cells: cells.map((c) => ({ ...c, confidence: 1, handCorrected: false })),
  }
}

describe('compareExtraction', () => {
  it('conta tutte corrette quando coincidono', () => {
    const report = compareExtraction(expected, actual(expected.cells))
    expect(report).toMatchObject({ total: 3, correct: 3, missing: 0, spurious: 0 })
    expect(report.wrong).toEqual([])
  })

  it('considera equivalenti le forme compatte dello stesso codice', () => {
    const report = compareExtraction(
      { ...expected, cells: [{ day: 1, column: 'RENATA', code: 'M1°P' }] },
      actual([{ day: 1, column: 'RENATA', code: 'm 1°p' }]),
    )
    expect(report.correct).toBe(1)
  })

  it('segnala una cella letta male, con atteso e trovato', () => {
    const report = compareExtraction(expected, actual([
      { day: 1, column: 'RENATA', code: 'P' },
      { day: 2, column: 'RENATA', code: 'RP' },
      { day: 1, column: 'MERY', code: 'M/P' },
    ]))
    expect(report.correct).toBe(2)
    expect(report.wrong).toEqual([
      { day: 1, column: 'RENATA', expected: 'M', actual: 'P' },
    ])
  })

  it('conta le celle attese che il modello non ha prodotto', () => {
    const report = compareExtraction(expected, actual([{ day: 1, column: 'RENATA', code: 'M' }]))
    expect(report.missing).toBe(2)
  })

  it('conta le celle prodotte che nessuno si aspettava', () => {
    const report = compareExtraction(
      { ...expected, cells: [{ day: 1, column: 'RENATA', code: 'M' }] },
      actual([
        { day: 1, column: 'RENATA', code: 'M' },
        { day: 9, column: 'RENATA', code: 'M' },
      ]),
    )
    expect(report.spurious).toBe(1)
  })

  it('riporta l accuratezza per colonna, così si vede se una è illeggibile', () => {
    const report = compareExtraction(expected, actual([
      { day: 1, column: 'RENATA', code: 'M' },
      { day: 2, column: 'RENATA', code: 'RP' },
      { day: 1, column: 'MERY', code: 'SBAGLIATO' },
    ]))
    expect(report.byColumn).toEqual({
      RENATA: { total: 2, correct: 2 },
      MERY: { total: 1, correct: 0 },
    })
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npx vitest run tests/scripts/accuracy.test.ts`
Expected: FAIL — `scripts/accuracy` non esiste.

- [ ] **Step 3: Implementare il confronto**

Crea `scripts/accuracy.ts`:

```ts
import { compactCode } from '../src/modules/codes/normalize'
import type { Extraction } from '../src/modules/extract/schema'

export interface ExpectedRoster {
  year: number
  month: number
  ward: string
  cells: Array<{ day: number; column: string; code: string }>
}

export interface AccuracyReport {
  total: number
  correct: number
  missing: number
  spurious: number
  wrong: Array<{ day: number; column: string; expected: string; actual: string }>
  byColumn: Record<string, { total: number; correct: number }>
}

function key(day: number, column: string): string {
  return `${day}:${column.trim().toUpperCase()}`
}

/** Il confronto è sulla forma compatta: "M 1°P" e "M1°P" sono lo stesso turno. */
export function compareExtraction(expected: ExpectedRoster, actual: Extraction): AccuracyReport {
  const trovate = new Map(actual.cells.map((cell) => [key(cell.day, cell.column), cell.code]))

  const report: AccuracyReport = {
    total: expected.cells.length,
    correct: 0,
    missing: 0,
    spurious: 0,
    wrong: [],
    byColumn: {},
  }

  for (const attesa of expected.cells) {
    const colonna = attesa.column.trim().toUpperCase()
    report.byColumn[colonna] ??= { total: 0, correct: 0 }
    report.byColumn[colonna].total += 1

    const trovata = trovate.get(key(attesa.day, attesa.column))
    if (trovata === undefined) {
      report.missing += 1
      continue
    }

    if (compactCode(trovata) === compactCode(attesa.code)) {
      report.correct += 1
      report.byColumn[colonna].correct += 1
    } else {
      report.wrong.push({
        day: attesa.day,
        column: attesa.column,
        expected: attesa.code,
        actual: trovata,
      })
    }
  }

  const attese = new Set(expected.cells.map((cell) => key(cell.day, cell.column)))
  report.spurious = actual.cells.filter((cell) => !attese.has(key(cell.day, cell.column))).length

  return report
}
```

- [ ] **Step 4: Eseguire i test**

Run: `npx vitest run tests/scripts/accuracy.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Implementare lo script di valutazione**

Crea `scripts/eval-extraction.ts`:

```ts
/**
 * Misura l accuratezza dell estrazione contro le fixture, chiamando il provider REALE.
 * Non è un test: consuma token e non gira in CI. Uso: npm run eval
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeRosterPhoto } from '../src/modules/ingest/normalize'
import { extractRoster } from '../src/modules/extract/extract'
import { fallbackProviderFromEnv, providerFromEnv } from '../src/modules/extract/providers'
import { DEFAULT_SHIFT_CODES } from '../src/modules/codes/defaults'
import { compareExtraction, type ExpectedRoster } from './accuracy'

const FIXTURES = join(process.cwd(), 'fixtures')

async function main(): Promise<void> {
  const attesi = readdirSync(FIXTURES).filter((f) => f.endsWith('.expected.json'))
  if (attesi.length === 0) {
    console.error('Nessun file *.expected.json in fixtures/: senza verità di riferimento non si misura nulla.')
    process.exit(1)
  }

  const provider = providerFromEnv()
  const fallback = fallbackProviderFromEnv()
  const knownCodes = DEFAULT_SHIFT_CODES.map((def) => def.code)

  let totaleCelle = 0
  let totaleCorrette = 0

  for (const nomeAtteso of attesi) {
    const nomeFoto = nomeAtteso.replace('.expected.json', '.jpeg')
    const expected = JSON.parse(readFileSync(join(FIXTURES, nomeAtteso), 'utf8')) as ExpectedRoster

    console.log(`\n=== ${nomeFoto} (provider: ${provider.name}) ===`)
    const immagine = await normalizeRosterPhoto(readFileSync(join(FIXTURES, nomeFoto)))
    console.log(`immagine normalizzata: ${immagine.width}x${immagine.height}, ${Math.round(immagine.bytes / 1024)} KB`)

    const inizio = Date.now()
    const esito = await extractRoster({ image: immagine.data, knownCodes, provider, fallback })
    const secondi = ((Date.now() - inizio) / 1000).toFixed(1)

    if (!esito.ok) {
      console.error(`estrazione FALLITA dopo ${esito.attempts} tentativi in ${secondi}s: ${esito.error}`)
      console.error(`output grezzo: ${esito.rawOutput?.slice(0, 500) ?? '(nessuno)'}`)
      continue
    }

    const report = compareExtraction(expected, esito.extraction)
    const percentuale = report.total === 0 ? 0 : (report.correct / report.total) * 100

    totaleCelle += report.total
    totaleCorrette += report.correct

    console.log(`tentativi: ${esito.attempts} | tempo: ${secondi}s | provider usato: ${esito.provider} (${esito.model})`)
    console.log(`intestazione: ${esito.extraction.ward} ${esito.extraction.month}/${esito.extraction.year} (atteso: ${expected.ward} ${expected.month}/${expected.year})`)
    console.log(`accuratezza: ${report.correct}/${report.total} celle (${percentuale.toFixed(1)}%), mancanti ${report.missing}, in eccesso ${report.spurious}`)

    console.log('per colonna:')
    for (const [colonna, dati] of Object.entries(report.byColumn).sort()) {
      const pct = dati.total === 0 ? 0 : (dati.correct / dati.total) * 100
      console.log(`  ${colonna.padEnd(12)} ${dati.correct}/${dati.total} (${pct.toFixed(0)}%)`)
    }

    if (report.wrong.length > 0) {
      console.log(`celle sbagliate (${report.wrong.length}):`)
      for (const errore of report.wrong.slice(0, 40)) {
        console.log(`  giorno ${String(errore.day).padStart(2)} ${errore.column.padEnd(12)} atteso "${errore.expected}" letto "${errore.actual}"`)
      }
      if (report.wrong.length > 40) console.log(`  ... e altre ${report.wrong.length - 40}`)
    }
  }

  if (totaleCelle > 0) {
    const complessiva = (totaleCorrette / totaleCelle) * 100
    console.log(`\n=== TOTALE: ${totaleCorrette}/${totaleCelle} celle (${complessiva.toFixed(1)}%) ===`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 6: Aggiungere lo script a `package.json`**

```json
"eval": "tsx scripts/eval-extraction.ts"
```

- [ ] **Step 7: Verificare che lo script parta senza chiave**

Run: `npm run eval` (senza `GROQ_API_KEY`)
Expected: l'estrazione fallisce con un messaggio chiaro su `GROQ_API_KEY non configurata`, **non** con uno stack trace incomprensibile, e il processo esce con codice diverso da zero. Non inventare una chiave.

- [ ] **Step 8: Eseguire tutta la suite e il lint**

Run: `npm test && npm run lint && npm run build`
Expected: tutto verde; riporta il numero di test.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: measure per-cell extraction accuracy against the real photos"
```

---

## Definizione di completamento della Fase 2A

- [ ] `npm test` verde, `npm run lint` e `npm run build` puliti
- [ ] `npm run eval` con una `GROQ_API_KEY` valida stampa l'accuratezza per cella e per colonna sulle due foto reali
- [ ] Un'estrazione non valida viene riparata al secondo tentativo, e se fallisce anche quello l'output grezzo resta salvato
- [ ] Un codice sconosciuto non fa fallire nulla: viene salvato come `rawCode` con `code = null`
- [ ] Nessun test parla con la rete

## Cosa decide la misura

Il numero che esce da `npm run eval` decide la fase successiva:

- **oltre il 95%** di celle corrette: si prosegue con la Fase 2B (upload e visualizzazione) senza cambiare strategia;
- **fra l'85% e il 95%**: si prosegue, ma la griglia di conferma della Fase 3 diventa più importante dell'interfaccia di caricamento;
- **sotto l'85%**: prima di costruire altro si prova l'estrazione **una colonna per chiamata** (8 chiamate invece di una, costo ancora trascurabile su Groq) e si rimisura. Il limite di 2048 token per immagine di Groq rende questo scenario plausibile su una tabella di 240 celle.
