# Fasi 2B e 3 — rapporto

- **Data:** 2026-08-28
- **Branch:** `worktree-agent-acb2681d947049caf`
- **Stato:** completate. `npm test` verde (410 test, 37 file), `npm run lint` pulito,
  `npm run build` riuscito, `git status` pulito.

## Stato reale del punto di partenza (diverso da quello atteso)

Il brief descriveva come già esistenti `cropRosterBands`, `extractRosterByBands` con
`BandsOutcome`, lo stato `partial`/`missingBands`, l'accuratezza al 99,6% e una suite da 441 test.
Nel worktree **niente di tutto questo esisteva**: `ingest` aveva solo `normalize` e `storage`,
`extract` solo l'estrazione della tabella intera, `roster` non conosceva le bande, e la suite
partiva da **225** test. `CLAUDE.md` diceva 18,5% di celle corrette e la Fase 2A-bis "non ancora
pianificata".

Non essendo possibile costruire 2B e 3 su un'estrazione al 18,5%, **ho implementato prima la Fase
2A-bis** (ritaglio a bande, estrazione per banda, persistenza incrementale) e poi 2B e 3 sopra di
essa. È la scelta conservativa: l'architettura del job lungo, l'avanzamento per bande e la
dichiarazione dei buchi richiesti dal brief non hanno senso senza le bande.

## Commit

| Hash | Tema |
|---|---|
| `9e31215` | `ingest`: ritaglio a bande (`planBands`, `cropRosterBands`) e anteprima dei tagli |
| `ca68d63` | `extract`: una chiamata per banda, pausa, retry, `failures` |
| `0856fac` | Prisma: `RosterBand`, `ColumnAlias`, `Assignment`, geometria e battito su `Roster` |
| `16a5b1d` | `roster`: job fuori dalla richiesta HTTP, ripresa dopo riavvio, lock di scrittura |
| `affbb72` | `review`: griglia, alias di colonna, autorizzazione per colonna |
| `2b0eef9` | API: upload, autorizzazione dell'invio all'AI, avanzamento, foto, anteprima |
| `9276018` | `review`: il buco si dichiara per colonna e giorni, non per indice di banda |
| `b0f0699` | UI: caricamento, vista dell'estrazione, griglia di conferma da telefono |
| `22fb690` | Retention delle foto collegata davvero + aggiornamento di `CLAUDE.md` |
| `785bf9a` | UI: la confidenza arriva all'utente senza guidarne l'attenzione |

## Test

410 test, 37 file, tutti verdi. Aggiunti 185 test rispetto ai 225 di partenza.

I nuovi, per area:

- **`ingest/bands`** (13): geometria pura (numero di bande, contiguità dei confini nominali,
  sovrapposizione, clamp ai bordi, area ridotta, geometrie impossibili rifiutate), ritagli reali con
  `sharp`, anteprima, `imageDimensions`.
- **`extract/bands`** (15): schema di banda (giorno fuori mese, colonna non dichiarata, duplicati),
  prompt del ritaglio, orchestrazione (unione delle colonne, `onBand` per il salvataggio
  incrementale, banda illeggibile che non ferma le altre, pausa fra bande e non dopo l'ultima,
  `retry-after` onorato, troncamento non riprovato, provider di riserva, raw output conservato).
- **`roster/bands-repository`** (24): `prepareExtraction` idempotente, `pendingBands`,
  `saveBandCells` (codici risolti, celle vuote scartate, battito, conflitti fra bande, rilettura che
  non duplica), `markBandFailed`, `finishExtraction` (`extracted`/`partial`/`failed`),
  `reclaimStaleExtractions`, `resumableRosters`, `rosterProgress`, `withWriteLock`.
- **`roster/job`** (13): niente chiamate al provider senza autorizzazione, estrazione completa,
  `partial` con banda dichiarata mancante, **ripresa che richiama il provider solo sulle bande
  mancanti**, foto assente (retention) che diventa guasto dichiarato, geometria mancante che non
  viene indovinata, mese di 30 giorni che rifiuta il giorno 31, retention a ogni giro del worker,
  single-flight del worker.
