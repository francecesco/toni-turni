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
> La **Fase 5** è implementata: una seconda foto dello stesso mese **sposta** le conferme sulla versione
> nuova alla chiusura della lettura (`carryOverAssignments`, per persona e solo se la sua colonna c'è),
> riporta le correzioni a mano a grezzo uguale, e la griglia mostra tutti i giorni e un riquadro
> elenca solo quelli cambiati (`diffVersions`, puro). La referente ha `/rosters/[id]/diff`. Resta la
> rifinitura UI (Fase 6).
>
> ## Provider e strategia: Gemini, una chiamata sola — **misurata**
>
> **Groq non c'è più.** Il provider è **Gemini** (`AI_PROVIDER=gemini`, chiamate HTTP diritte su
> `generativelanguage.googleapis.com`, nessun SDK: vedi `src/modules/extract/providers/gemini.ts`), e
> la strategia di default è **la tabella intera in una sola chiamata** (`AI_STRATEGY=whole`).
>
> **Il risultato, misurato sulle due foto reali con `npm run eval`: 488/488 celle (100,0%)** —
> agosto 248/248, settembre 240/240. Zero celle mancanti, zero sbagliate, zero in eccesso, zero
> buchi dichiarati, **una chiamata per foto**. **Riprodotto in due esecuzioni indipendenti**, che è
> la ragione per cui il numero si può scrivere: una sola esecuzione al 100% è anche fortuna. Tempo:
> 103-165 s per foto, contro i 9-11 minuti per foto della strategia a bande. Token: ~20 mila per
> foto (2,2 mila di input, il resto di uscita).
>
> Sul segnale che guida la rilettura umana: le celle **riscritte a mano** sono trovate tutte
> (richiamo 100%, 10 su 10), e le celle **da rileggere** — riscritture più annotazioni d'orario —
> anche (15 su 15). La precisione era 79%, con quattro segnalazioni che la fixture non spiegava; dal
> 2026-09-06 il prompt dice che **l'evidenziatore non è una correzione** (vedi sotto) e la misura dà
> precisione **100%** su agosto e **zero** celle marcate su settembre, dove la stessa tabella letta
> dall'app ne portava 47. In quella misura agosto ha letto 247/248: la cella persa è `giorno 10
> COSTANZA` (`P RSF` in corsivo a mano, letta `P1°P`), nella zona che la fixture dichiara come il suo
> punto meno certo e che oscilla di una cella da una misura all'altra. Tempi: 47 s agosto, 89 s
> settembre. Il log è in `.superpowers/sdd/2026-09-06-evidenziatore-eval.log`.
>
> Il motivo del cambio non era l'accuratezza, era la **latenza**, e non stava nel codice: nella
> misura su Groq l'estrazione durava 461 s su agosto **di cui 417 di sola attesa** e 657 su settembre
> **di cui 603 di attesa**. Il modello lavorava ~4 s per banda; il 92% del tempo era il pacer che
> rispettava il tetto di 8000 token al minuto del piano gratuito, che contava anche i token
> *prenotati*. Togliendo quel tetto è caduta anche la ragione di distanziare le chiamate:
> `createRetryAfterPacer` attende **solo** prima di ritentare.
>
> **La tabella intera è una banda sola**, non un secondo percorso: `planWholeTable` produce una
> `BandSpec` che tiene tutte le colonne e tutti i giorni, e `cropRosterWhole` la materializza. Tutto
> quello che sta a valle resta quello già misurato — scarto delle colonne di servizio **per nome**,
> buchi dichiarati per colonna e giorni, persistenza che non sovrascrive una cella corretta a mano,
> conferma, sync. Un percorso separato avrebbe dovuto riguadagnarsi quelle proprietà una per una.
>
> Quello che ha fatto la differenza rispetto al 18,5% della Fase 2A (che mandava al modello la
> **foto**: prospettiva, sfondo, riga alta ~32 px, altro modello):
>
> 1. la tabella arriva **raddrizzata** sull'omografia del riquadro e **ritagliata** sulla griglia
>    stampata, non annegata nella foto;
> 2. è **ricampionata** ai pixel per riga della configurazione misurata al 100% (agosto 2762x2574 =
>    78,0 px per riga; settembre 3000x2087 = 65,2, dove il tetto sul lato lungo morde prima del
>    bersaglio — è geometria, non una scelta);
> 3. il prompt dichiara un **ordine di scansione** (giorno per giorno) e ricorda che il giorno si
>    legge dalla striscia di sinistra: su 31 righe il modo in cui questa lettura sbaglia è perdere il
>    passo fra le righe;
> 4. il prompt porta la **regola del reparto sull'orario a penna** (vedi sotto), che da sola valeva
>    5 celle su 488.
>
> Se un giorno non reggesse, `AI_STRATEGY=bands` riporta al percorso misurato al 99,8% senza toccare
> il codice.
>
> ### Il modello si sceglie su una prova, non su un numero di versione
>
> Provato contro l'API il 2026-08-31 con una chiave di AI Studio senza fatturazione:
>
> | modello | esito |
> |---|---|
> | `gemini-2.5-pro`, `gemini-2.5-flash` | **404** «no longer available to new users» |
> | `gemini-3.1-pro-preview` (e i Pro in genere) | **429 RESOURCE_EXHAUSTED**, «check your plan and billing details»: quota zero senza fatturazione |
> | `gemini-3.7-flash`, `gemini-flash-latest` | **503 UNAVAILABLE**, «high demand», ripetibile sulla tabella intera |
> | `gemini-3-flash-preview` | 200, ma brucia **31455 token di ragionamento** e non produce JSON |
> | **`gemini-3.6-flash`** (il default), `gemini-3.5-flash` | **200**, tabella intera letta per intero |
>
> Il default è quindi il **3.6** e non il 3.7, che è più nuovo: un modello che risponde 503 non è un
> modello più avanzato. È **pinnato** e non l'alias `gemini-flash-latest` — che oggi punta proprio al
> 3.7 — perché le percentuali qui sopra valgono per un modello preciso. Con la fatturazione attiva
> vale la pena misurare un Pro: su una tabella corretta a penna è il candidato naturale.
>
> ### Le tre cose che hanno rotto, e come sono state chiuse
>
> Nessuna era prevedibile a tavolino, tutte e tre sono uscite dalla misura:
>
> 1. **`503 UNAVAILABLE` e richieste appese.** Una lettura è rimasta appesa **301 secondi** e poi è
>    caduta sul `headersTimeout` di Node (300 s) con un «fetch failed» che non dice niente. Ora il
>    provider ha un limite **suo** (`REQUEST_TIMEOUT_MS`, 270 s) che nomina il guasto, e `ritentabile`
>    ritenta 429, 5xx **e i guasti di rete** — che non hanno stato HTTP, e con il gate sul solo stato
>    non venivano ritentati. Con dieci bande un guasto costava una banda; con una chiamata sola costa
>    **tutta la tabella**.
> 2. **Colonne senza nome.** Il modello elenca l'intestazione come la vede, e la casella sopra la
>    striscia dei giorni sul foglio è vuota: la risposta vera era `["3°PIANO", "", "RENATA", ...]`, e
>    quel `""` faceva **rifiutare l'intera lettura** — 240 celle buone buttate. Ora
>    `parseBandExtraction` scarta le colonne senza nome e le celle che le citano; se **nessuna**
>    colonna ha un nome leggibile, resta una lettura fallita.
> 3. **Il tetto di 12 colonne.** `bandExtractionSchema` limitava le colonne a 12 e la tabella intera
>    di settembre ne ha 13: l'intera lettura veniva rifiutata per un limite scritto quando una banda
>    ne portava due.
>
> ### L'orario scritto a penna non fa parte del codice
>
> È una **regola del reparto**, ed è la differenza fra 483/488 e 488/488. Sul foglio di agosto ci sono
> celle come `P h13:30`, `M 7`, `P 13`: il codice del turno resta `P` o `M`, e l'orario a penna dice
> che quel turno comincia a un'ora diversa dal solito. Gemini, senza istruzioni, lo incorporava nel
> codice (`P h1330`, `M730`), producendo cinque codici sconosciuti. Il prompt ora dice la regola e
> chiede di marcare quelle celle `handCorrected`, perché una persona le deve rivedere: il codice non
> porta l'ora, quindi l'evento andrebbe in calendario all'ora sbagliata.
>
> Da questo viene una **seconda misura** in `scripts/accuracy.ts`, e sono due e non una di proposito:
> `handCorrectedAccuracy` misura le celle **riscritte a mano** (è la sua recall che non deve
> scendere: 10 su 10), `toReviewAccuracy` misura le celle che **una persona deve rileggere**, cioè
> riscritture **più** annotazioni d'orario. Sostituire la prima con la seconda nasconderebbe un
> peggioramento della prima dietro un miglioramento della seconda.
>
> ## L'altra misura: la strategia `bands`
>
> **487/488 celle corrette (99,8%)** su Groq: agosto 247/248, settembre 240/240. Zero celle mancanti (erano
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
> **In produzione dal 2026-09-07** sulla ZimaBoard, `https://turni.cescohomelab.com`, attraverso il
> tunnel Cloudflare già presente sull'host (`deploy/compose.shared-tunnel.yml`; procedura in
> [docs/deploy-zimaboard.md](docs/deploy-zimaboard.md)). Delle tre verifiche che erano in sospeso ne
> resta una:
>
> 1. ~~il flusso OAuth con credenziali Google reali~~ **fatto**: il 2026-09-06 su `localhost:3001` e il
>    2026-09-07 sul dominio di produzione, accesso riuscito, `GoogleAccount` con il refresh token cifrato;
>    i rami d'errore (`code` riusato, consenso negato, `state` manomesso) provati da riga di comando.
>    Restano i passi della checklist che vogliono un secondo account Google, e il primo sync vero:
>    [docs/verifica-manuale-oauth.md](docs/verifica-manuale-oauth.md);
> 2. ~~il percorso foto → anteprima → estrazione dall'interfaccia su Gemini~~ **fatto** il 2026-08-31
>    (tabella di settembre, una banda, 240 celle) e confrontato il 2026-09-06 con la trascrizione di
>    riferimento: **240/240**, zero mancanti, zero in eccesso. Ma ha fatto emergere una cosa che la
>    misura non poteva vedere, perché la fixture di settembre non dichiara `handCorrected`: il modello
>    ha marcato **47 celle su 240** da rileggere, e sul foglio **nessuna** è una correzione a penna.
>    Sono le quattro domeniche evidenziate in giallo per intero (32 celle) e i 15 `RP` evidenziati col
>    pennarello; i due `RP` su fondo grigio *stampato* non sono marcati. Per il modello `handCorrected`
>    vuole dire «c'è l'evidenziatore», e una griglia che chiede di rileggere una cella su cinque
>    insegna a ignorare l'avviso. **Corretto lo stesso giorno** nel prompt e rimisurato: zero marcate
>    su settembre, precisione 100% sulle celle da rileggere di agosto. La fixture di settembre ora
>    dichiara `handCorrected` e `penAnnotations` **vuote** — quindi misurabili — sulla base della
>    foto; resta da confermare da chi conosce il foglio, come tutto il resto della trascrizione;
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
│   ├── rosters/[id]/diff/                 # diff fra versioni, solo referente
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
│   ├── roster/    # tabella, versioni, stato per banda, job e worker, form, versions, index
│   ├── review/    # access, aliases, grid, holes, confirm, correct, landing, calendar-status, diff, index
│   └── calendar/  # shiftKey, event, diff, window (puri) · api, dedicated, repository, lock, sync
├── components/ui/ # generati da shadcn
└── lib/           # env, db, time, crypto, homography (raddrizzamento prospettico)
prisma/            # schema, migrations, seed
tests/             # unit e integrazione, specchio di src/
scripts/           # accuracy.ts (logica pura) ed eval-extraction.ts (npm run eval)
fixtures/          # le due foto reali e le trascrizioni di riferimento, per npm run eval
docker/            # entrypoint: migrate deploy + seed all'avvio
deploy/            # zimaboard.env.example: il .env di produzione da compilare sulla Zima
docs/deploy-zimaboard.md   # installazione passo passo: tunnel Cloudflare, segreti, verifiche, backup
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
- **L'evidenziatore non è una correzione, e al modello va detto.** Sulla tabella di settembre letta
  dall'app (Gemini 3.6 Flash) 47 celle su 240 portavano `handCorrected` e nessuna era riscritta a
  penna: le righe delle domeniche evidenziate in giallo e i singoli `RP` evidenziati. Il prompt diceva
  cosa **è** una correzione ma non cosa **non lo è**; ora la regola 3 nomina evidenziatore e fondo
  colorato. Rimisurato: zero marcate su settembre, e su agosto le quattro segnalazioni inspiegate sono
  sparite **senza perdere** nessuna delle dieci correzioni vere. La fixture di settembre dichiara le
  liste vuote proprio perché la misura possa contare questi falsi positivi: una lista **assente** fa
  saltare il blocco, una lista **vuota** lo rende contabile. Se una foto nuova porta un altro tipo di
  segno (una crocetta, una freccia), è lo stesso schema: prima si guarda cosa il modello marca e perché,
  poi si nomina nel prompt, poi si rimisura su **tutte** le foto, perché la recall delle correzioni
  vere è il numero che non deve scendere.
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
- **Un calendario nuovo nasce solo per mano di una persona.** Il calendario dedicato si chiama
  «Turni Toniolo» (`DEDICATED_CALENDAR_SUMMARY`, fissato da un test perché è anche la chiave con cui
  lo si ritrova senza id). Con un id salvato il sync riparte **sempre** da quello; se Google dice che
  non esiste più, `resolveDedicatedCalendar` lancia `DedicatedCalendarMissingError` e il sync si
  ferma con `calendarMissing: true` — **non** ne crea un altro. La griglia mostra «Ricollega il
  calendario» (`relinkCalendarAction` → `clearCalendarId`), e solo dopo quel gesto il sync successivo
  cerca per nome o crea. Due calendari con lo stesso nome fanno rifiutare la scelta invece di prendere
  il primo. Deciso il 2026-09-06: la ricreazione automatica era il solo ramo in cui l'app poteva
  produrre un doppione senza che nessuno l'avesse chiesto.
