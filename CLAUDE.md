# CLAUDE.md

Istruzioni per Claude Code su questo repository.

> **Stato: Fase 2A-bis (estrazione a bande) completata.** Oltre alle fondamenta della Fase 1
> (Next.js, Prisma/SQLite, legenda dei codici turno, cifratura dei token, login Google, pagine di
> impostazioni, Docker), sono implementati l'ingestione delle foto con rilevamento della griglia,
> raddrizzamento e taglio in bande verticali (`ingest`), l'estrazione AI banda per banda con
> provider Groq/Anthropic, schema di validazione e fusione (`extract`), e la persistenza della
> tabella estratta (`roster`). **Non** sono ancora implementati la Fase 2B, la griglia di conferma
> (Fase 3), il sync con Google Calendar (Fase 4) e la rifinitura UI (Fase 6): ognuna avrà il suo
> piano in `docs/superpowers/plans/`.
>
> **La misura reale dell'estrazione a bande dà 486/488 celle corrette (99,6%)**: agosto 246/248,
> settembre 240/240. Zero celle mancanti (erano 199), zero bande fallite su 24, zero conflitti di
> fusione. La strategia precedente — l'intera tabella in una sola chiamata — dava 46/248 (18,5%).
> Il rapporto della misura è in
> `.superpowers/sdd/2026-08-26-fase-2a-bis-ritagli/task-8-report.md`.
>
> Le due celle sbagliate sono **entrambe** nella zona di agosto riscritta a penna sopra il
> correttore, e **una delle due cade sulla cella che la fixture stessa dichiara meno certa**
> (`COSTANZA` giorni 10, 12, 13, scritti a mano in corsivo): non è detto che il torto sia del
> modello.
>
> Due verifiche in sospeso: il flusso OAuth non è mai stato eseguito con credenziali Google reali —
> in tutti i test `exchangeGoogleCode` è mockata, la checklist è in
> [docs/verifica-manuale-oauth.md](docs/verifica-manuale-oauth.md) — e le trascrizioni di
> riferimento in `fixtures/` portano ancora `"verified": false`: le percentuali qui sopra valgono
> quanto la trascrizione, che nessuno che conosce il reparto ha ancora guardato.

## Cos'è

Digitalizza la tabella turni **cartacea** di un reparto infermieristico: foto della tabella →
estrazione AI → **conferma umana** → sync su Google Calendar.

Il design completo è in `docs/superpowers/specs/2026-08-26-toni-turni-design.md`. **Leggilo prima di
modifiche non banali**: contiene modello dati, flusso, legenda dei codici turno e decisioni già prese.

## Stack

Next.js 16 (App Router) · TypeScript · Prisma + SQLite · Tailwind + shadcn/ui · `sharp` · `groq-sdk` ·
`googleapis` · Vitest. Deploy: Docker Compose su ZimaBoard (x86_64) + Cloudflare Tunnel.

## Comandi

```bash
npm run dev            # dev server su http://localhost:3000
npm run build          # build di produzione (output standalone)
npm test               # unit test (Vitest), AI e Google API mockate
npm test -- --watch    # watch mode
npm run eval           # accuratezza per cella dell'estrazione contro il provider REALE (costa token)
npm run lint           # eslint + type-check
npx prisma migrate dev # nuova migrazione dopo modifiche allo schema
npx prisma studio      # ispezione del database
docker compose up -d --build   # deploy sulla ZimaBoard
docker compose logs -f app     # log applicativi
```

## Struttura

Quello che esiste oggi:

```
src/
├── app/
│   ├── api/auth/google/{start,callback}/  # flusso OAuth
│   ├── api/auth/logout/, api/health/
│   ├── login/, settings/{codes,users}/    # pagine + server action
│   └── page.tsx, layout.tsx
├── modules/
│   ├── codes/     # types, normalize, slot, defaults, form, repository, index
│   ├── auth/      # policy, token, session, google, guards, index
│   ├── ingest/    # normalizzazione foto (auto-rotate EXIF, resize), storage, index
│   │              # + grid* (rilevamento della griglia), layout, crop (taglio in bande)
│   ├── extract/   # VisionProvider (groq, anthropic), schema Zod, prompt, extract, index
│   │              # + band-schema (con la fusione), band-prompt, extract-bands
│   └── roster/    # tabella e versioni, salvataggio celle, index
├── components/ui/ # generati da shadcn, non ancora usati: serviranno alla rifinitura UI
└── lib/           # env, db, time, crypto, homography (raddrizzamento prospettico)
prisma/            # schema, migrations, seed
tests/             # unit e integrazione, specchio di src/
scripts/           # accuracy.ts (logica pura) ed eval-extraction.ts (npm run eval)
fixtures/          # le due foto reali e le trascrizioni di riferimento, per npm run eval
docker/            # entrypoint: migrate deploy + seed all'avvio
```