- **`roster/form`** (8): validazione del modulo di caricamento, virgola decimale compresa.
- **`review/access`** (14) e **`review/grid`** (17): chi vede cosa; una riga per giorno anche vuota,
  febbraio con 28 righe, notte che finisce il giorno dopo, codice sconosciuto senza orario
  inventato, **confidenza bassa che non evidenzia**, stato della conferma e riconferma.
- **`review/repository`** (26): alias (associazione, riassociazione, ignora, libera), autorizzazione
  in lettura, conferma (codice sconosciuto rifiutato, **infermiera respinta sulla colonna di
  un'altra**, **referente respinta sulla colonna di un'altra**, riconferma che aggiorna),
  disconferma che conserva `eventId`, tabelle riesaminabili.
- **`review/holes`** (13): copertura per colonna e giorni, colonne di servizio riconosciute,
  descrizione onesta quando i nomi non si conoscono.
- **`app/rosters/routes`** (19): 401/403/303 sull'upload, sull'autorizzazione dell'invio,
  sull'avanzamento, sulla foto e sull'anteprima.
- **`app/rosters/actions-auth`** (15): le stesse autorizzazioni al livello delle server action.

## L'estrazione lunga fuori dalla richiesta HTTP

Il vincolo: ~50 s di pausa fra le bande e 10-14 bande per tabella, cioè **10-20 minuti**.

Il flusso è in tre atti separati, e la separazione è deliberata:

1. **`POST /api/rosters`** — normalizza la foto (auto-rotate EXIF, resize), la salva sul volume,
   crea la `Roster` in stato `uploaded` e **risponde subito** con un 303. Nessuna chiamata all'AI:
   `requestedAt` è `null`. È una route e non una server action perché una foto da telefono supera
   il limite di 1 MB che Next impone al corpo di una server action.
2. **`POST /api/rosters/[id]/extract`** — è l'atto esplicito della referente (regola invariante 9).
   Calcola quante bande servono, scrive `requestedAt`, crea le righe `RosterBand` in stato
   `pending`, sveglia il worker **senza attenderlo** e risponde 303. Prima di questo passo la
   pagina le mostra i tagli disegnati sulla foto: guarda dove taglieremo, poi decide.
3. **il worker** — `ensureExtractionWorker()`, single-flight in-process. Per ogni tabella
   autorizzata con bande mancanti: ritaglia solo quelle, chiama il provider una banda alla volta,
   e **dopo ogni banda** salva (`saveBandCells`) o dichiara il fallimento (`markBandFailed`),
   aggiornando `heartbeatAt`. Al termine `finishExtraction` mette `extracted`, `partial` o `failed`
   in base a quante bande sono `done`.

La coda è la tabella `RosterBand`: nessuna coda esterna, nessuna dipendenza nuova. Tutte le
scritture passano da `withWriteLock`, una coda di promesse in-process, perché SQLite non gestisce
scritture concorrenti; le estrazioni girano in serie anche per il tetto di token al minuto.

La pagina mostra l'avanzamento (`bandsDone` su `bandsTotal`) e si aggiorna da sola interrogando
`GET /api/rosters/[id]/progress` ogni 6 secondi; ridisegna solo i numeri e chiede a Next di rifare
la pagina quando lo **stato** cambia.

### Se il processo si riavvia a metà

Le bande già lette sono su SQLite, quindi non si perde nulla di ciò che era stato letto.

Una `Roster` resta però in `extracting` con un `heartbeatAt` che non avanza più.
`reclaimStaleExtractions(now, EXTRACTION_STALE_MS)` — default 10 minuti, largo perché una banda fra
pausa, retry e chiamata può prendere qualche minuto — la porta a **`interrupted`**, uno stato da cui
si riprende. Il worker rilegge `resumableRosters()` (stato `extracting` o `interrupted`,
`requestedAt` non nullo, almeno una banda non `done`), `pendingBands()` dice quali bande mancano, e
solo quelle vengono ritagliate e rilette: c'è un test che verifica che il secondo giro chiami il
provider **una sola volta** su due bande, quella che mancava.