- **Creare il calendario dedicato richiede lo scope `calendar.app.created`.** Con `calendar.events`
  da solo la creazione risponde 403. Chi aveva già dato il consenso prima della Fase 4 deve
  rifarlo (revoca da myaccount.google.com/permissions).
- **L'immagine Docker porta `sqlite3` solo per il backup.** Il comando di backup del README
  (`docker compose exec app sqlite3 /data/turni.db ".backup …"`) girava dentro un'immagine Alpine che
  non lo installava: falliva al primo uso. Ora il runner fa `apk add sqlite`; l'app non lo tocca, usa
  il client Prisma. Verificato il 2026-09-07 costruendo l'immagine da `main` e avviando il container
  con un `.env` finto: migrazioni, seed, `/api/health` 200, `/api/auth/dev-login` 404 in produzione.
- **`npm run eval` chiama il provider reale e consuma token.** Non eseguirlo in CI né in loop.
- **Il 18,5% della Fase 2A non dice niente sulla strategia di oggi, e viceversa.** Quella misura
  mandava al modello la **foto** (prospettiva, sfondo, ~32 px per riga, altro modello) e diede 46/248
  celle; la tabella intera raddrizzata, ritagliata e ricampionata dà **488/488** su Gemini 3.6 Flash.
  Sono tre differenze nell'immagine più il prompt, non la stessa prova. Il verso che conta: **non
  attribuire a una configurazione il numero di un'altra** — né il 18,5% a `whole`, né il 99,8% di
  `bands` (che è su Groq). Ogni cambio all'immagine, al prompt o al modello si rimisura.
