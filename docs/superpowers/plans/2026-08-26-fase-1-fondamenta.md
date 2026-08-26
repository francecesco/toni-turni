# Fase 1 — Fondamenta: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avere un'app Next.js deployabile su ZimaBoard in cui le infermiere accedono con Google e la referente configura la legenda dei turni con i relativi orari.

**Architecture:** Monolite Next.js 16 (App Router) con moduli di dominio isolati sotto `src/modules/`, persistenza Prisma/SQLite, login OAuth Google senza password. Questa fase costruisce le fondamenta che le fasi successive consumano: la conversione codice turno → intervallo orario (usata dal sync), la gestione fusi/ora legale (il punto dove i bug sono invisibili) e l'autenticazione con ruoli.

**Tech Stack:** Next.js 16, TypeScript, Prisma + SQLite, Tailwind + shadcn/ui, `jose`, `google-auth-library`, Vitest, Docker Compose + cloudflared.

**Spec:** `docs/superpowers/specs/2026-08-26-toni-turni-design.md`

## Global Constraints

- **Node 22**, gestore pacchetti `npm`. Target hardware: ZimaBoard x86_64, 8 GB RAM → nessuna dipendenza pesante senza motivo.
- **TDD obbligatorio:** RED → GREEN → REFACTOR. Nessun codice di produzione senza un test rosso che lo giustifichi. Nessun "fatto" senza aver eseguito la suite e letto l'output.
- **Fuso orario:** ogni orario di turno è wall clock di `Europe/Rome`. Gli eventi Google si costruiscono con `{ dateTime, timeZone: "Europe/Rome" }`, mai con offset fissi né UTC calcolato a mano.
- **Identificatori e messaggi di commit in inglese; testi UI, commenti di codice e descrizioni dei test in italiano.** I codici turno restano come sulla carta (`M`, `P`, `NOTTE`, `RP`): non tradurli.
- **Nessun segreto nel repository.** Solo variabili d'ambiente. `refreshToken` cifrato a riposo con `APP_ENCRYPTION_KEY` (32 byte base64).
- **Ruoli:** `REFERENTE` (carica tabelle, modifica legenda, invita utenti) e `NURSE`. Autorizzazione verificata lato server, non solo in UI.
- **Un commit per task**, test e implementazione insieme.

## File Structure

| File | Responsabilità |
|---|---|
| `prisma/schema.prisma` | Modello dati (Fase 1: `User`, `GoogleAccount`, `Invite`, `ShiftCode`) |
| `prisma/seed.ts` | Carica la legenda turni di default |
| `src/lib/db.ts` | Singleton `PrismaClient` |
| `src/lib/time.ts` | Conversione wall clock ↔ UTC con ora legale, aritmetica su date ISO |
| `src/lib/crypto.ts` | Cifratura simmetrica AES-256-GCM dei token |
| `src/lib/env.ts` | Lettura e validazione delle variabili d'ambiente |
| `src/modules/codes/types.ts` | `ShiftCodeDef`, `ShiftKind`, `CalendarSlot` |
| `src/modules/codes/normalize.ts` | Normalizzazione e matching dei codici letti dalla tabella |
| `src/modules/codes/slot.ts` | Codice turno + giorno → intervallo per il calendario |
| `src/modules/codes/defaults.ts` | Legenda di default (seed) |
| `src/modules/codes/form.ts` | Validazione del form della legenda (logica pura) |
| `src/modules/codes/repository.ts` | Lettura/scrittura `ShiftCode` su database |
| `src/modules/auth/policy.ts` | Chi può registrarsi, con quale ruolo (logica pura) |
| `src/modules/auth/token.ts` | Firma e verifica del token di sessione (logica pura) |
| `src/modules/auth/session.ts` | Lettura/scrittura del cookie di sessione |
| `src/modules/auth/google.ts` | URL di consenso e scambio del codice OAuth |
| `src/modules/auth/guards.ts` | `requireUser()`, `requireReferente()` per route e pagine |
| `src/app/login/page.tsx` | Schermata di accesso |
| `src/app/api/auth/google/start/route.ts` | Avvio del flusso OAuth con `state` anti-CSRF |
| `src/app/api/auth/google/callback/route.ts` | Callback: crea utente, salva token, apre sessione |
| `src/app/api/auth/logout/route.ts` | Chiusura sessione |
| `src/app/api/health/route.ts` | Healthcheck per Docker |
| `src/app/settings/codes/page.tsx` | Legenda turni modificabile (solo referente) |
| `src/app/settings/users/page.tsx` | Inviti (solo referente) |
| `tests/helpers/db.ts` | Database SQLite temporaneo per i test d'integrazione |
| `Dockerfile`, `docker-compose.yml`, `.env.example` | Deploy su ZimaBoard |

---