Moduli previsti dalle fasi successive e **non ancora presenti**: `review` (griglia di conferma
umana), `calendar` (sync idempotente con Google Calendar).

**Confini dei moduli:** ogni modulo espone la sua interfaccia pubblica in `index.ts`. Non importare
file interni di un altro modulo. Se serve, allarga l'`index.ts` — non aggirarlo.

## Regole invarianti

Queste non sono preferenze di stile: violarle rompe la fiducia dell'utente o corrompe i suoi dati.

1. **Nessuna scrittura su Google Calendar senza conferma esplicita dell'utente.** L'estrazione AI
   produce solo bozze.
2. **Non toccare eventi che l'app non ha creato.** Ogni evento porta
   `extendedProperties.private.shiftKey = "<userId>:<YYYY-MM-DD>"`; update e delete filtrano su quella
   chiave. Nessun `shiftKey`, nessuna modifica.
3. **L'output del modello AI non è mai fidato.** Passa sempre da validazione Zod prima di toccare il
   database. Conserva il raw output in `Roster.rawOutput` per debug.
4. **Un codice turno sconosciuto non blocca l'estrazione.** Va salvato come `unknown` e risolto
   dall'utente. Non inventare un orario per un codice non in `ShiftCode`.
5. **La confidenza per cella si propaga fino alla UI.** Non scartarla nei livelli intermedi. Ma
   **non è il segnale su cui costruire la griglia di conferma**: la misura dice che su questo modello
   non discrimina niente (vedi "Trappole note"). Quello che dice all'utente quali celle rileggere è
   `handCorrected`.
6. **Ogni utente vede solo la propria colonna** (eccetto il ruolo `REFERENTE`). Controlla
   l'autorizzazione nelle API route, non solo nella UI.
7. **Solo `REFERENTE` carica tabelle e modifica la legenda dei codici.**
8. **Nessun segreto nel repository.** Chiavi solo via env; `refreshToken` cifrato a riposo con
   `APP_ENCRYPTION_KEY`.
9. **Le foto sono dati personali di terzi.** Restano locali; l'invio al provider AI avviene solo su
   azione esplicita.

## Trappole note

- **Fuso orario e ora legale.** Gli orari dei turni sono ore locali di `Europe/Rome`. Costruisci gli
  eventi con `timeZone: "Europe/Rome"`, non con offset fissi né con UTC calcolato a mano.
- **La notte attraversa la mezzanotte.** `NOTTE` = 21:00 → 07:00 del **giorno successivo**
  (`crossesMidnight`). È il bug più facile da introdurre e il più fastidioso da vivere.
- **Le foto sono ruotate.** Applica sempre l'auto-rotate EXIF in `ingest`, prima di qualsiasi altra
  cosa, o il modello legge la tabella di traverso.
- **Le correzioni a penna sono il caso critico.** Celle coperte con correttore e riscritte a mano
  esistono nelle foto reali (vedi Agosto 2026): il modello le sbaglia spesso — **entrambe** le celle
  sbagliate della misura sono lì. Vanno marcate `handCorrected` ed evidenziate in fase di conferma.
- **`handCorrected` funziona, ed è il segnale buono.** Misurato su agosto: precisione 91%, richiamo
  **100%** (10 veri positivi, 1 falso positivo, 0 falsi negativi). Tutte e dieci le correzioni a
  penna trovate, nessuna mancata. **La griglia di conferma della Fase 3 si progetta su questo.**
- **La confidenza per cella, invece, è inutilizzabile come filtro.** Nessuna cella su 519 prodotte
  sta sotto 0,8, ed **entrambe** le celle sbagliate sono state dichiarate con confidenza alta:
  evidenziare le celle a confidenza bassa non evidenzierebbe nulla. La regola invariante n. 5 resta
  giusta come architettura (la confidenza si propaga), ma non è il segnale su cui costruire la
  conferma.
- **Colonne non-infermiere.** `AIUTO MATT.`, `AIUTO POM.`, `TOT M`, `TOT P` non sono assegnazioni di
  turno: vanno ignorate. Lo stesso vale per il nome del **reparto** (`3°PIANO`), che è
  l'intestazione del foglio e che su qualche banda il modello elenca fra i nomi di colonna. Si
  scartano per nome normalizzato in fase di fusione, mai per indice.
- **SQLite non gestisce scritture concorrenti.** Serializza le operazioni di sync; è ampiamente
  sufficiente per questo carico.
- **`npm run eval` chiama il provider reale e consuma token.** Non eseguirlo in CI né in loop.
- **Groq conta i token di output *prenotati* nel budget al minuto, non solo quelli usati.** Il
  piano gratuito ha un tetto di 8000 token/minuto: chiedere `max_completion_tokens: 8000` fa
  pesare la richiesta 10369 token e la fa rifiutare con un errore sulla dimensione della
  richiesta, che non c'entra nulla con l'immagine. `GROQ_MAX_OUTPUT_TOKENS` di default è 4000
  (vedi `src/modules/extract/providers/groq.ts`).