- **Il tetto di token in uscita di Gemini va largo, non stretto — misurato.** La tabella intera
  produce **16-20 mila token** di uscita più il ragionamento, che conta nello stesso budget:
  `GEMINI_MAX_OUTPUT_TOKENS` di default è 32768. Con un tetto a 12000 la risposta si tronca e il JSON
  diventa invalido, provato. Gemini fattura gli usati e non i prenotati, quindi chiederne molti non
  costa nulla — mentre una risposta troncata **non si ritenta** (rimandare la stessa immagine la
  tronca di nuovo).
- **Una lettura della tabella intera prende 150-165 s, e il limite è 270.** Il margine è 1,64x, e il
  numero è cresciuto strada facendo: le prime letture riuscite stavano a 87-97 s, quelle col prompt
  finale a 150-165. Se si allunga ancora, `REQUEST_TIMEOUT_MS` in `providers/gemini.ts` è il numero
  da guardare — e non si alza sopra i 300 s, perché oltre quelli il limite torna a essere il
  `headersTimeout` di Node, che fallisce senza dire perché.
- **`bandExtractionSchema` limita le colonne a 40, non a 12.** Il vecchio tetto di 12 era scritto
  quando una banda portava due colonne: con la tabella intera settembre ne ha 13, e quel tetto
  faceva **rifiutare l'intera lettura** per un limite che non riguardava più niente. Se aggiungi un
  vincolo a quello schema, chiediti prima come si comporta su una banda che è tutta la tabella.