### Task 1: Bootstrap del progetto e suite di test

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/lib/env.ts`
- Test: `tests/lib/env.test.ts`

**Interfaces:**
- Consumes: niente (primo task)
- Produces: `npm test` funzionante; `requireEnv(name: string): string` e `optionalEnv(name: string, fallback: string): string` da `@/lib/env`; alias `@/*` → `src/*`

- [ ] **Step 1: Creare lo scheletro Next.js**

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --use-npm --no-import-alias --yes
```

Se il comando protesta perché la cartella non è vuota, conferma: i file esistenti (`CLAUDE.md`, `README.md`, `docs/`, `fixtures/`, `.git`) non vanno toccati e non devono essere cancellati.

- [ ] **Step 2: Installare Vitest e configurarlo**

```bash
npm install --save-dev vitest @types/node
```

Crea `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
```

Aggiungi gli script in `package.json` (mantieni quelli generati da create-next-app):

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint && tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts"
  }
}
```

Verifica che `tsconfig.json` contenga l'alias (create-next-app lo aggiunge, controlla):

```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

- [ ] **Step 3: Scrivere il test che fallisce per la lettura dell'ambiente**

Crea `tests/lib/env.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { optionalEnv, requireEnv } from '@/lib/env'

const KEY = 'TURNI_TEST_VALUE'

afterEach(() => {
  delete process.env[KEY]
})

describe('requireEnv', () => {
  it('restituisce il valore quando la variabile è presente', () => {
    process.env[KEY] = 'ciao'
    expect(requireEnv(KEY)).toBe('ciao')
  })

  it('solleva un errore che nomina la variabile mancante', () => {
    expect(() => requireEnv(KEY)).toThrowError(/TURNI_TEST_VALUE/)
  })

  it('tratta la stringa vuota come mancante', () => {
    process.env[KEY] = '   '
    expect(() => requireEnv(KEY)).toThrowError(/TURNI_TEST_VALUE/)
  })
})

describe('optionalEnv', () => {
  it('usa il fallback quando la variabile manca', () => {
    expect(optionalEnv(KEY, '90')).toBe('90')
  })

  it('preferisce il valore presente al fallback', () => {
    process.env[KEY] = '30'
    expect(optionalEnv(KEY, '90')).toBe('30')
  })
})
```

- [ ] **Step 4: Eseguire il test e verificare che fallisca**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "@/lib/env"`. Se fallisce con un errore diverso (per esempio l'alias non risolto in `vitest.config.ts`), sistema la configurazione prima di procedere: il test deve fallire perché il modulo non esiste, non perché la suite è rotta.

- [ ] **Step 5: Implementare `src/lib/env.ts`**

```ts
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Variabile d'ambiente mancante: ${name}`)
  }
  return value
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? fallback : value
}
```

- [ ] **Step 6: Eseguire i test**

Run: `npm test`
Expected: PASS, 5 test.

- [ ] **Step 7: Creare `.env.example`**

```dotenv
# Applicazione
APP_URL=http://localhost:3000
APP_ENCRYPTION_KEY=            # openssl rand -base64 32
SESSION_SECRET=                # openssl rand -base64 32
TZ=Europe/Rome

# Database
DATABASE_URL=file:./data/turni.db

# Provider AI (Fase 2)
AI_PROVIDER=groq
GROQ_API_KEY=
ANTHROPIC_API_KEY=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Cloudflare Tunnel (deploy)
CLOUDFLARE_TUNNEL_TOKEN=

# Privacy
IMAGE_RETENTION_DAYS=90
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Next.js project with Vitest and env helpers"
```

---

### Task 2: Persistenza Prisma/SQLite e database di test

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `tests/helpers/db.ts`
- Test: `tests/lib/db.test.ts`

**Interfaces:**
- Consumes: niente da codice applicativo (`DATABASE_URL` è letto direttamente da Prisma)
- Produces: `prisma` (istanza `PrismaClient` condivisa) da `@/lib/db`; `createTestDb(): { prisma: PrismaClient; url: string; cleanup: () => Promise<void> }` da `tests/helpers/db`; modelli `User`, `GoogleAccount`, `Invite`, `ShiftCode`

- [ ] **Step 1: Installare Prisma**

```bash
npm install @prisma/client
npm install --save-dev prisma tsx
```

- [ ] **Step 2: Scrivere lo schema**

Crea `prisma/schema.prisma`:

```prisma
generator client {
  provider      = "prisma-client-js"
  // linux-musl-openssl-3.0.x serve per l'immagine node:22-alpine del deploy
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

enum Role {
  REFERENTE
  NURSE
}

model User {
  id            String         @id @default(cuid())
  email         String         @unique
  displayName   String
  role          Role           @default(NURSE)
  createdAt     DateTime       @default(now())
  googleAccount GoogleAccount?
}

model GoogleAccount {
  id           String   @id @default(cuid())
  userId       String   @unique
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshToken String   // cifrato con APP_ENCRYPTION_KEY, mai in chiaro
  calendarId   String?
  status       String   @default("ok") // ok | needs_reauth
  updatedAt    DateTime @updatedAt
}

model Invite {
  email     String    @id
  invitedBy String
  createdAt DateTime  @default(now())
  usedAt    DateTime?
}

model ShiftCode {
  code            String   @id
  label           String
  kind            String   // work | absence | info | unknown
  startTime       String?  // "HH:mm", null per eventi tutto il giorno
  endTime         String?
  crossesMidnight Boolean  @default(false)
  location        String?
  color           String?
  needsReview     Boolean  @default(false)
  updatedAt       DateTime @updatedAt
}
```

- [ ] **Step 3: Generare la prima migrazione**

```bash
mkdir -p data
DATABASE_URL="file:./data/turni.db" npx prisma migrate dev --name init
```

Expected: cartella `prisma/migrations/<timestamp>_init/` creata e client generato.

- [ ] **Step 4: Scrivere il test che fallisce**

Crea `tests/helpers/db.ts`:

```ts
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

/** Crea un database SQLite temporaneo con lo schema migrato. */
export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'turni-test-'))
  const url = `file:${join(dir, 'test.db')}`

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  const prisma = new PrismaClient({ datasources: { db: { url } } })

  return {
    prisma,
    url,
    async cleanup() {
      await prisma.$disconnect()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
```

Crea `tests/lib/db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../helpers/db'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient

beforeAll(() => {
  db = createTestDb()
  prisma = db.prisma
})

afterAll(async () => {
  await db.cleanup()
})

describe('schema', () => {
  it('persiste un utente con ruolo di default NURSE', async () => {
    const user = await prisma.user.create({
      data: { email: 'anna@example.com', displayName: 'Anna' },
    })
    expect(user.role).toBe('NURSE')
  })

  it('impedisce due utenti con la stessa email', async () => {
    await prisma.user.create({ data: { email: 'mery@example.com', displayName: 'Mery' } })
    await expect(
      prisma.user.create({ data: { email: 'mery@example.com', displayName: 'Doppione' } }),
    ).rejects.toThrow()
  })

  it('cancella il GoogleAccount insieme all utente', async () => {
    const user = await prisma.user.create({
      data: { email: 'carmen@example.com', displayName: 'Carmen' },
    })
    await prisma.googleAccount.create({
      data: { userId: user.id, refreshToken: 'cifrato' },
    })

    await prisma.user.delete({ where: { id: user.id } })

    expect(await prisma.googleAccount.findUnique({ where: { userId: user.id } })).toBeNull()
  })

  it('salva un codice turno con orari e flag oltre mezzanotte', async () => {
    const code = await prisma.shiftCode.create({
      data: {
        code: 'NOTTE',
        label: 'Notte',
        kind: 'work',
        startTime: '21:00',
        endTime: '07:00',
        crossesMidnight: true,
      },
    })
    expect(code.crossesMidnight).toBe(true)
    expect(code.needsReview).toBe(false)
  })
})
```

- [ ] **Step 5: Eseguire il test e verificare che fallisca**

Run: `npm test tests/lib/db.test.ts`
Expected: FAIL prima di aver generato la migrazione allo Step 3; se lo Step 3 è già stato eseguito, questo test passa subito. In quel caso rendilo rosso deliberatamente: rimuovi `crossesMidnight` dallo schema, esegui il test (deve fallire), poi rimettilo. Serve a dimostrare che il test tocca davvero il database e non è un falso positivo.

- [ ] **Step 6: Implementare il singleton del client**

Crea `src/lib/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

// In sviluppo Next ricarica i moduli a ogni modifica: senza cache globale
// si aprirebbe una connessione nuova a ogni hot reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
```

- [ ] **Step 7: Eseguire tutta la suite**

Run: `npm test`
Expected: PASS, 9 test in totale (5 dal Task 1, 4 qui).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema for users, invites and shift codes"
```

---

### Task 3: Fuso orario e ora legale

**Files:**
- Create: `src/lib/time.ts`
- Test: `tests/lib/time.test.ts`

**Interfaces:**
- Consumes: niente
- Produces: da `@/lib/time`: `ROME_TZ: 'Europe/Rome'`, `addDays(isoDate: string, days: number): string`, `zoneOffsetMinutes(instant: Date, timeZone: string): number`, `wallClockToUtc(wallClock: string, timeZone: string): Date`, `hoursBetween(a: Date, b: Date): number`

Questa unità esiste perché è il punto in cui gli errori non si vedono: un turno di notte lungo 10 ore invece di 11 nella notte del cambio d'ora non fa fallire nulla, arriva solo un promemoria sbagliato. I test vengono prima.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/lib/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addDays, hoursBetween, ROME_TZ, wallClockToUtc, zoneOffsetMinutes } from '@/lib/time'

describe('addDays', () => {
  it('avanza di un giorno dentro il mese', () => {
    expect(addDays('2026-08-01', 1)).toBe('2026-08-02')
  })

  it('attraversa il confine del mese', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('attraversa il confine dell anno', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('non è disturbato dal cambio di ora legale', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
  })

  it('torna indietro con giorni negativi', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
  })
})

describe('zoneOffsetMinutes', () => {
  it('riconosce l ora solare a Roma (+1)', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), ROME_TZ)).toBe(60)
  })

  it('riconosce l ora legale a Roma (+2)', () => {
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), ROME_TZ)).toBe(120)
  })
})