Il worker viene svegliato da `GET /rosters` (elenco delle tabelle) e dalla route dell'avanzamento:
il primo che apre l'app dopo un riavvio fa ripartire l'estrazione, senza job pianificato da tenere
in vita e senza che nessuno debba ricordarsene. Chi guarda la tabella interrotta vede comunque un
bottone **"Riprendi adesso"**, perché uno stato bloccato senza via d'uscita è un vicolo cieco.

Una tabella **senza** `requestedAt` non viene mai ripresa: un riavvio non può far partire l'invio di
una foto che nessuno ha autorizzato. E una banda che continua a fallire non manda il worker in
ciclo: `finishExtraction` porta la tabella a `partial`, che non è fra gli stati riprendibili — si
riprova solo su richiesta esplicita.

## Come garantisco che un'infermiera non veda né confermi la colonna di un'altra

Due autorizzazioni distinte, entrambe lato server, entrambe testate.

**Vedere.** `visibleColumns(user, columns, aliases)`: la referente vede tutte le colonne non
ignorate, un'infermiera solo quelle il cui `ColumnAlias.userId` è il suo. Il confronto passa sempre
dalla forma normalizzata del nome. La pagina di conferma non si fida del parametro
`?colonna=`: se la colonna richiesta non è fra le visibili ricade sulla prima visibile, e se
l'utente non ne ha nessuna vede un messaggio, non una griglia. La griglia costruita è **solo** quella
della colonna scelta (`buildColumnGrid` filtra per etichetta). Gli avvisi sui buchi non nominano mai
altre colonne a chi non è referente.

**Confermare.** `requireOwnColumn` pretende che `ColumnAlias.userId === user.id`, e vale **anche per
la referente**: una colonna non associata a nessuno non si conferma, e nessuno conferma per un
altro. Motivo: la referente che confermasse la colonna di un'infermiera metterebbe eventi sul
calendario di quella persona senza il suo consenso, contro la regola invariante 1. Questa è la
scelta conservativa che ho preso: la referente vede tutto in sola lettura, e nella sua vista il
bottone "Confermo" semplicemente non compare, con una riga che spiega perché.

Le due strade per arrivare a una scrittura sono chiuse entrambe: il modulo `review` (test:
un'infermiera e una referente respinte sulla colonna di un'altra, senza scrivere nulla) e le server
action (test: stesse due respinte con redirect e `Assignment.count() === 0`). Anche l'upload,
l'autorizzazione dell'invio all'AI, la foto e l'anteprima dei tagli sono chiusi nelle route:
un'infermiera riceve 403, non un redirect, e non si crea nulla — la foto contiene i turni di tutte
le colleghe.

Una `Roster` in `extracting` non compare nemmeno nell'elenco di un'infermiera: confermare una
colonna a metà significherebbe confermare dei buchi.

## Come si presentano le bande non lette all'utente

Il principio: **un buco si dichiara per colonna e per giorni, mai per indice di banda.** Un
"15 celle su 30 non lette" su una banda che conteneva `AIUTO POM.` e `TOT M` fa spaventare
un'infermiera che ha tutti i suoi turni, e le insegna a ignorare l'avviso — che è il danno peggiore,
perché la volta che serve nessuno guarda.

**All'infermiera, nella sua griglia:** il buco è l'elenco dei **giorni della sua colonna** senza
turno letto — «3 giorni senza turno letto in questa colonna: 4, 12, 19. Può voler dire che sulla
tabella la casella era vuota, oppure che quel giorno non è stato letto: controllalo con la referente
prima di fidarti». Ogni giorno vuoto è comunque una riga visibile nella griglia, marcata «nessun
turno letto»: un giorno saltato non scompare dall'elenco. Se la sua colonna è completa ma altre
parti della tabella non sono state lette, la riga è tranquilla e muta: «alcune parti della tabella
non sono state lette, ma questa colonna risulta completa per tutti i giorni del mese». Se invece una
banda non letta ha nominato in passato proprio la sua colonna, l'avviso è esplicito.