- **Sulla tabella intera il pavimento geometrico del conto delle celle attese non si applica.** È
  successo per davvero: lettura **perfetta** di settembre, 240 celle su 240, e il conto dichiarava
  «240 su 270 attese». Il pavimento sottraeva alle 13 colonne *geometriche* i 4 nomi di servizio
  *letti* — due grandezze che sulla tabella intera non misurano la stessa cosa, perché il foglio
  stampa 14 colonne e la geometria ne rileva 13 (`pruneColumnBoundaries` fonde `TOT M` e `TOT P`) e
  perché il modello collassa i nomi doppi (`AIUTO MATT.` stampato due volte, nominato una). Su una
  banda da due colonne nessuna delle due morde, e il pavimento **resta**. Quello che sulla tabella
  intera continua a dichiarare il buco è il modo in cui una lettura lunga sbaglia davvero: fermarsi
  per strada o leggere una colonna a metà. L'unico caso che smette di essere dichiarato è la collega
  **mai nominata**, e non sparisce in silenzio: lei legge «Non c'è ancora una colonna associata a te
  su questa tabella» e la referente vede che la colonna manca. Un avviso che grida al lupo su ogni
  tabella insegna a ignorarlo, e allora non protegge più nessuno.
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
- **Le conferme vivono sulla versione, e una versione nuova le sposta, non le copia.** `Assignment.rosterId`
  cambia alla chiusura della lettura della versione N+1 (`finishExtraction` → `carryOverAssignments`).
  Una riga sola per persona e giorno, sempre sull'ultima versione: due copie con lo stesso `eventId`
  farebbero litigare due sync. Se la foto nuova **non ha la colonna** di una persona, le sue conferme
  restano sulla N e lei continua a vedere la N — non è un bug, è la sola versione in cui esiste.