describe('wallClockToUtc', () => {
  it('converte un mattino d inverno', () => {
    expect(wallClockToUtc('2026-01-15T07:00', ROME_TZ).toISOString()).toBe('2026-01-15T06:00:00.000Z')
  })

  it('converte un mattino d estate', () => {
    expect(wallClockToUtc('2026-08-01T07:00', ROME_TZ).toISOString()).toBe('2026-08-01T05:00:00.000Z')
  })

  it('la notte in cui finisce l ora legale dura 11 ore', () => {
    // 25 ottobre 2026: alle 03:00 le lancette tornano a 02:00
    const start = wallClockToUtc('2026-10-24T21:00', ROME_TZ)
    const end = wallClockToUtc('2026-10-25T07:00', ROME_TZ)
    expect(hoursBetween(start, end)).toBe(11)
  })

  it('la notte in cui inizia l ora legale dura 9 ore', () => {
    // 29 marzo 2026: alle 02:00 le lancette vanno a 03:00
    const start = wallClockToUtc('2026-03-28T21:00', ROME_TZ)
    const end = wallClockToUtc('2026-03-29T07:00', ROME_TZ)
    expect(hoursBetween(start, end)).toBe(9)
  })

  it('una notte normale dura 10 ore', () => {
    const start = wallClockToUtc('2026-08-10T21:00', ROME_TZ)
    const end = wallClockToUtc('2026-08-11T07:00', ROME_TZ)
    expect(hoursBetween(start, end)).toBe(10)
  })

  it('corregge l offset quando la prima stima cade dal lato sbagliato del cambio d ora', () => {
    // 01:30 del 25 ottobre 2026 a Roma esiste due volte: la prima occorrenza è ancora
    // ora legale (+2). Con un solo passaggio l offset stimato sarebbe +1 e il risultato
    // cadrebbe sulla seconda occorrenza, un ora più tardi.
    expect(wallClockToUtc('2026-10-25T01:30', ROME_TZ).toISOString()).toBe(
      '2026-10-24T23:30:00.000Z',
    )
  })

  it('gestisce un orario che il cambio d ora fa saltare del tutto', () => {
    // 02:30 del 29 marzo 2026 non esiste a Roma: le lancette vanno da 02:00 a 03:00.
    // Il secondo passaggio lo porta a 03:30 locali; con un solo passaggio finirebbe a 01:30.
    expect(wallClockToUtc('2026-03-29T02:30', ROME_TZ).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    )
  })

  it('accetta anche i secondi nel wall clock', () => {
    expect(wallClockToUtc('2026-08-01T07:00:00', ROME_TZ).toISOString()).toBe(
      '2026-08-01T05:00:00.000Z',
    )
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npm test tests/lib/time.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/time"`.

- [ ] **Step 3: Implementare `src/lib/time.ts`**

```ts
export const ROME_TZ = 'Europe/Rome' as const

/** Somma giorni a una data ISO (YYYY-MM-DD) restando in aritmetica UTC: nessun fuso di mezzo. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const shifted = Date.UTC(year, month - 1, day) + days * 86_400_000
  return new Date(shifted).toISOString().slice(0, 10)
}

/** Minuti di offset del fuso rispetto a UTC nell istante dato (60 = +01:00). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24, // hour12:false può restituire "24" a mezzanotte
    Number(parts.minute),
    Number(parts.second),
  )

  return (asIfUtc - instant.getTime()) / 60_000
}

/**
 * Converte un orario locale ("2026-10-25T07:00") nell istante UTC corrispondente.
 * Due passaggi: il primo stima l offset, il secondo lo corregge quando la stima
 * cade dal lato sbagliato di un cambio d ora.
 */
export function wallClockToUtc(wallClock: string, timeZone: string): Date {
  const withSeconds = wallClock.length === 16 ? `${wallClock}:00` : wallClock
  const asIfUtc = new Date(`${withSeconds}Z`)

  const firstGuess = new Date(asIfUtc.getTime() - zoneOffsetMinutes(asIfUtc, timeZone) * 60_000)
  return new Date(asIfUtc.getTime() - zoneOffsetMinutes(firstGuess, timeZone) * 60_000)
}

export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000
}
```

- [ ] **Step 4: Eseguire i test**

Run: `npm test tests/lib/time.test.ts`
Expected: PASS, 15 test (cumulativo: 24). I due test sull orario ambiguo e su quello inesistente sono gli unici che falliscono se si rimuove il secondo passaggio: sono loro a proteggere il meccanismo. Se la notte di ottobre risulta di 10 ore, il secondo passaggio di `wallClockToUtc` non sta funzionando: è esattamente il bug che questo test esiste per intercettare.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add timezone helpers handling DST transitions"
```

---

### Task 4: Modulo `codes` — legenda turni e intervalli

**Files:**
- Create: `src/modules/codes/types.ts`, `src/modules/codes/normalize.ts`, `src/modules/codes/slot.ts`, `src/modules/codes/defaults.ts`, `src/modules/codes/repository.ts`, `src/modules/codes/index.ts`, `prisma/seed.ts`
- Test: `tests/modules/codes/normalize.test.ts`, `tests/modules/codes/slot.test.ts`, `tests/modules/codes/seed.test.ts`

**Nota sugli import nei test:** i test importano i sottomoduli (`@/modules/codes/normalize`) e non la
facciata `@/modules/codes`, perché la facciata include il repository e quindi il client Prisma: i test
di logica pura devono restare senza database. Il codice applicativo usa invece sempre la facciata.

**Interfaces:**
- Consumes: `addDays`, `ROME_TZ` da `@/lib/time`; `prisma` da `@/lib/db`
- Produces: da `@/modules/codes`:
  - `type ShiftKind = 'work' | 'absence' | 'info' | 'unknown'`
  - `interface ShiftCodeDef { code: string; label: string; kind: ShiftKind; startTime: string | null; endTime: string | null; crossesMidnight: boolean; location: string | null; color: string | null; needsReview: boolean }`
  - `type CalendarSlot = { type: 'timed'; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } } | { type: 'allDay'; start: { date: string }; end: { date: string } } | { type: 'none' }`
  - `compactCode(raw: string): string`
  - `matchCode(raw: string, defs: ShiftCodeDef[]): ShiftCodeDef | null`
  - `toCalendarSlot(def: ShiftCodeDef, isoDate: string): CalendarSlot`
  - `DEFAULT_SHIFT_CODES: ShiftCodeDef[]`
  - `listShiftCodes(): Promise<ShiftCodeDef[]>`, `upsertShiftCode(def: ShiftCodeDef): Promise<ShiftCodeDef>`, `deleteShiftCode(code: string): Promise<void>`

- [ ] **Step 1: Scrivere i test di normalizzazione (falliscono)**

Crea `tests/modules/codes/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compactCode, matchCode } from '@/modules/codes/normalize'
import type { ShiftCodeDef } from '@/modules/codes/types'

const def = (code: string): ShiftCodeDef => ({
  code,
  label: code,
  kind: 'work',
  startTime: '07:00',
  endTime: '14:00',
  crossesMidnight: false,
  location: null,
  color: null,
  needsReview: false,
})

const defs = [def('M'), def('P'), def('M/P'), def('M RSF'), def('M1°P')]

describe('compactCode', () => {
  it('porta in maiuscolo e rimuove gli spazi', () => {
    expect(compactCode(' m rsf ')).toBe('MRSF')
  })

  it('normalizza il simbolo di grado scritto come ordinale', () => {
    expect(compactCode('m1ºp')).toBe('M1°P')
  })
})

describe('matchCode', () => {
  it('trova il codice esatto', () => {
    expect(matchCode('M', defs)?.code).toBe('M')
  })

  it('ignora spazi e maiuscole', () => {
    expect(matchCode('m 1°p', defs)?.code).toBe('M1°P')
    expect(matchCode('MRSF', defs)?.code).toBe('M RSF')
  })

  it('non confonde M/P con M', () => {
    expect(matchCode('M/P', defs)?.code).toBe('M/P')
  })

  it('restituisce null per un codice sconosciuto', () => {
    expect(matchCode('XYZ', defs)).toBeNull()
  })

  it('restituisce null per una cella vuota', () => {
    expect(matchCode('   ', defs)).toBeNull()
  })
})
```

- [ ] **Step 2: Scrivere i test degli intervalli (falliscono)**

Crea `tests/modules/codes/slot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SHIFT_CODES } from '@/modules/codes/defaults'
import { matchCode } from '@/modules/codes/normalize'
import { toCalendarSlot } from '@/modules/codes/slot'
import { ROME_TZ } from '@/lib/time'

function slotFor(code: string, isoDate: string) {
  const def = matchCode(code, DEFAULT_SHIFT_CODES)
  if (!def) throw new Error(`codice non trovato nei default: ${code}`)
  return toCalendarSlot(def, isoDate)
}

describe('toCalendarSlot', () => {
  it('il mattino è 07:00-14:00 nello stesso giorno', () => {
    expect(slotFor('M', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T07:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-03T14:00:00', timeZone: ROME_TZ },
    })
  })

  it('il pomeriggio è 14:00-21:00', () => {
    expect(slotFor('P', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T14:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-03T21:00:00', timeZone: ROME_TZ },
    })
  })

  it('la giornata lunga M/P è un unico evento 07:00-21:00', () => {
    expect(slotFor('M/P', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T07:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-03T21:00:00', timeZone: ROME_TZ },
    })
  })

  it('la notte finisce il giorno dopo', () => {
    expect(slotFor('NOTTE', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T21:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-04T07:00:00', timeZone: ROME_TZ },
    })
  })

  it('la notte dell ultimo giorno del mese finisce nel mese dopo', () => {
    expect(slotFor('NOTTE', '2026-08-31').end).toEqual({
      dateTime: '2026-09-01T07:00:00',
      timeZone: ROME_TZ,
    })
  })

  it('riposo e smonto notte sono eventi tutto il giorno', () => {
    for (const code of ['RP', 'RIP', 'SN']) {
      expect(slotFor(code, '2026-08-03')).toEqual({
        type: 'allDay',
        start: { date: '2026-08-03' },
        end: { date: '2026-08-04' },
      })
    }
  })

  it('ferie e assenza sono eventi tutto il giorno', () => {
    for (const code of ['F', 'ASS']) {
      expect(slotFor(code, '2026-08-03').type).toBe('allDay')
    }
  })

  it('un codice di tipo unknown non produce nessun evento', () => {
    expect(
      toCalendarSlot(
        {
          code: '???',
          label: 'Da definire',
          kind: 'unknown',
          startTime: null,
          endTime: null,
          crossesMidnight: false,
          location: null,
          color: null,
          needsReview: true,
        },
        '2026-08-03',
      ),
    ).toEqual({ type: 'none' })
  })

  it('i turni sugli altri piani mantengono gli orari e riportano la sede', () => {
    const def = matchCode('M1°P', DEFAULT_SHIFT_CODES)
    expect(def?.location).toBe('1° Piano')
    expect(slotFor('M1°P', '2026-08-03').type).toBe('timed')
  })
})

describe('DEFAULT_SHIFT_CODES', () => {
  it('copre tutti i codici visti nelle tabelle di esempio', () => {
    const expected = [
      'M', 'P', 'M/P', 'NOTTE', 'SN', 'RP', 'RIP', 'F', 'ASS',
      'M+', 'P+', 'M RSF', 'P RSF',
      'M1°P', 'M2°P', 'M4°P', 'P1°P', 'P2°P', 'P4°P',
    ]
    for (const code of expected) {
      expect(matchCode(code, DEFAULT_SHIFT_CODES), `manca il codice ${code}`).not.toBeNull()
    }
  })

  it('marca needsReview i codici il cui significato non è confermato', () => {
    for (const code of ['M+', 'P+', 'M RSF', 'P RSF']) {
      expect(matchCode(code, DEFAULT_SHIFT_CODES)?.needsReview, code).toBe(true)
    }
  })

  it('non marca needsReview i codici certi', () => {
    for (const code of ['M', 'P', 'NOTTE', 'RP', 'F']) {
      expect(matchCode(code, DEFAULT_SHIFT_CODES)?.needsReview, code).toBe(false)
    }
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npm test tests/modules/codes`
Expected: FAIL — `Failed to resolve import "@/modules/codes"`.

- [ ] **Step 4: Implementare i tipi**

Crea `src/modules/codes/types.ts`:

```ts
export type ShiftKind = 'work' | 'absence' | 'info' | 'unknown'

export interface ShiftCodeDef {
  code: string
  label: string
  kind: ShiftKind
  /** "HH:mm" locale di Europe/Rome; null insieme a endTime per gli eventi tutto il giorno. */
  startTime: string | null
  endTime: string | null
  crossesMidnight: boolean
  location: string | null
  color: string | null
  /** Default incerto: la referente deve confermarlo prima di fidarsene. */
  needsReview: boolean
}

export type CalendarSlot =
  | {
      type: 'timed'
      start: { dateTime: string; timeZone: string }
      end: { dateTime: string; timeZone: string }
    }
  | { type: 'allDay'; start: { date: string }; end: { date: string } }
  | { type: 'none' }
```

- [ ] **Step 5: Implementare normalizzazione e matching**

Crea `src/modules/codes/normalize.ts`:

```ts
import type { ShiftCodeDef } from './types'

/** Forma canonica per il confronto: maiuscolo, senza spazi, con il simbolo di grado uniformato. */
export function compactCode(raw: string): string {
  // 'º' (ordinale) e '°' (grado) sono indistinguibili sulla carta: uniformiamo.
  return raw.toUpperCase().replace(/º/g, '°').replace(/\s+/g, '')
}

export function matchCode(raw: string, defs: ShiftCodeDef[]): ShiftCodeDef | null {
  const key = compactCode(raw)
  if (key === '') return null
  return defs.find((def) => compactCode(def.code) === key) ?? null
}
```

- [ ] **Step 6: Implementare la conversione in intervallo**

Crea `src/modules/codes/slot.ts`:

```ts
import { addDays, ROME_TZ } from '@/lib/time'
import type { CalendarSlot, ShiftCodeDef } from './types'

export function toCalendarSlot(def: ShiftCodeDef, isoDate: string): CalendarSlot {
  if (def.kind === 'unknown') return { type: 'none' }

  if (def.startTime === null || def.endTime === null) {
    // Google tratta la data di fine degli eventi all-day come esclusiva.
    return { type: 'allDay', start: { date: isoDate }, end: { date: addDays(isoDate, 1) } }
  }

  const endDate = def.crossesMidnight ? addDays(isoDate, 1) : isoDate

  return {
    type: 'timed',
    start: { dateTime: `${isoDate}T${def.startTime}:00`, timeZone: ROME_TZ },
    end: { dateTime: `${endDate}T${def.endTime}:00`, timeZone: ROME_TZ },
  }
}
```

- [ ] **Step 7: Implementare la legenda di default**

Crea `src/modules/codes/defaults.ts`:

```ts
import type { ShiftCodeDef } from './types'

function work(
  code: string,
  label: string,
  startTime: string,
  endTime: string,
  extra: Partial<ShiftCodeDef> = {},
): ShiftCodeDef {
  return {
    code,
    label,
    kind: 'work',
    startTime,
    endTime,
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: false,
    ...extra,
  }
}

function allDay(code: string, label: string, kind: 'absence' | 'info'): ShiftCodeDef {
  return {
    code,
    label,
    kind,
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: false,
  }
}

const FLOORS = ['1', '2', '4'] as const

const floorShifts: ShiftCodeDef[] = FLOORS.flatMap((floor) => [
  work(`M${floor}°P`, `Mattino ${floor}° piano`, '07:00', '14:00', { location: `${floor}° Piano` }),
  work(`P${floor}°P`, `Pomeriggio ${floor}° piano`, '14:00', '21:00', { location: `${floor}° Piano` }),
])

/**
 * Legenda iniziale, confermata con la referente il 2026-08-26.
 * needsReview: true dove il significato non è ancora certo — l app lo segnala
 * finché la referente non lo corregge in Impostazioni.
 */
export const DEFAULT_SHIFT_CODES: ShiftCodeDef[] = [
  work('M', 'Mattino', '07:00', '14:00'),
  work('P', 'Pomeriggio', '14:00', '21:00'),
  work('M/P', 'Giornata lunga', '07:00', '21:00'),
  work('NOTTE', 'Notte', '21:00', '07:00', { crossesMidnight: true }),
  allDay('SN', 'Smonto notte', 'info'),
  allDay('RP', 'Riposo programmato', 'info'),
  allDay('RIP', 'Riposo', 'info'),
  allDay('F', 'Ferie', 'absence'),
  allDay('ASS', 'Assenza', 'absence'),
  work('M+', 'Mattino prolungato', '07:00', '14:00', { needsReview: true }),
  work('P+', 'Pomeriggio prolungato', '14:00', '21:00', { needsReview: true }),
  work('M RSF', 'Mattino RSF', '07:00', '14:00', { location: 'RSF', needsReview: true }),
  work('P RSF', 'Pomeriggio RSF', '14:00', '21:00', { location: 'RSF', needsReview: true }),
  ...floorShifts,
]
```

- [ ] **Step 8: Implementare il repository e la facciata del modulo**

Crea `src/modules/codes/repository.ts`:

```ts
import { prisma } from '@/lib/db'
import type { ShiftCodeDef, ShiftKind } from './types'

type Row = {
  code: string
  label: string
  kind: string
  startTime: string | null
  endTime: string | null
  crossesMidnight: boolean
  location: string | null
  color: string | null
  needsReview: boolean
}

const KINDS: ShiftKind[] = ['work', 'absence', 'info', 'unknown']

function toDef(row: Row): ShiftCodeDef {
  const kind = KINDS.includes(row.kind as ShiftKind) ? (row.kind as ShiftKind) : 'unknown'
  return {
    code: row.code,
    label: row.label,
    kind,
    startTime: row.startTime,
    endTime: row.endTime,
    crossesMidnight: row.crossesMidnight,
    location: row.location,
    color: row.color,
    needsReview: row.needsReview,
  }
}

export async function listShiftCodes(): Promise<ShiftCodeDef[]> {
  const rows = await prisma.shiftCode.findMany({ orderBy: { code: 'asc' } })
  return rows.map(toDef)
}

export async function upsertShiftCode(def: ShiftCodeDef): Promise<ShiftCodeDef> {
  const data = {
    label: def.label,
    kind: def.kind,
    startTime: def.startTime,
    endTime: def.endTime,
    crossesMidnight: def.crossesMidnight,
    location: def.location,
    color: def.color,
    needsReview: def.needsReview,
  }
  const row = await prisma.shiftCode.upsert({
    where: { code: def.code },
    create: { code: def.code, ...data },
    update: data,
  })
  return toDef(row)
}

export async function deleteShiftCode(code: string): Promise<void> {
  await prisma.shiftCode.delete({ where: { code } })
}
```

Crea `src/modules/codes/index.ts`:

```ts
export type { CalendarSlot, ShiftCodeDef, ShiftKind } from './types'
export { compactCode, matchCode } from './normalize'
export { toCalendarSlot } from './slot'
export { DEFAULT_SHIFT_CODES } from './defaults'
export { deleteShiftCode, listShiftCodes, upsertShiftCode } from './repository'
```

- [ ] **Step 9: Eseguire i test**

Run: `npm test tests/modules/codes`
Expected: PASS, 19 test (7 di normalizzazione, 12 di intervalli).

- [ ] **Step 10: Scrivere il test del seed (fallisce)**

Crea `tests/modules/codes/seed.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../../helpers/db'
import { DEFAULT_SHIFT_CODES } from '@/modules/codes/defaults'
import { seedShiftCodes } from '../../../prisma/seed'

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient

beforeAll(() => {
  db = createTestDb()
  prisma = db.prisma
})

afterAll(async () => {
  await db.cleanup()
})

describe('seedShiftCodes', () => {
  it('carica tutta la legenda di default', async () => {
    await seedShiftCodes(prisma)
    expect(await prisma.shiftCode.count()).toBe(DEFAULT_SHIFT_CODES.length)
  })

  it('è idempotente e non sovrascrive le modifiche della referente', async () => {
    await seedShiftCodes(prisma)
    await prisma.shiftCode.update({ where: { code: 'M' }, data: { endTime: '13:30' } })

    await seedShiftCodes(prisma)

    const m = await prisma.shiftCode.findUnique({ where: { code: 'M' } })
    expect(m?.endTime).toBe('13:30')
    expect(await prisma.shiftCode.count()).toBe(DEFAULT_SHIFT_CODES.length)
  })
})
```

- [ ] **Step 11: Eseguire il test e verificare che fallisca**

Run: `npm test tests/modules/codes/seed.test.ts`
Expected: FAIL — `Failed to resolve import "../../../prisma/seed"`.

- [ ] **Step 12: Implementare il seed**

Crea `prisma/seed.ts`:

```ts
import { PrismaClient } from '@prisma/client'
import { DEFAULT_SHIFT_CODES } from '../src/modules/codes/defaults'

/**
 * Inserisce i codici mancanti e lascia intatti quelli già presenti:
 * gli orari corretti a mano dalla referente non vengono mai sovrascritti.
 */
export async function seedShiftCodes(prisma: PrismaClient): Promise<number> {
  // createMany({ skipDuplicates: true }) non è supportato su SQLite: si controlla prima.
  let created = 0
  for (const def of DEFAULT_SHIFT_CODES) {
    const existing = await prisma.shiftCode.findUnique({ where: { code: def.code } })
    if (existing) continue

    await prisma.shiftCode.create({
      data: {
        code: def.code,
        label: def.label,
        kind: def.kind,
        startTime: def.startTime,
        endTime: def.endTime,
        crossesMidnight: def.crossesMidnight,
        location: def.location,
        color: def.color,
        needsReview: def.needsReview,
      },
    })
    created += 1
  }
  return created
}

if (process.argv[1]?.endsWith('seed.ts')) {
  const prisma = new PrismaClient()
  seedShiftCodes(prisma)
    .then((created) => console.log(`Codici turno inseriti: ${created}`))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
```

- [ ] **Step 13: Eseguire tutta la suite**

Run: `npm test`
Expected: PASS, 45 test.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: add shift code legend with timezone-aware calendar slots"
```

---

### Task 5: Cifratura dei token a riposo

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `tests/lib/crypto.test.ts`

**Interfaces:**
- Consumes: `requireEnv` da `@/lib/env`
- Produces: da `@/lib/crypto`: `encryptSecret(plaintext: string, context: string): string`, `decryptSecret(payload: string, context: string): string`

**Perché il `context`:** viene autenticato ma non cifrato (AAD di GCM) e lega il payload al record che
lo contiene. Senza, chi riuscisse a scrivere sul database potrebbe spostare il refresh token di
un'infermiera nel record di un'altra e far scrivere il server sul calendario sbagliato. Il Task 6 passa
`google_refresh:<userId>`. Vanno inoltre validate le lunghezze di IV (12 byte) e tag (16 byte) prima di
decifrare: GCM accetta tag più corti, e un tag troncato ridurrebbe l'autenticazione a pochi byte.

- [ ] **Step 1: Scrivere i test che falliscono**

Crea `tests/lib/crypto.test.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '@/lib/crypto'

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('encryptSecret / decryptSecret', () => {
  it('restituisce il testo originale', () => {
    const token = '1//refresh-token-di-google'
    expect(decryptSecret(encryptSecret(token))).toBe(token)
  })

  it('non lascia il testo in chiaro nel payload', () => {
    expect(encryptSecret('segretissimo')).not.toContain('segretissimo')
  })

  it('produce payload diversi per lo stesso testo (IV casuale)', () => {
    expect(encryptSecret('uguale')).not.toBe(encryptSecret('uguale'))
  })

  it('rifiuta un payload manomesso', () => {
    const payload = encryptSecret('integro')
    const parts = payload.split('.')
    const tampered = [parts[0], parts[1], Buffer.from('altro').toString('base64')].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('rifiuta un payload malformato', () => {
    expect(() => decryptSecret('non-un-payload')).toThrowError(/payload/i)
  })

  it('richiede la chiave di cifratura', () => {
    const saved = process.env.APP_ENCRYPTION_KEY
    delete process.env.APP_ENCRYPTION_KEY
    try {
      expect(() => encryptSecret('x')).toThrowError(/APP_ENCRYPTION_KEY/)
    } finally {
      process.env.APP_ENCRYPTION_KEY = saved
    }
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `npm test tests/lib/crypto.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/crypto"`.

- [ ] **Step 3: Implementare `src/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { requireEnv } from './env'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

function key(): Buffer {
  const raw = Buffer.from(requireEnv('APP_ENCRYPTION_KEY'), 'base64')
  if (raw.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY deve essere di 32 byte in base64 (openssl rand -base64 32)')
  }
  return raw
}

/** Formato: iv.ciphertext.authTag, tutti in base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 3) throw new Error('Payload cifrato malformato')

  const [iv, ciphertext, authTag] = parts.map((part) => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv(ALGORITHM, key(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Eseguire i test**

Run: `npm test tests/lib/crypto.test.ts`
Expected: PASS, 6 test (cumulativo: 51).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: encrypt secrets at rest with AES-256-GCM"
```

---

### Task 6: Autenticazione con Google, ruoli e inviti

**Files:**
- Create: `src/modules/auth/policy.ts`, `src/modules/auth/token.ts`, `src/modules/auth/session.ts`, `src/modules/auth/google.ts`, `src/modules/auth/guards.ts`, `src/modules/auth/index.ts`, `src/app/login/page.tsx`, `src/app/api/auth/google/start/route.ts`, `src/app/api/auth/google/callback/route.ts`, `src/app/api/auth/logout/route.ts`
- Test: `tests/modules/auth/policy.test.ts`, `tests/modules/auth/session.test.ts`

**Interfaces:**
- Consumes: `prisma` da `@/lib/db`; `encryptSecret` da `@/lib/crypto`; `requireEnv` da `@/lib/env`
- Produces: da `@/modules/auth`:
  - `type Role = 'REFERENTE' | 'NURSE'`
  - `normalizeEmail(email: string): string`
  - `roleForNewUser(existingUsers: number): Role`
  - `decideRegistration(email: string, ctx: { existingUsers: number; invitedEmails: string[] }): { allowed: true; role: Role } | { allowed: false; reason: 'not_invited' }`
  - da `@/modules/auth/token`: `signSession(userId: string, secret: string, ttlSeconds?: number): Promise<string>`, `verifySession(token: string, secret: string): Promise<{ userId: string } | null>`
  - `openSessionCookie(userId: string): Promise<void>`, `closeSessionCookie(): Promise<void>`, `readSessionCookie(): Promise<{ userId: string } | null>`

**Nota sugli import nei test:** `session.ts` importa `next/headers`, che include `server-only` e
fallisce se caricato fuori dal runtime di Next. Per questo la firma del token vive in `token.ts` senza
dipendenze da Next, e i test importano `@/modules/auth/token` e `@/modules/auth/policy` direttamente.
Il codice applicativo continua a usare la facciata `@/modules/auth`.
  - `buildGoogleAuthUrl(state: string): string`, `exchangeGoogleCode(code: string): Promise<{ email: string; name: string; refreshToken: string | null }>`
  - `getCurrentUser(): Promise<{ id: string; email: string; displayName: string; role: Role } | null>`, `requireUser()`, `requireReferente()`

- [ ] **Step 1: Installare le dipendenze**

```bash
npm install jose google-auth-library
```

- [ ] **Step 2: Scrivere i test della policy (falliscono)**

Crea `tests/modules/auth/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decideRegistration, normalizeEmail, roleForNewUser } from '@/modules/auth/policy'

describe('normalizeEmail', () => {
  it('mette in minuscolo e rimuove gli spazi', () => {
    expect(normalizeEmail('  Anna.Rossi@Gmail.com ')).toBe('anna.rossi@gmail.com')
  })
})

describe('roleForNewUser', () => {
  it('il primo utente è la referente', () => {
    expect(roleForNewUser(0)).toBe('REFERENTE')
  })

  it('gli utenti successivi sono infermiere', () => {
    expect(roleForNewUser(1)).toBe('NURSE')
    expect(roleForNewUser(7)).toBe('NURSE')
  })
})

describe('decideRegistration', () => {
  it('accetta il primo accesso in assoluto come referente, senza invito', () => {
    expect(decideRegistration('anna@example.com', { existingUsers: 0, invitedEmails: [] })).toEqual({
      allowed: true,
      role: 'REFERENTE',
    })
  })

  it('rifiuta chi non è stata invitata quando esiste già un utente', () => {
    expect(
      decideRegistration('sconosciuta@example.com', { existingUsers: 1, invitedEmails: [] }),
    ).toEqual({ allowed: false, reason: 'not_invited' })
  })

  it('accetta chi è nella lista inviti come infermiera', () => {
    expect(
      decideRegistration('mery@example.com', {
        existingUsers: 1,
        invitedEmails: ['mery@example.com'],
      }),
    ).toEqual({ allowed: true, role: 'NURSE' })
  })

  it('confronta le email ignorando maiuscole e spazi', () => {
    expect(
      decideRegistration(' Mery@Example.com ', {
        existingUsers: 1,
        invitedEmails: ['mery@example.com'],
      }),
    ).toEqual({ allowed: true, role: 'NURSE' })
  })
})
```

- [ ] **Step 3: Scrivere i test della sessione (falliscono)**

Crea `tests/modules/auth/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { signSession, verifySession } from '@/modules/auth/token'

const SECRET = 'segreto-di-test-abbastanza-lungo-32+'

describe('signSession / verifySession', () => {
  it('restituisce l id utente firmato', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(token, SECRET)).toEqual({ userId: 'user-123' })
  })

  it('rifiuta un token firmato con un altro segreto', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(token, 'un-altro-segreto-abbastanza-lungo')).toBeNull()
  })

  it('rifiuta un token manomesso', async () => {
    const token = await signSession('user-123', SECRET)
    expect(await verifySession(`${token}x`, SECRET)).toBeNull()
  })

  it('rifiuta un token scaduto', async () => {
    const token = await signSession('user-123', SECRET, -60)
    expect(await verifySession(token, SECRET)).toBeNull()
  })

  it('rifiuta una stringa che non è un token', async () => {
    expect(await verifySession('qualsiasi-cosa', SECRET)).toBeNull()
  })
})
```

- [ ] **Step 4: Eseguire i test e verificare che falliscano**

Run: `npm test tests/modules/auth`
Expected: FAIL — `Failed to resolve import "@/modules/auth"`.

- [ ] **Step 5: Implementare la policy**

Crea `src/modules/auth/policy.ts`:

```ts
export type Role = 'REFERENTE' | 'NURSE'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function roleForNewUser(existingUsers: number): Role {
  return existingUsers === 0 ? 'REFERENTE' : 'NURSE'
}

export type RegistrationDecision =
  | { allowed: true; role: Role }
  | { allowed: false; reason: 'not_invited' }

/**
 * Il primo accesso in assoluto crea la referente. Dopo di quello serve un invito:
 * senza questo controllo qualunque account Google potrebbe entrare nell app.
 */
export function decideRegistration(
  email: string,
  ctx: { existingUsers: number; invitedEmails: string[] },
): RegistrationDecision {
  if (ctx.existingUsers === 0) return { allowed: true, role: 'REFERENTE' }

  const normalized = normalizeEmail(email)
  const invited = ctx.invitedEmails.some((candidate) => normalizeEmail(candidate) === normalized)

  return invited ? { allowed: true, role: 'NURSE' } : { allowed: false, reason: 'not_invited' }
}
```

- [ ] **Step 6: Implementare il token e il cookie di sessione**

Crea `src/modules/auth/token.ts` (nessun import da Next: deve restare testabile in Node puro):

```ts
import { jwtVerify, SignJWT } from 'jose'

export const SESSION_COOKIE = 'turni_session'
export const OAUTH_STATE_COOKIE = 'turni_oauth_state'
export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30

function keyFrom(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signSession(
  userId: string,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(keyFrom(secret))
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret))
    return typeof payload.sub === 'string' ? { userId: payload.sub } : null
  } catch {
    return null
  }
}

```

Crea `src/modules/auth/session.ts`:

```ts
import { cookies } from 'next/headers'
import { requireEnv } from '@/lib/env'
import { DEFAULT_TTL_SECONDS, SESSION_COOKIE, signSession, verifySession } from './token'

export async function openSessionCookie(userId: string): Promise<void> {
  const token = await signSession(userId, requireEnv('SESSION_SECRET'))
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEFAULT_TTL_SECONDS,
  })
}

export async function closeSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function readSessionCookie(): Promise<{ userId: string } | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  return token ? verifySession(token, requireEnv('SESSION_SECRET')) : null
}
```

- [ ] **Step 7: Implementare il client Google**

Crea `src/modules/auth/google.ts`:

```ts
import { OAuth2Client } from 'google-auth-library'
import { requireEnv } from '@/lib/env'

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
]

export function googleClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirectUri: `${requireEnv('APP_URL')}/api/auth/google/callback`,
  })
}

export function buildGoogleAuthUrl(state: string): string {
  return googleClient().generateAuthUrl({
    access_type: 'offline', // necessario per ottenere il refresh token
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  })
}

export async function exchangeGoogleCode(
  code: string,
): Promise<{ email: string; name: string; refreshToken: string | null }> {
  const client = googleClient()
  const { tokens } = await client.getToken(code)
  if (!tokens.id_token) throw new Error('Google non ha restituito un id_token')

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: requireEnv('GOOGLE_CLIENT_ID'),
  })
  const payload = ticket.getPayload()
  if (!payload?.email) throw new Error('Google non ha restituito un indirizzo email')

  return {
    email: payload.email,
    name: payload.name ?? payload.email,
    refreshToken: tokens.refresh_token ?? null,
  }
}
```

- [ ] **Step 8: Implementare i guard**

Crea `src/modules/auth/guards.ts`:

```ts
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { readSessionCookie } from './session'
import type { Role } from './policy'

export interface CurrentUser {
  id: string
  email: string
  displayName: string
  role: Role
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await readSessionCookie()
  if (!session) return null

  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user) return null

  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role as Role }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function requireReferente(): Promise<CurrentUser> {
  const user = await requireUser()
  if (user.role !== 'REFERENTE') redirect('/')
  return user
}
```

Crea `src/modules/auth/index.ts`:

```ts
export type { Role, RegistrationDecision } from './policy'
export { decideRegistration, normalizeEmail, roleForNewUser } from './policy'
export {
  DEFAULT_TTL_SECONDS,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  signSession,
  verifySession,
} from './token'
export { closeSessionCookie, openSessionCookie, readSessionCookie } from './session'
export { GOOGLE_SCOPES, buildGoogleAuthUrl, exchangeGoogleCode } from './google'
export type { CurrentUser } from './guards'
export { getCurrentUser, requireReferente, requireUser } from './guards'
```

- [ ] **Step 9: Eseguire i test**

Run: `npm test tests/modules/auth`
Expected: PASS, 12 test (7 di policy, 5 di token).

- [ ] **Step 10: Implementare le route OAuth**

Crea `src/app/api/auth/google/start/route.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { buildGoogleAuthUrl, OAUTH_STATE_COOKIE } from '@/modules/auth'

export async function GET() {
  const state = randomBytes(16).toString('hex')

  const store = await cookies()
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(buildGoogleAuthUrl(state))
}
```

Crea `src/app/api/auth/google/callback/route.ts`:

```ts
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encryptSecret } from '@/lib/crypto'
import { requireEnv } from '@/lib/env'
import {
  decideRegistration,
  exchangeGoogleCode,
  normalizeEmail,
  OAUTH_STATE_COOKIE,
  openSessionCookie,
} from '@/modules/auth'

function loginError(reason: string) {
  return NextResponse.redirect(`${requireEnv('APP_URL')}/login?error=${reason}`)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  const store = await cookies()
  const expectedState = store.get(OAUTH_STATE_COOKIE)?.value
  store.delete(OAUTH_STATE_COOKIE)

  // Lo state protegge dal CSRF sul callback: senza confronto, un attaccante
  // potrebbe far completare a un utente un login che non ha iniziato.
  if (!code || !state || state !== expectedState) return loginError('state')

  const profile = await exchangeGoogleCode(code)
  const email = normalizeEmail(profile.email)

  const existing = await prisma.user.findUnique({ where: { email } })

  if (!existing) {
    const [existingUsers, invites] = await Promise.all([
      prisma.user.count(),
      prisma.invite.findMany({ where: { usedAt: null } }),
    ])

    const decision = decideRegistration(email, {
      existingUsers,
      invitedEmails: invites.map((invite) => invite.email),
    })

    if (!decision.allowed) return loginError('not_invited')

    const created = await prisma.user.create({
      data: { email, displayName: profile.name, role: decision.role },
    })
    await prisma.invite.updateMany({ where: { email }, data: { usedAt: new Date() } })
    await openSessionCookie(created.id)
  } else {
    await openSessionCookie(existing.id)
  }

  const user = existing ?? (await prisma.user.findUniqueOrThrow({ where: { email } }))

  // Google restituisce il refresh token solo al primo consenso: se manca,
  // conserviamo quello già salvato invece di sovrascriverlo con null.
  if (profile.refreshToken) {
    await prisma.googleAccount.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        refreshToken: encryptSecret(profile.refreshToken, `google_refresh:${user.id}`),
        status: 'ok',
      },
      update: {
        refreshToken: encryptSecret(profile.refreshToken, `google_refresh:${user.id}`),
        status: 'ok',
      },
    })
  }

  return NextResponse.redirect(requireEnv('APP_URL'))
}
```

Crea `src/app/api/auth/logout/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireEnv } from '@/lib/env'
import { closeSessionCookie } from '@/modules/auth'

export async function POST() {
  await closeSessionCookie()
  return NextResponse.redirect(`${requireEnv('APP_URL')}/login`)
}
```

- [ ] **Step 11: Creare la pagina di accesso**

Crea `src/app/login/page.tsx`:

```tsx
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  const messages: Record<string, string> = {
    state: 'Sessione di accesso scaduta. Riprova.',
    not_invited: 'Questo indirizzo non è stato invitato. Chiedi alla referente di aggiungerti.',
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Turni</h1>
      <p className="text-sm text-gray-600">
        Accedi con l&apos;account Google su cui vuoi ricevere i turni.
      </p>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messages[error] ?? 'Accesso non riuscito.'}
        </p>
      )}

      <a
        href="/api/auth/google/start"
        className="rounded-md bg-black px-4 py-2 text-center text-white"
      >
        Accedi con Google
      </a>
    </main>
  )
}
```

- [ ] **Step 12: Verifica manuale del flusso**

Configura `.env` con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL=http://localhost:3000`, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `DATABASE_URL`. Su Google Cloud aggiungi il redirect `http://localhost:3000/api/auth/google/callback`.

Run: `npm run dev`, apri `http://localhost:3000/login`, accedi.
Expected: primo accesso → utente creato con ruolo `REFERENTE`, cookie `turni_session` presente, redirect alla home. Verifica con `npx prisma studio` che `GoogleAccount.refreshToken` **non** sia in chiaro.

- [ ] **Step 13: Eseguire tutta la suite e il lint**

Run: `npm test && npm run lint`
Expected: PASS, 63 test; nessun errore di tipo.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: add Google login with roles and invite allowlist"
```

---

### Task 7: Impostazioni — legenda turni e inviti

**Files:**
- Create: `src/modules/codes/form.ts`, `src/app/settings/codes/page.tsx`, `src/app/settings/codes/actions.ts`, `src/app/settings/users/page.tsx`, `src/app/settings/users/actions.ts`, `src/app/page.tsx` (sostituisce quella generata)
- Modify: `src/modules/codes/index.ts`
- Test: `tests/modules/codes/form.test.ts`

**Interfaces:**
- Consumes: `listShiftCodes`, `upsertShiftCode`, `deleteShiftCode`, `DEFAULT_SHIFT_CODES` da `@/modules/codes`; `requireReferente`, `normalizeEmail` da `@/modules/auth`
- Produces: `parseShiftCodeForm(form: FormData): { ok: true; value: ShiftCodeDef } | { ok: false; errors: string[] }` da `@/modules/codes/form`

**Perché la validazione sta nel modulo e non nella action:** un file marcato `'use server'` può
esportare soltanto funzioni asincrone, quindi una funzione pura e sincrona come `parseShiftCodeForm`
non può vivere lì. Tenerla in `src/modules/codes/form.ts` la rende anche testabile senza Next.

- [ ] **Step 1: Installare shadcn/ui**

```bash
npx shadcn@latest init --yes --defaults
npx shadcn@latest add button input table select checkbox card badge
```

- [ ] **Step 2: Scrivere i test della validazione del form (falliscono)**

Crea `tests/modules/codes/form.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseShiftCodeForm } from '@/modules/codes/form'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

describe('parseShiftCodeForm', () => {
  it('accetta un turno con orari validi', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' }),
    )
    expect(result).toEqual({
      ok: true,
      value: {
        code: 'M',
        label: 'Mattino',
        kind: 'work',
        startTime: '07:00',
        endTime: '14:00',
        crossesMidnight: false,
        location: null,
        color: null,
        needsReview: false,
      },
    })
  })

  it('deduce crossesMidnight quando la fine precede l inizio', () => {
    const result = parseShiftCodeForm(
      form({ code: 'NOTTE', label: 'Notte', kind: 'work', startTime: '21:00', endTime: '07:00' }),
    )
    expect(result.ok && result.value.crossesMidnight).toBe(true)
  })

  it('accetta un turno tutto il giorno senza orari', () => {
    const result = parseShiftCodeForm(form({ code: 'RP', label: 'Riposo', kind: 'info' }))
    expect(result.ok && result.value.startTime).toBeNull()
  })

  it('rifiuta un codice vuoto', () => {
    const result = parseShiftCodeForm(form({ code: '  ', label: 'X', kind: 'work' }))
    expect(result).toEqual({ ok: false, errors: ['Il codice è obbligatorio'] })
  })

  it('rifiuta un orario malformato', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M', label: 'Mattino', kind: 'work', startTime: '7', endTime: '14:00' }),
    )
    expect(result.ok).toBe(false)
  })

  it('rifiuta un turno di lavoro con un solo orario', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00' }),
    )
    expect(result).toEqual({
      ok: false,
      errors: ['Indica entrambi gli orari, o nessuno per un evento tutto il giorno'],
    })
  })

  it('rifiuta un tipo non previsto', () => {
    const result = parseShiftCodeForm(form({ code: 'M', label: 'Mattino', kind: 'inventato' }))
    expect(result.ok).toBe(false)
  })

  it('azzera needsReview quando la referente salva il codice', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M+', label: 'Mattino lungo', kind: 'work', startTime: '07:00', endTime: '15:00' }),
    )
    expect(result.ok && result.value.needsReview).toBe(false)
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `npm test tests/modules/codes/form.test.ts`
Expected: FAIL — modulo `@/modules/codes/form` inesistente.

- [ ] **Step 4: Implementare la validazione del form**

Crea `src/modules/codes/form.ts`:

```ts
import type { ShiftCodeDef, ShiftKind } from './types'

const KINDS: ShiftKind[] = ['work', 'absence', 'info', 'unknown']
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export type ParseResult =
  | { ok: true; value: ShiftCodeDef }
  | { ok: false; errors: string[] }

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

/** Validazione pura: nessuna dipendenza da Next o dal database. */
export function parseShiftCodeForm(form: FormData): ParseResult {
  const errors: string[] = []

  const code = text(form, 'code')
  const label = text(form, 'label')
  const kind = text(form, 'kind')
  const startTime = text(form, 'startTime')
  const endTime = text(form, 'endTime')
  const location = text(form, 'location')
  const color = text(form, 'color')

  if (code === '') errors.push('Il codice è obbligatorio')
  if (label === '') errors.push('L etichetta è obbligatoria')
  if (!KINDS.includes(kind as ShiftKind)) errors.push('Tipo di turno non valido')

  const hasStart = startTime !== ''
  const hasEnd = endTime !== ''

  if (hasStart !== hasEnd) {
    errors.push('Indica entrambi gli orari, o nessuno per un evento tutto il giorno')
  }
  if (hasStart && !TIME_PATTERN.test(startTime)) errors.push('Orario di inizio non valido (HH:mm)')
  if (hasEnd && !TIME_PATTERN.test(endTime)) errors.push('Orario di fine non valido (HH:mm)')

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      code,
      label,
      kind: kind as ShiftKind,
      startTime: hasStart ? startTime : null,
      endTime: hasEnd ? endTime : null,
      // Una fine che precede l inizio significa che il turno scavalca la mezzanotte.
      crossesMidnight: hasStart && hasEnd ? endTime <= startTime : false,
      location: location === '' ? null : location,
      color: color === '' ? null : color,
      // Salvare dalle impostazioni è la conferma della referente: l avviso sparisce.
      needsReview: false,
    },
  }
}
```

Aggiungi l'export alla facciata del modulo, in `src/modules/codes/index.ts`:

```ts
export type { ParseResult } from './form'
export { parseShiftCodeForm } from './form'
```

Crea `src/app/settings/codes/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { deleteShiftCode, parseShiftCodeForm, upsertShiftCode } from '@/modules/codes'
import { requireReferente } from '@/modules/auth'

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

export async function saveShiftCode(form: FormData): Promise<{ errors: string[] }> {
  await requireReferente()

  const parsed = parseShiftCodeForm(form)
  if (!parsed.ok) return { errors: parsed.errors }

  await upsertShiftCode(parsed.value)
  revalidatePath('/settings/codes')
  return { errors: [] }
}

export async function removeShiftCode(form: FormData): Promise<void> {
  await requireReferente()
  const code = text(form, 'code')
  if (code !== '') {
    await deleteShiftCode(code)
    revalidatePath('/settings/codes')
  }
}
```

- [ ] **Step 5: Eseguire i test**

Run: `npm test tests/modules/codes/form.test.ts`
Expected: PASS, 8 test.

- [ ] **Step 6: Implementare la pagina della legenda**

Crea `src/app/settings/codes/page.tsx`:

```tsx
import { listShiftCodes } from '@/modules/codes'
import { requireReferente } from '@/modules/auth'
import { removeShiftCode, saveShiftCode } from './actions'

export default async function ShiftCodesPage() {
  await requireReferente()
  const codes = await listShiftCodes()

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Codici turno</h1>
        <p className="text-sm text-gray-600">
          Gli orari qui impostati determinano gli eventi creati sul calendario. Lascia gli orari vuoti
          per un evento che dura tutto il giorno.
        </p>
      </header>

      <table className="w-full text-sm">
        <thead className="text-left">
          <tr>
            <th className="p-2">Codice</th>
            <th className="p-2">Etichetta</th>
            <th className="p-2">Tipo</th>
            <th className="p-2">Orario</th>
            <th className="p-2">Sede</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.code} className="border-t">
              <td className="p-2 font-mono">
                {code.code}
                {code.needsReview && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    da confermare
                  </span>
                )}
              </td>
              <td className="p-2">{code.label}</td>
              <td className="p-2">{code.kind}</td>
              <td className="p-2">
                {code.startTime && code.endTime
                  ? `${code.startTime}–${code.endTime}${code.crossesMidnight ? ' (+1g)' : ''}`
                  : 'tutto il giorno'}
              </td>
              <td className="p-2">{code.location ?? '—'}</td>
              <td className="p-2 text-right">
                <form action={removeShiftCode}>
                  <input type="hidden" name="code" value={code.code} />
                  <button type="submit" className="text-red-600 hover:underline">
                    Elimina
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">Aggiungi o modifica un codice</h2>
        <form action={saveShiftCode} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <input name="code" placeholder="Codice (es. M)" required className="rounded border p-2" />
          <input name="label" placeholder="Etichetta" required className="rounded border p-2" />
          <select name="kind" defaultValue="work" className="rounded border p-2">
            <option value="work">Turno di lavoro</option>
            <option value="absence">Assenza</option>
            <option value="info">Informativo</option>
            <option value="unknown">Da definire</option>
          </select>
          <input name="startTime" placeholder="Inizio (07:00)" className="rounded border p-2" />
          <input name="endTime" placeholder="Fine (14:00)" className="rounded border p-2" />
          <input name="location" placeholder="Sede (opzionale)" className="rounded border p-2" />
          <button type="submit" className="col-span-2 rounded bg-black p-2 text-white sm:col-span-3">
            Salva
          </button>
        </form>
      </section>
    </main>
  )
}
```

- [ ] **Step 7: Implementare la pagina degli inviti**

Crea `src/app/settings/users/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { normalizeEmail, requireReferente } from '@/modules/auth'

export async function inviteUser(form: FormData): Promise<{ errors: string[] }> {
  const referente = await requireReferente()

  const raw = form.get('email')
  const email = typeof raw === 'string' ? normalizeEmail(raw) : ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { errors: ['Indirizzo email non valido'] }
  }

  await prisma.invite.upsert({
    where: { email },
    create: { email, invitedBy: referente.email },
    update: {},
  })
  revalidatePath('/settings/users')
  return { errors: [] }
}

export async function revokeInvite(form: FormData): Promise<void> {
  await requireReferente()
  const raw = form.get('email')
  if (typeof raw === 'string' && raw !== '') {
    await prisma.invite.deleteMany({ where: { email: normalizeEmail(raw) } })
    revalidatePath('/settings/users')
  }
}
```

Crea `src/app/settings/users/page.tsx`:

```tsx
import { prisma } from '@/lib/db'
import { requireReferente } from '@/modules/auth'
import { inviteUser, revokeInvite } from './actions'

export default async function UsersPage() {
  await requireReferente()

  const [users, invites] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.invite.findMany({ where: { usedAt: null }, orderBy: { createdAt: 'asc' } }),
  ])

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Utenti</h1>

      <section className="space-y-2">
        <h2 className="font-medium">Registrate</h2>
        <ul className="text-sm">
          {users.map((user) => (
            <li key={user.id} className="flex justify-between border-b py-2">
              <span>
                {user.displayName} <span className="text-gray-500">({user.email})</span>
              </span>
              <span className="text-gray-500">{user.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Inviti in attesa</h2>
        <ul className="text-sm">
          {invites.map((invite) => (
            <li key={invite.email} className="flex justify-between border-b py-2">
              <span>{invite.email}</span>
              <form action={revokeInvite}>
                <input type="hidden" name="email" value={invite.email} />
                <button type="submit" className="text-red-600 hover:underline">
                  Revoca
                </button>
              </form>
            </li>
          ))}
          {invites.length === 0 && <li className="py-2 text-gray-500">Nessun invito in attesa.</li>}
        </ul>

        <form action={inviteUser} className="flex gap-2">
          <input
            name="email"
            type="email"
            required
            placeholder="email della collega"
            className="flex-1 rounded border p-2"
          />
          <button type="submit" className="rounded bg-black px-4 text-white">
            Invita
          </button>
        </form>
      </section>
    </main>
  )
}
```

- [ ] **Step 8: Sostituire la home generata**

Sovrascrivi `src/app/page.tsx`:

```tsx
import Link from 'next/link'
import { requireUser } from '@/modules/auth'

export default async function HomePage() {
  const user = await requireUser()

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Ciao {user.displayName}</h1>
      <p className="text-sm text-gray-600">
        Il caricamento delle tabelle turni arriva nella prossima fase.
      </p>

      {user.role === 'REFERENTE' && (
        <nav className="flex gap-4 text-sm">
          <Link href="/settings/codes" className="underline">
            Codici turno
          </Link>
          <Link href="/settings/users" className="underline">
            Utenti
          </Link>
        </nav>
      )}

      <form action="/api/auth/logout" method="post">
        <button type="submit" className="text-sm text-gray-600 underline">
          Esci
        </button>
      </form>
    </main>
  )
}
```

- [ ] **Step 9: Verifica manuale**

Run: `npm run db:seed && npm run dev`
Expected: da referente, `/settings/codes` elenca i 19 codici con il badge "da confermare" su `M+`, `P+`, `M RSF`, `P RSF`; modificando l'orario di `M` il badge sparisce e il valore persiste. Accedendo come utente `NURSE`, `/settings/codes` reindirizza alla home.

- [ ] **Step 10: Eseguire tutta la suite e il lint**

Run: `npm test && npm run lint`
Expected: PASS, 73 test; nessun errore di tipo.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add settings pages for shift codes and invites"
```

---

### Task 8: Docker, compose e deploy su ZimaBoard

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker/entrypoint.sh`, `src/app/api/health/route.ts`
- Modify: `next.config.ts`
- Test: `tests/app/health.test.ts`

**Interfaces:**
- Consumes: `prisma` da `@/lib/db`
- Produces: `GET /api/health` → `{ status: 'ok' | 'degraded', database: boolean }`; immagine Docker con migrazioni e seed automatici all'avvio

- [ ] **Step 1: Scrivere il test dell'healthcheck (fallisce)**

Crea `tests/app/health.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: vi.fn() },
}))

const { prisma } = await import('@/lib/db')
const { GET } = await import('@/app/api/health/route')

describe('GET /api/health', () => {
  it('risponde ok quando il database risponde', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: true })
  })

  it('risponde degraded con codice 503 quando il database non risponde', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('database chiuso'))

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'degraded', database: false })
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npm test tests/app/health.test.ts`
Expected: FAIL — modulo `@/app/api/health/route` inesistente.

- [ ] **Step 3: Implementare l'healthcheck**

Crea `src/app/api/health/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', database: true })
  } catch {
    return NextResponse.json({ status: 'degraded', database: false }, { status: 503 })
  }
}
```

- [ ] **Step 4: Eseguire il test**

Run: `npm test tests/app/health.test.ts`
Expected: PASS, 2 test.

- [ ] **Step 5: Abilitare l'output standalone**

Modifica `next.config.ts`:

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Necessario per l immagine Docker: Next copia solo il runtime che serve.
  output: 'standalone',
}