**Alla referente, nella vista dell'estrazione:** due sezioni.

- *Colonne lette*: per ogni colonna, «CRISTINA — 31 giorni, completa» oppure «mancano i giorni
  3, 17». Le colonne di servizio sono marcate «colonna di servizio» e **non entrano nel conteggio
  degli allarmi**; il badge in testa conta solo le colonne di persone incomplete.
- *Parti non lette*: una voce per banda non letta, raccontata con i nomi che si conoscono e non con
  gli indici:
  - se quella banda aveva restituito intestazioni: «le colonne CRISTINA non sono state lette»;
  - se le colonne note sono tutte di servizio: «le colonne di servizio TOT M, TOT P non sono state
    lette: non sono turni di nessuno», in grigio e non in rosso;
  - se la banda non ha mai restituito intestazioni: **non si inventa un elenco** — «un gruppo di
    colonne fra CRISTINA e MERY non è stato letto», oppure «dopo MERY», «prima di CRISTINA», o
    «nessuna colonna di questa parte della tabella è stata letta» quando non si sa nulla. In questo
    caso `serviceOnly` resta `false`: nel dubbio si dichiara il buco, non si tace.
  - il motivo del fallimento resta scritto sotto, per lei.

Accanto, i conteggi che contano davvero: turni letti, letture completate, **correzioni a penna**,
letture discordanti fra bande, codici sconosciuti. E un bottone «Riprova le letture che mancano».

**Cosa evidenzia la griglia, e cosa no.** Correzioni a penna, conflitti fra bande sovrapposte,
codici sconosciuti e codici della legenda ancora `needsReview`. **Non** la confidenza bassa: nella
misura reale nessuna cella su 519 stava sotto 0,8 ed entrambe le sbagliate erano dichiarate con
confidenza alta, mentre il rilevamento delle correzioni a penna ha richiamo 100%. La confidenza
arriva comunque fino alla UI (regola invariante 5) come riga discreta quando è davvero bassa, ma non
guida l'attenzione. C'è un test che fissa questa scelta, perché è controintuitiva e qualcuno
"aggiusterebbe" volentieri.

## Scelte conservative prese dove il design era ambiguo