- **L'estrazione della tabella intera in una sola chiamata non funziona su questo modello.** La
  misura reale su una foto di agosto ha dato 18,5% di celle corrette (46/248). L'estrazione a
  **bande verticali** (striscia dei giorni + due colonne, mezzo mese), stesso modello, è stata
  misurata e dà **99,6%** (486/488). Non tornare indietro alla tabella intera, e non allargare le
  bande senza misurare.
- **Le bande sono lente, e non è colpa del codice.** 24 bande per due foto sono ~18 minuti, di cui
  15,7 di sola attesa: il modello lavora ~4 s per banda. Il resto è il tetto di 8000 token al
  minuto del piano gratuito, che conta anche i token **prenotati** (vedi la trappola sopra). Un
  pacer serializza le chiamate; la taratura di `DEFAULT_TOKENS_PER_BAND` è sul dato misurato, vedi
  il commento in `src/modules/extract/extract-bands.ts`.
- **Node 22 è obbligatorio, e la shell può partire su una versione più vecchia.** Verifica con
  `node -v` e, se serve, `nvm use 22` prima di installare o eseguire i test.
- **`npm run lint` esegue `tsc --noEmit`, che richiede i tipi generati in `.next/types`.** Su un
  checkout pulito lancia prima `npx next typegen` (o un `npm run build`), altrimenti il type-check
  fallisce su route che esistono.

## Workflow: TDD, non negoziabile

Ogni feature e ogni bugfix segue il ciclo **RED → GREEN → REFACTOR**:

1. **RED** — scrivi il test che descrive il comportamento atteso ed **eseguilo**. Deve fallire, e per
   il motivo giusto: un test che passa subito non sta testando ciò che credi.
2. **GREEN** — scrivi il minimo codice che lo fa passare. Niente astrazioni anticipate.
3. **REFACTOR** — riordina con i test verdi a fare da rete.

Regole che ne derivano:

- **Non si scrive codice di produzione senza un test che lo richieda.** Se stai per implementare
  qualcosa e non esiste un test rosso, fermati e scrivi prima il test.
- **Non si dichiara qualcosa "fatto" senza aver eseguito i test e letto l'output.** Il comando è
  `npm test`; incolla il risultato, non presumerlo.
- **Ogni bug diventa prima un test che lo riproduce**, poi si corregge. Così non torna.
- I bordi difficili vanno testati per primi, perché è lì che l'errore è invisibile a occhio: notte a
  cavallo della mezzanotte, cambio ora legale, diff del sync, validazione dell'output AI, codici turno
  sconosciuti.
- Le dipendenze esterne (provider AI, Google Calendar) sono **sempre mockate** nei test. `npm run eval`
  è l'unica cosa che parla col provider reale, e non è un test.
- Il commit contiene test e implementazione insieme.

## Convenzioni

- **Test prima del codice**, sempre: vedi la sezione sul TDD qui sopra.
- **I test di logica pura importano i sottomoduli, non le facciate.** `@/modules/codes/normalize` e
  `@/modules/auth/token` invece di `@/modules/codes` e `@/modules/auth`: le facciate tirano dentro il
  client Prisma e `next/headers` (che include `server-only` e fallisce fuori dal runtime di Next). Il
  codice applicativo usa invece sempre la facciata.
- **I test che toccano il database** usano `createTestDb()` da `tests/helpers/db.ts`; se serve il
  singleton `@/lib/db`, impostano `process.env.DATABASE_URL`, cancellano `globalThis.prisma` e fanno
  `vi.resetModules()` **prima** di un import dinamico.
- Nomi di identificatori e messaggi di commit in **inglese**. Testi dell'interfaccia, commenti di
  codice, descrizioni dei test e documenti in **italiano**: il progetto ha un solo manutentore
  italiano e il dominio (turni, codici, ruoli) è italiano, quindi commentare in inglese aggiungerebbe
  una traduzione mentale a ogni lettura senza far guadagnare nulla.
- I codici turno restano in italiano come sulla carta (`M`, `P`, `NOTTE`, `RP`): sono il vocabolario
  del reparto, non tradurli.
- Server Components per default; `"use client"` solo dove serve interattività.
- Niente nuove dipendenze pesanti senza chiedere: il target è una ZimaBoard, non un server cloud.

## Domande aperte

Vivono in `docs/superpowers/specs/2026-08-26-toni-turni-design.md` §9 (durata di `M+`/`P+`,
significato di `RSF`, colonne di aiuto). I relativi codici sono marcati `needsReview: true` in
`ShiftCode`. **Non risolverle indovinando** — chiedi.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
