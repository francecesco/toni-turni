# CLAUDE.md

Istruzioni per Claude Code su questo repository.

> **Stato: fasi 1, 2A, 2A-bis, 2B, 3 e 4 completate.** Sopra le fondamenta della Fase 1 (Next.js,
> Prisma/SQLite, legenda dei codici turno, cifratura dei token, login Google, pagine di
> impostazioni, Docker) ci sono: l'ingestione delle foto con **rilevamento della griglia,
> raddrizzamento e ritaglio** (`ingest`), l'estrazione AI con provider **Gemini**/Anthropic,
> validazione Zod e fusione (`extract`), la persistenza **incrementale** con stato per banda e il
> job fuori dalla richiesta HTTP (`roster`), il caricamento della foto con anteprima dei tagli e la
> vista dell'estrazione (Fase 2B), la **griglia di conferma umana** con `ColumnAlias` e `Assignment`
> (`review`, Fase 3) e il **sync idempotente con Google Calendar** (`calendar`, Fase 4).
>
> **Non** sono implementati il diff fra versioni della stessa tabella (Fase 5) né la rifinitura UI
> (Fase 6). Il flusso però si chiude: dalla griglia di conferma il bottone «Manda sul mio calendario»
> lancia `syncRoster` (`syncColumnAction`), e ognuna sincronizza **solo la propria colonna** —
> referente compresa, perché sincronizzare la colonna di un'altra scriverebbe sul calendario di
> quella persona senza il suo consenso. Una cella si può anche **correggere a mano**
> (`correctCellAction` → `correctCell`), scegliendo fra i codici della legenda: l'infermiera sulla
> propria colonna, la referente su qualsiasi colonna. Correggere annulla la conferma di quel giorno:
> si corregge, si conferma, si sincronizza.
>
> ## Provider e strategia: Gemini, una chiamata sola
>
> **Groq non c'è più.** Il provider è **Gemini** (`AI_PROVIDER=gemini`, chiamate HTTP diritte su
> `generativelanguage.googleapis.com`, nessun SDK: vedi `src/modules/extract/providers/gemini.ts`), e
> la strategia di default è **la tabella intera in una sola chiamata** (`AI_STRATEGY=whole`).
>
> Il motivo del cambio non era l'accuratezza, era la **latenza**, e non stava nel codice: nella
> misura reale l'estrazione durava 461 s su agosto **di cui 417 di sola attesa** e 657 su settembre
> **di cui 603 di attesa**. Il modello lavorava ~4 s per banda; il 92% del tempo era il pacer che
> rispettava il tetto di 8000 token al minuto del piano gratuito di Groq, che contava anche i token
> *prenotati*. Togliendo quel tetto è caduta anche la ragione di distanziare le chiamate:
> `createRetryAfterPacer` attende **solo** davanti a un rate limit.
>
> **La tabella intera è una banda sola**, non un secondo percorso: `planWholeTable` produce una
> `BandSpec` che tiene tutte le colonne e tutti i giorni, e `cropRosterWhole` la materializza. Tutto
> quello che sta a valle resta quello già misurato — scarto delle colonne di servizio **per nome**,
> buchi dichiarati per colonna e giorni, persistenza che non sovrascrive una cella corretta a mano,
> conferma, sync. Un percorso separato avrebbe dovuto riguadagnarsi quelle proprietà una per una.
>
> **Attenzione, e non è un dettaglio: la chiamata singola NON è ancora misurata.** L'unico numero
> che questa strategia ha è il **18,5% (46/248 celle)** della Fase 2A, e quella misura mandava al
> modello la **foto**: tabella in prospettiva, annegata nello sfondo, riga di un giorno alta ~32 px,
> su un altro modello. Oggi l'immagine è raddrizzata sull'omografia del riquadro, ritagliata sulla
> griglia stampata e ricampionata ai pixel per riga della configurazione che ha misurato il 100%
> (agosto 2762x2574 = **78,0 px per riga**, settembre 3000x2087 = **65,2**, contro le ~77 del
> ritaglio letto al 100%). Sono differenze vere, non è la stessa prova — ma finché `npm run eval`
> non parla, **il 18,5% è l'unico dato che esiste**. Se non regge, `AI_STRATEGY=bands` riporta al
> percorso misurato al 99,8% senza toccare il codice.
>
> ## La misura che esiste (strategia `bands`)
>
> **487/488 celle corrette (99,8%)**: agosto 247/248, settembre 240/240. Zero celle mancanti (erano
> 199), zero celle in eccesso, zero bande fallite su 24, zero conflitti di fusione. Il rapporto è in
> `.superpowers/sdd/2026-08-26-fase-2a-bis-ritagli/correzioni-finali-report.md`.
>
> Nella misura quattro bande su 24 (settembre) risultavano «lette a metà», ed era un **falso
> allarme**: erano le bande delle colonne di servizio, che il modello legge tutte e che la fusione
> scarta per nome, mostrate come due colonne intitolate allo stesso modo sul foglio (`AIUTO MATT.`
> due volte di fila). Le celle attese di una banda si contano ora sulle colonne che **sopravvivono
> allo scarto**, non su quelle geometriche. Il verso opposto **non** è cambiato: una banda di sole
> colonne di persona che ne salta una intera dichiara il buco. Il rapporto è in
> `.superpowers/sdd/2026-08-26-fase-2a-bis-ritagli/falsi-buchi-report.md`.
>
> L'unica cella sbagliata è nella zona di agosto riscritta a penna sopra il correttore (`giorno 8
> CRISTINA`, attesa `M`, letta `H`). Fra due esecuzioni della misura il modello ha cambiato lettura
> su quella zona — la cella `COSTANZA giorno 10` era sbagliata prima e giusta ora — quindi **una
> cella di differenza fra due misure non è un miglioramento, è la variabilità del modello sulle celle
> corrette a mano**.
>
> Tre verifiche in sospeso, tutte da fare sulla macchina vera:
>
> 1. il flusso OAuth non è mai stato eseguito con credenziali Google reali — in tutti i test
>    `exchangeGoogleCode` è mockata; la checklist è in
>    [docs/verifica-manuale-oauth.md](docs/verifica-manuale-oauth.md);
> 2. il percorso foto → anteprima → estrazione non è mai stato percorso **dall'interfaccia** su una
>    foto vera con Gemini: l'anteprima dei tagli esiste proprio per rendere visibile un rilevamento
>    sbagliato prima di spendere una chiamata;
> 3. le trascrizioni di riferimento in `fixtures/` portano ancora `"verified": false`: le percentuali
>    qui sopra valgono quanto la trascrizione, che nessuno che conosce il reparto ha ancora guardato.

## Cos'è

Digitalizza la tabella turni **cartacea** di un reparto infermieristico: foto della tabella →
estrazione AI → **conferma umana** → sync su Google Calendar.

Il design completo è in `docs/superpowers/specs/2026-08-26-toni-turni-design.md`. **Leggilo prima di
modifiche non banali**: contiene modello dati, flusso, legenda dei codici turno e decisioni già prese.

## Stack

Next.js 16 (App Router) · TypeScript · Prisma + SQLite · Tailwind + shadcn/ui · `sharp` ·
`@anthropic-ai/sdk` · `google-auth-library` · Vitest. Deploy: Docker Compose su ZimaBoard (x86_64) +
Cloudflare Tunnel.

> Due SDK nominati altrove **non ci sono, e non servono**. `googleapis`: il Calendar API si usa con
> sette chiamate HTTP sopra `OAuth2Client` di `google-auth-library` (che rinnova già l'access token
> da sé), invece di decine di megabyte di client generato su una ZimaBoard — vedi
> `src/modules/calendar/api.ts`. `groq-sdk`: era dichiarato in questo file ma non è mai stato in
> `package.json`, e Gemini si chiama con un `fetch` e trenta righe. Un client generato per una
> chiamata al mese su una ZimaBoard è peso senza ritorno.

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
│   ├── api/rosters/                       # POST upload (referente)
│   ├── api/rosters/[id]/{extract,progress,image,preview}/
│   ├── rosters/                           # elenco, upload
│   ├── rosters/[id]/                      # vista estrazione + avanzamento
│   ├── rosters/[id]/columns/              # ColumnAlias: colonna → persona
│   ├── rosters/[id]/review/               # griglia di conferma, correzione, sync
│   ├── login/, settings/{codes,users}/    # pagine + server action
│   └── page.tsx, layout.tsx
├── modules/
│   ├── codes/     # types, normalize, slot, defaults, form, repository, index
│   ├── auth/      # policy, token, session, google, guards (authorizeApi), googleAccount, index
│   ├── ingest/    # normalizzazione foto (auto-rotate EXIF, resize), storage, index
│   │              # + grid* (rilevamento della griglia), layout (planBands, planWholeTable),
│   │              # + crop (cropRosterWhole, cropRosterBands), preview
│   ├── extract/   # VisionProvider (gemini, anthropic), schema Zod, strategy, index
│   │              # + band-schema (con la fusione), band-prompt, extract-bands, prompt (riparazione)
│   ├── roster/    # tabella, versioni, stato per banda, job e worker, form, index
│   ├── review/    # access, aliases, grid, holes, confirm, correct, index
│   └── calendar/  # shiftKey, event, diff, window (puri) · api, dedicated, repository, lock, sync
├── components/ui/ # generati da shadcn
└── lib/           # env, db, time, crypto, homography (raddrizzamento prospettico)
prisma/            # schema, migrations, seed
tests/             # unit e integrazione, specchio di src/
scripts/           # accuracy.ts (logica pura) ed eval-extraction.ts (npm run eval)
fixtures/          # le due foto reali e le trascrizioni di riferimento, per npm run eval
docker/            # entrypoint: migrate deploy + seed all'avvio
```