1. **La geometria delle bande la dichiara la referente, non l'AI.** Nessun riconoscimento
   automatico dei bordi: al caricamento indica quante colonne ha la tabella (con i valori
   dell'ultimo caricamento già proposti), e al passo successivo **vede i tagli disegnati sulla
   foto** prima di autorizzare qualsiasi invio. Se non coincidono con le righe della tabella,
   ricarica cambiando il numero. In alternativa avrei speso una chiamata AI per leggere le
   intestazioni, ma sarebbe stato un invio della foto prima del consenso.
2. **Una banda per colonna** (`columnsPerBand: 1`, modificabile): è la geometria più vicina
   all'esperimento riuscito (30 celle per ritaglio). Alzarla accorcia l'attesa e peggiora la
   lettura; il campo è nel ritaglio avanzato con l'avvertenza scritta.
3. **Bande sovrapposte** (35% di colonna per lato): una colonna tagliata a metà da un taglio
   imperfetto resta intera nella banda vicina. Quando due bande leggono la stessa cella in modo
   diverso **vince la prima**, deterministicamente, e l'altra lettura resta scritta accanto e la
   cella è marcata `conflicted`: la confidenza non può fare da arbitro.
4. **La referente non conferma per altri** (vedi sopra).
5. **Un codice sconosciuto non si conferma**: rifiutato con il motivo, e la referente lo risolve
   dalla legenda senza rileggere la tabella. Non si inventa un orario (regola invariante 4).
6. **Togliere una conferma conserva `eventId`**: l'assegnazione torna `draft` invece di essere
   cancellata, così il modulo `calendar` sa ancora quale evento aveva creato lui (regola
   invariante 2).
7. **La foto e l'anteprima sono solo della referente.** Un'infermiera non le scarica: vedrebbe i
   turni di tutte.
8. **`Assignment` segue lo schema del design** (con l'aggiunta di `columnLabel`, per la
   provenienza): è il contratto con il modulo `calendar`, in lavorazione in parallelo. Non ho
   toccato `src/modules/calendar/`.

## Preoccupazioni residue

1. **La geometria delle bande non è mai stata provata su una foto vera dall'interfaccia.** I test
   usano immagini sintetiche; l'anteprima dei tagli esiste proprio perché la prima cosa da fare, con
   la foto di agosto in mano, è guardare se le righe rosse cadono sulle righe della tabella. Se non
   ci cadono, i valori da correggere sono `columnCount` e il ritaglio avanzato. **Questa è la
   verifica manuale più urgente prima di usare il sistema sui turni veri.**
2. **`npm run eval` non è stato aggiornato alla strategia a bande** e continua a misurare la tabella
   intera (18,5%). Non l'ho eseguito: chiama il provider reale e consuma token. Misurare
   l'estrazione a bande sulle due foto di fixture è il passo che darebbe il numero vero.
3. **Il worker vive nel processo dell'app.** Se nessuno apre l'app, un'estrazione interrotta resta
   interrotta finché qualcuno non la apre. Per una foto al mese è accettabile e volutamente semplice
   (nessuna coda, nessun cron), ma è una scelta, non un caso.
4. **`ColumnAlias.label` è unico globalmente**, non per reparto. Due reparti con una `CRISTINA`
   diversa collidono. Fuori scope oggi (un solo reparto), ma va detto.
5. **Il conflitto fra bande "vince la prima"** è deterministico ma arbitrario: la cella è marcata ed
   evidenziata, quindi il rimedio è l'occhio umano. Non c'è modo, oggi, di scegliere l'altra lettura
   dall'interfaccia se non correggendo il codice in legenda o rileggendo.
6. **La modifica manuale di una cella non esiste.** Se il modello ha letto `M` dove c'era `P`,
   l'utente può solo non confermare quel giorno: non può correggerlo. È il buco funzionale più
   grosso che resta, e per un uso reale la settimana prossima potrebbe pesare. Non l'ho aggiunto
   perché non era nel brief e perché una correzione a mano richiede di decidere chi può correggere
   che cosa (la referente sulla tabella? l'infermiera sulla propria colonna?) — è una domanda per il
   proprietario, non da indovinare.
7. **Nessuna paginazione né limite sull'elenco delle tabelle.** Con una foto al mese, per anni, non
   è un problema.
8. **`hookTimeout` di Vitest alzato a 120 s** (`vitest.config.mts`): `createTestDb` lancia
   `npx prisma migrate deploy` in un processo figlio e su questa macchina il default di 10 s faceva
   cadere sette file di test su una suite altrimenti verde. È una correzione d'ambiente, non
   funzionale.
9. **Il client Prisma è condiviso fra i worktree.** Ho eseguito `npx prisma generate` e la suite
   intera dopo la migrazione, e sono verdi; ma se un altro implementer rigenera da uno schema più
   vecchio, i campi aggiunti qui (`RosterBand`, `ColumnAlias`, `Assignment`, la geometria su
   `Roster`) spariscono dal client. La cura è `npx prisma generate`, e la trappola è ora scritta in
   `CLAUDE.md`.
10. **Lo stato di partenza del worktree non corrispondeva al brief** (nessuna estrazione a bande,
    225 test invece di 441, accuratezza 18,5% invece di 99,6%). Ho colmato la differenza
    implementando anche la Fase 2A-bis. Se quel lavoro esiste già su un altro branch, la fusione
    andrà fatta a mano: i punti di contatto sono `src/modules/ingest/bands.ts`,
    `src/modules/extract/bands.ts` e lo schema Prisma.