export default nextConfig
```

- [ ] **Step 6: Scrivere il Dockerfile**

Crea `.dockerignore`:

```
node_modules
.next
.git
data
docs
fixtures
*.log
.env
.env.*
prisma/seed.js
```

Crea `Dockerfile`:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
# openssl serve ai binari di Prisma su musl
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Il seed viene compilato qui: nel runner non ci sono tsx e le sue dipendenze.
RUN npx prisma generate \
 && npm run build \
 && ./node_modules/.bin/esbuild prisma/seed.ts --bundle --platform=node --target=node22 \
      --external:@prisma/client --outfile=prisma/seed.js

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 TZ=Europe/Rome

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# migrate deploy e seed girano all avvio: servono schema, migrazioni e CLI
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/prisma/seed.js ./prisma/seed.js
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
```

Crea `docker/entrypoint.sh`:

```sh
#!/bin/sh
set -e

# node_modules/.bin non viene copiato nell immagine: invochiamo gli entry point diretti.
echo "Applico le migrazioni..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "Carico i codici turno mancanti..."
node prisma/seed.js

exec "$@"
```

- [ ] **Step 7: Scrivere il compose**

Crea `docker-compose.yml`:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      DATABASE_URL: file:/data/turni.db
      APP_URL: ${APP_URL}
      APP_ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY}
      SESSION_SECRET: ${SESSION_SECRET}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      AI_PROVIDER: ${AI_PROVIDER:-groq}
      GROQ_API_KEY: ${GROQ_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      IMAGE_RETENTION_DAYS: ${IMAGE_RETENTION_DAYS:-90}
      TZ: Europe/Rome
    volumes:
      - turni-data:/data
    healthcheck:
      test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      app:
        condition: service_healthy

volumes:
  turni-data:
```

Nel pannello Cloudflare Zero Trust il tunnel va configurato con il servizio pubblico → `http://app:3000`.

- [ ] **Step 8: Verificare la build dell'immagine**

Run:

```bash
docker compose build
docker compose up -d
docker compose ps
curl -s localhost:3000/api/health
```

Expected: `{"status":"ok","database":true}` e container `app` in stato `healthy`. Se `prisma migrate deploy` fallisce con un errore sui binari, controlla che `binaryTargets` nello schema includa `linux-musl-openssl-3.0.x`. Se il seed non parte, verifica che `prisma/seed.js` sia stato prodotto dallo stage di build (`docker compose build --progress plain` mostra il comando esbuild).

- [ ] **Step 9: Verificare la persistenza dopo un restart**

Run:

```bash
docker compose restart app
curl -s localhost:3000/api/health
```

Expected: ancora `ok`, e i codici turno modificati a mano sono ancora quelli modificati (il seed è idempotente, non sovrascrive).

- [ ] **Step 10: Eseguire tutta la suite e il lint**

Run: `npm test && npm run lint`
Expected: PASS, 71 test; nessun errore di tipo.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: containerize app with migrations, seed and healthcheck"
```

---

## Definizione di completamento della Fase 1

- [ ] `npm test` verde con 73 test; `npm run lint` senza errori
- [ ] `docker compose up -d` porta l'app in stato `healthy` sulla ZimaBoard
- [ ] Il primo accesso Google crea la referente; un'email non invitata viene respinta con un messaggio comprensibile
- [ ] `GoogleAccount.refreshToken` è cifrato sul database (verificato con `prisma studio`)
- [ ] La referente modifica l'orario di un codice turno e il valore sopravvive a un restart
- [ ] Un utente `NURSE` non raggiunge `/settings/*`
- [ ] La notte del 25 ottobre 2026 risulta di 11 ore nei test di `src/lib/time.ts`

## Fasi successive (piani separati)

Ognuna produce software funzionante e avrà il proprio documento di piano:

2. **Ingest ed estrazione** — upload foto, `VisionProvider` Groq, schema Zod, golden test sulle fixture
3. **Review** — griglia di conferma, mapping colonne → utenti, gestione codici sconosciuti
4. **Sync Google Calendar** — calendario dedicato, motore di diff idempotente su `shiftKey`
5. **Versioning** — re-upload, diff tra versioni, riconferma parziale
6. **Rifinitura UI** — è la fase in cui shadcn/ui e le animazioni ripagano l'investimento