Tutti i moduli previsti dal design esistono. Quello che manca non è un modulo: è il bottone che
lancia il sync (Fase 4 dall'interfaccia) e il diff fra versioni (Fase 5).

**Confini dei moduli:** ogni modulo espone la sua interfaccia pubblica in `index.ts`. Non importare
file interni di un altro modulo. Se serve, allarga l'`index.ts` — non aggirarlo. L'eccezione, la
stessa dei test di logica pura: `scripts/` importa i sottomoduli (`../src/modules/ingest/crop`) perché
gira sotto `tsx` fuori dal runtime di Next, dove le facciate tirano dentro il client Prisma e
`next/headers`.

## Regole invarianti

Queste non sono preferenze di stile: violarle rompe la fiducia dell'utente o corrompe i suoi dati.

1. **Nessuna scrittura su Google Calendar senza conferma esplicita dell'utente.** L'estrazione AI
   produce solo bozze. In pratica quel consenso è `Assignment.confirmedAt`: `syncRoster` scrive
   soltanto per le assegnazioni che lo hanno valorizzato, e un turno tornato in bozza non fa
   cancellare l'evento già presente.
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
- **`handCorrected` e `correctedAt` sono due cose diverse, e confonderle è facile.**
  `RosterCell.handCorrected` dice che **il foglio** porta una correzione a penna: è un dato letto
  dalla foto dal modello. `RosterCell.correctedAt`/`correctedCode`/`correctedBy` dicono che **una
  persona** ha corretto la lettura sulla griglia di conferma. `rawCode` e `code` restano sempre la
  lettura del modello, così la provenienza non si perde; il codice che conta è
  `correctedAt !== null ? correctedCode : code`, e `correctedCode` null **con** `correctedAt`
  valorizzato significa «il foglio qui è vuoto». `saveBandCells` non tocca una cella corretta a
  mano: una rilettura non deve cancellare il giudizio di chi ha il foglio davanti.
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
  sufficiente per questo carico. La coda è `withSyncLock` in `src/modules/calendar/lock.ts`: è
  unica per tutti gli utenti, non una per utente, perché la risorsa contesa è il database.
- **Il diff del sync confronta istanti, non stringhe.** Google restituisce gli orari con l'offset
  già applicato (`...T21:00:00+02:00`) e nella notte del cambio d'ora i due estremi hanno offset
  diversi: confrontare le stringhe farebbe risultare *diverso* ogni evento a ogni giro, e il sync
  riscriverebbe tutto ogni volta. Vedi `sameEvent` in `src/modules/calendar/diff.ts`.
- **Creare il calendario dedicato richiede lo scope `calendar.app.created`.** Con `calendar.events`
  da solo la creazione risponde 403. Chi aveva già dato il consenso prima della Fase 4 deve
  rifarlo (revoca da myaccount.google.com/permissions).
- **`npm run eval` chiama il provider reale e consuma token.** Non eseguirlo in CI né in loop.
- **La chiamata singola non è misurata, e il solo numero che ha è 18,5%.** La tabella intera in una
  chiamata, misurata nella Fase 2A **sulla foto** (prospettiva, sfondo, ~32 px per riga, altro
  modello), diede 46/248 celle. Oggi l'immagine è raddrizzata, ritagliata sulla griglia e
  ricampionata a 78 px per riga (agosto) — è una prova diversa, non la stessa. Ma **non ripetere il
  99,8% parlando della strategia `whole`**: quel numero è di `bands`. Prima di dichiarare qualsiasi
  cosa, `npm run eval`.
- **Il tetto di token in uscita di Gemini va largo, non stretto.** ~250 celle di JSON sono ~6000
  token, e i token di **ragionamento** contano nello stesso budget: `GEMINI_MAX_OUTPUT_TOKENS` di
  default è 32768. Gemini fattura gli usati e non i prenotati, quindi chiederne molti non costa
  nulla — mentre un tetto stretto tronca la tabella a metà, e una risposta troncata **non si
  ritenta** (rimandare la stessa immagine la tronca di nuovo).
- **`bandExtractionSchema` limita le colonne a 40, non a 12.** Il vecchio tetto di 12 era scritto
  quando una banda portava due colonne: con la tabella intera settembre ne ha 13, e quel tetto
  faceva **rifiutare l'intera lettura** per un limite che non riguardava più niente. Se aggiungi un
  vincolo a quello schema, chiediti prima come si comporta su una banda che è tutta la tabella.
- **Il conto delle celle attese può dichiarare un buco che non c'è, e sulla tabella intera il
  rischio è più grande.** Se il modello nomina *meno* colonne di servizio di quante ne stampi il
  foglio — e con `AIUTO MATT.` due volte di fila lo fa spesso, nominandola una volta —
  `countBandCells` non sa se le colonne mancanti siano di servizio o colleghe saltate, e sceglie il
  verso prudente. Su settembre: 4 nomi di servizio invece di 6 fanno salire le attese da 240 a 270,
  e una lettura perfetta si dichiara incompleta. Prudente è giusto (una cella che sparisce in
  silenzio è peggio di un avviso di troppo), ma un avviso inaffidabile insegna a ignorarlo. Il caso
  è coperto da un test che lo **documenta** invece di asserire il numero che si vorrebbe:
  `npm run eval` dirà se capita sulle foto vere, e allora si risolve col dato in mano.
- **Due colonne possono avere lo stesso nome, e in una chiamata sola finiscono nella stessa
  risposta.** Sul foglio di settembre `AIUTO MATT.` compare due volte di fila. `bandExtractionSchema`
  **non** pretende coppie giorno/colonna distinte, al contrario di `extractionSchema`: pretenderlo
  farebbe cadere la lettura di tutta la tabella per due colonne che vengono buttate subito dopo.
- **La geometria dei ritagli non si chiede a nessuno e non si configura.** La rileva
  `cropRosterBands` sulla foto (`detectTableQuad` → omografia → `pruneColumnBoundaries` →
  `planBands`). Frazioni fisse non trasferiscono da una foto all'altra: fra agosto e settembre
  l'area delle infermiere passa da 0,693 a 0,552 del riquadro. L'anteprima
  (`/api/rosters/[id]/preview`) disegna i confini rilevati sul riquadro raddrizzato: è il controllo
  umano prima di spendere una chiamata.
- **La lentezza di prima era il pacer, non il modello.** 24 bande per due foto erano ~18 minuti, di
  cui 15,7 di **sola attesa**: il modello lavorava ~4 s per banda. Era il tetto di 8000 token al
  minuto del piano gratuito di Groq, che contava anche i token prenotati. Non c'è più:
  `createRetryAfterPacer` attende **solo** davanti a un rate limit, e con `retry-after` assente usa
  un ritardo di riserva invece di riprovare nello stesso istante — perché non tutti i provider
  mandano quell'header, e senza quel ramo un 429 perdeva la banda al primo colpo.
- **L'estrazione non sta in una richiesta HTTP, nemmeno con una chiamata sola.** L'upload risponde
  subito;
  `runExtractionJob` gira dopo, in-process, e persiste **una banda alla volta** su `RosterBand`.
  Un riavvio del processo lascia una `Roster` in `extracting` con un battito vecchio:
  `reclaimStaleExtractions` la porta a `interrupted` e il worker riprende dalle bande mancanti.
  Il worker viene svegliato dall'elenco delle tabelle e dalla route dell'avanzamento — non c'è
  nessun job pianificato da tenere in vita.
- **La confidenza per cella è inutilizzabile per decidere cosa rileggere.** Nella misura reale (su
  Groq: da rifare su Gemini) nessuna cella su 519 stava sotto 0,8 ed **entrambe** le celle sbagliate
  erano dichiarate con confidenza alta; il rilevamento delle correzioni a penna invece ha richiamo 100% (10 su 10) e
  precisione 91%. La griglia di conferma evidenzia `handCorrected`, i conflitti fra bande e i codici
  sconosciuti — **non** la confidenza bassa. La confidenza si propaga comunque fino alla UI (regola
  invariante 5) e si mostra come dato accessorio, ma non guida l'attenzione.
- **Un'identità di colonna sola: `normalizeColumn`.** Tiene solo lettere e cifre, quindi `SARA DP.`
  e `SARA DP` sono la stessa infermiera. Ce ne sono state cinque in questo progetto e una aveva
  falsificato la misura: se ti serve confrontare due nomi di colonna, usa quella e non derivarne
  un'altra. Lo stesso vale per `isColonnaDiServizio`, che è l'unico elenco delle colonne che non
  sono turni di nessuno.
- **Un buco si dichiara per colonna e giorni, mai per indice di banda.** Su settembre quattro bande
  risultavano lette a metà, ed erano le colonne di servizio (`AIUTO MATT.`, `TOT M`): dire
  "15 celle su 30 non lette" fa spaventare un'infermiera che ha tutti i suoi turni, e le insegna a
  ignorare l'avviso. Le bande coprono **mezzo mese**, quindi `RosterBand` porta `dayFrom`/`dayTo` e
  `columnCoverage`/`describeUnreadBands` traducono un buco in nomi di colonna e giorni; dove i nomi
  non si conoscono lo dicono invece di inventarli.
- **Solo la persona associata a una colonna può confermarla, referente compresa.** La referente
  *vede* tutte le colonne (le serve), ma confermare la colonna di un'altra metterebbe eventi sul
  calendario di quella persona senza il suo consenso.
- **Prisma genera in `node_modules`, che è condiviso fra i worktree.** Se vedi
  `Unknown argument '<campo>'` su un campo che nello schema esiste, non è un tuo difetto: lancia
  `npx prisma generate`. Dopo ogni `migrate dev` rilancia `npx prisma generate` **e la suite
  intera**.
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