- **Un turno tolto dal foglio nuovo non sparisce dal calendario da solo.** La riga resta con
  l'assegnazione «orfana» e il bottone «Togli dal calendario» (`removeAssignment`); solo dopo quel gesto
  il sync cancella l'evento, perché una giornata senza assegnazione non protegge la chiave. Un turno
  cambiato dopo l'invio resta sul calendario com'era finché non viene riconfermato: regola invariante 1.
- **Solo la persona associata a una colonna può confermarla, referente compresa.** La referente
  *vede* tutte le colonne (le serve), ma confermare la colonna di un'altra metterebbe eventi sul
  calendario di quella persona senza il suo consenso.
- **Prisma genera in `node_modules`, che è condiviso fra i worktree.** Se vedi
  `Unknown argument '<campo>'` su un campo che nello schema esiste, non è un tuo difetto: lancia
  `npx prisma generate`. Dopo ogni `migrate dev` rilancia `npx prisma generate` **e la suite
  intera**.
- **Dal telefono, in sviluppo, la pagina arriva e gli script no.** Next emette gli `<script>` con
  `crossorigin=""`, quindi Safari manda `Origin`, e il dev server risponde **403** a ogni chunk chiesto
  da un host diverso da quello di avvio: pagina visibile, niente idratazione, nessun errore da nessuna
  parte — un ⋯ che «non reagisce al tocco». Su `localhost` non si vede mai. L'allowlist è
  `allowedDevOrigins` in `next.config.ts`, derivata dall'host di `APP_URL` (`src/lib/dev-origins.ts`):
  per il percorso dal telefono `APP_URL` va all'IP di rete, e serve un riavvio del dev server. Attenzione
  al secondo strato: il caricatore di Next **non sovrascrive** una variabile già nella shell, quindi un
  `APP_URL` esportato nell'ambiente vince sul `.env` in silenzio — `env -u APP_URL npm run dev` se il
  `.env` sembra ignorato.
- **In produzione `request.url` dice `0.0.0.0:3000`, non il dominio.** Il server standalone di Next
  compone `request.url` con l'host su cui ascolta (`HOSTNAME=0.0.0.0` nel Dockerfile) e la porta, non
  con l'`Host` della richiesta: un redirect costruito con `new URL(path, request.url)` manda il browser
  su `https://0.0.0.0` — «Il sito non può fornire una connessione protetta», `ERR_SSL_PROTOCOL_ERROR`,
  console vuota. È successo al primo caricamento in produzione, il 2026-09-07: il login andava, perché
  le route di autenticazione partivano già da `APP_URL`, e «Carica» no. Ogni redirect assoluto nelle
  route API parte da `requireEnv('APP_URL')` (`tests/app/rosters/routes.test.ts` lo fissa con richieste
  su `0.0.0.0`); in sviluppo su `localhost` la differenza non si vede mai.
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
