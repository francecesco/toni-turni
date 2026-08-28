# Fase 4 — Sync con Google Calendar

- **Data:** 2026-08-28
- **Branch:** `worktree-agent-a9dc6036630332ff6`
- **Stato:** completata. Modulo `src/modules/calendar/` con interfaccia pubblica in `index.ts`,
  `npm test` verde, `npm run lint` (eslint + `tsc --noEmit`) verde.

## Commit

| Hash | Tema |
|---|---|
| `83a2096` | `chore(test)`: alza `hookTimeout` di Vitest per le fixture di database |
| `f37a59d` | `feat(calendar)`: shiftKey, costruzione degli eventi, motore di diff (tutto puro) |
| `a0362d4` | `feat(calendar)`: client Calendar API, calendario dedicato, coda di sync |
| `29576e8` | `feat(auth,db)`: modello `Assignment` + migrazione, client Google per utente, scope |
| `b1a1c5e` | `feat(calendar)`: orchestrazione `syncRoster` e interfaccia pubblica |
| _(questo)_ | `docs`: stato in CLAUDE.md, checklist di verifica manuale, questo rapporto |

## Test

`npm test`: **364 test verdi, 39 file** (la base prima della Fase 4 era 225 in 26 file; i test di
questa fase sono **139**, su 13 file nuovi — 11 in `tests/modules/calendar/`, 2 in
`tests/modules/auth/` — più due casi aggiunti a `tests/modules/roster/repository.test.ts`).

Tutti i test di questa fase parlano con Google **mockata**: `CalendarTransport` (un'interfaccia con
un solo metodo `request`) per il client HTTP, e un calendario Google finto in memoria per
l'orchestrazione. Nessuna chiamata di rete, nemmeno accidentale: il finto registra ogni chiamata e
diversi test asseriscono che l'elenco sia **vuoto**.

Una nota sulla base di partenza: il compito indicava 441 test, la suite ne contava 225 (26 file) e
17 di questi fallivano su questa macchina. Il guasto non era nel codice: ogni file che tocca il
database esegue `npx prisma migrate deploy` dentro `beforeAll`, e con otto file in parallelo il
limite predefinito di 10 s per gli hook scadeva. È il primo commit, `83a2096`, isolato per non
mescolarlo con la feature.

### Come garantisco l'idempotenza

Tre meccanismi, tutti coperti da test.

1. **Il confronto avviene sugli istanti, non sulle stringhe.** È il punto in cui l'idempotenza si
   rompe per davvero: noi mandiamo `{ dateTime: '2026-10-24T21:00:00', timeZone: 'Europe/Rome' }`,
   Google restituisce `'2026-10-24T21:00:00+02:00'`, e nella notte del cambio d'ora l'inizio ha
   offset `+02:00` e la fine `+01:00`. Confrontando il testo ogni evento risulterebbe diverso a
   ogni giro e il sync riscriverebbe l'intero mese ogni volta. `sameEvent` normalizza entrambi i
   lati in millisecondi (con `wallClockToUtc` di `lib/time` sul nostro lato) e confronta quelli;
   gli eventi tutto il giorno si confrontano sulle date. Test: *«la notte del cambio ora legale
   resta identica al secondo giro»*, *«lo stesso orario espresso in un altro fuso non è una
   differenza»*.
2. **Il diff si calcola su `shiftKey`,** non sull'`eventId` memorizzato: anche se l'anagrafica
   locale si perdesse, il sync ritroverebbe i propri eventi dal calendario. Un `shiftKey` con due
   eventi (il residuo tipico di un sync interrotto a metà) fa sopravvivere il primo in ordine
   deterministico e cancellare gli altri: eseguire il sync due volte **ripara** i doppioni invece
   di aggiungerne. Test: *«ripara un doppione rimasto da un sync interrotto»*.
3. **Un turno identico produce il passo `keep`,** che non chiama Google e non scrive su SQLite se
   l'`eventId` era già allineato. Test end-to-end: *«eseguito due volte non produce nessuna
   scrittura la seconda volta»* — 3 scritture al primo giro, 3 in totale dopo il secondo, e
   l'esito `{ created: 0, updated: 0, deleted: 0, unchanged: 3 }`.

Al livello del client, `deleteEvent` tratta un 404/410 come successo: un evento già scomparso non
deve far fallire un sync ripetuto.

### Come garantisco che non si tocchi un evento senza `shiftKey`

Quattro barriere indipendenti, dalla più a monte alla più a valle.

1. **Filtro all'ingresso del diff.** `planSync` accetta un evento nel piano solo se
   `extendedProperties.private.shiftKey` esiste, si **parsifica** in modo stretto
   (`<userId>:<YYYY-MM-DD>`, con la data che deve esistere davvero — `2026-02-30` non passa) e
   appartiene **a questo utente**. Tutto il resto viene contato in `foreignEvents` e lasciato dov'è.
   Un `shiftKey` di `utente10` non viene confuso con quello di `utente1`: il confronto è sul campo
   parsificato, non su un prefisso di stringa.
2. **Filtro sulla finestra.** Un nostro evento la cui data cade fuori dal mese sincronizzato viene
   contato in `outOfWindowEvents` e non toccato. Serve perché `events.list` restituisce anche gli
   eventi che *sconfinano* nella finestra: la notte del 31 luglio, o un tutto-il-giorno del 1°
   settembre. Senza questo filtro il sync di agosto cancellerebbe eventi di luglio.
3. **Verifica nell'orchestrazione.** Prima di ogni cancellazione, `applyPlan` ricontrolla
   `belongsTo(step.shiftKey, userId)`.
4. **Verifica finale nel client, sull'evento riletto.** `api.deleteEvent` fa un `GET` dell'evento e
   si rifiuta di cancellarlo se non porta un `shiftKey` (o se ne porta uno di un altro utente,
   quando gli si passa `expectedUserId`). È la barriera che intercetta anche una corsa: fra il
   piano e la cancellazione l'evento potrebbe essere stato modificato. Costa una `GET` per
   cancellazione, che su questo carico non è nulla.

In più, **nessuna scrittura può finire sul calendario principale**: `insertEvent`, `patchEvent` e
`deleteEvent` rifiutano `calendarId === 'primary'` e un `calendarId` vuoto *prima* di toccare la
rete, e `resolveDedicatedCalendar` non restituisce mai `primary`. Lo scope richiesto a Google è
`calendar.app.created`, che a livello di API dà accesso **solo** ai calendari creati dall'app.

## Casi limite testati

| Caso | Dove | Esito atteso, verificato |
|---|---|---|
| **Notte a cavallo della mezzanotte** | `event.test.ts`, `sync.test.ts` | `NOTTE` del 10 agosto → inizio `2026-08-10T21:00`, fine `2026-08-**11**T07:00`, fuso `Europe/Rome`, nessun offset fisso nella stringa |
| **Ora legale, ottobre** | `event.test.ts`, `diff.test.ts` | La notte del 24 ottobre 2026 dura **11 ore** reali; al secondo sync resta `keep` malgrado i due offset diversi |
| **Ora legale, marzo** | `event.test.ts` | La notte del 28 marzo 2026 dura **9 ore** reali |
| **Finestra del mese sul cambio d'ora** | `window.test.ts` | Marzo 2026: `timeMin` a `+01:00`, `timeMax` a `+02:00`. Ottobre: il contrario |
| **Giornata lunga `M/P`** | `event.test.ts` | **Un solo** evento 07:00 → 21:00, non due |
| **`SN`, `RP`, `RIP`, `F`, `ASS`** | `event.test.ts` | Eventi tutto il giorno con fine esclusiva al giorno dopo, e `transparency: transparent` (non fanno sembrare occupata la giornata). I turni di lavoro restano `opaque` |
| **Codice sconosciuto** | `event.test.ts`, `sync.test.ts` | Non si sincronizza, non blocca gli altri, e **non fa cancellare** l'evento già presente per quel giorno |
| **Codice in legenda ma `kind: unknown`** | `event.test.ts` | Come sopra |
| **Turno non confermato** | `sync.test.ts` | Nessuna scrittura; se un evento esisteva già, **resta** (contato in `protectedEvents`) |
| **Giorno inesistente** (riga 31 in un mese di 30) | `event.test.ts` | Saltato con motivo `data_non_valida`, non trasformato nel 1° del mese dopo |
| **Due turni per lo stesso giorno** | `event.test.ts` | Vince il primo, il secondo è saltato: un solo evento per `shiftKey` |
| **Evento personale nel calendario dedicato** | `diff.test.ts`, `sync.test.ts` | Mai toccato, contato a parte e riportato nell'esito |
| **`shiftKey` malformata o di un altro utente** | `diff.test.ts`, `api.test.ts` | Mai toccato |
| **Consenso revocato** | `sync.test.ts`, `api.test.ts` | `GoogleAccount.status = needs_reauth`, esito leggibile, e il ciclo si interrompe invece di collezionare lo stesso errore su ogni turno |
| **Guasto su un singolo evento** (403 quota) | `sync.test.ts` | Gli altri turni si sincronizzano, il turno fallito va in `syncState: failed` con il messaggio, l'esito è `ok: false` |
| **Autorizzazione** | `policy.test.ts`, `sync.test.ts` | Un'infermiera che chiede la colonna di un'altra non produce **nessuna** chiamata; la referente può |
| **Due sync sovrapposti** | `lock.test.ts` | Serializzati in una coda unica |

## Decisioni conservative prese dove il design era ambiguo

Sono cinque, tutte nella direzione «meglio non fare che disfare». Vanno riviste se l'uso reale le
smentisce.

1. **`googleapis` non esiste in questo repository** — il design e CLAUDE.md lo nominavano, il
   vincolo diceva «c'è già», ma né `package.json` né `node_modules` lo contengono. Ho scritto il
   client su `OAuth2Client` di `google-auth-library` (già presente, e già capace di rinnovare
   l'access token e ritentare la richiesta): sette chiamate HTTP, nessuna dipendenza nuova, niente
   decine di megabyte di client generato su una ZimaBoard. `CLAUDE.md` è stato corretto.
2. **Un codice sconosciuto non fa cancellare l'evento già presente.** «Un codice `unknown` non si
   sincronizza» l'ho letto alla lettera: non si sincronizza *in nessuna direzione*. L'alternativa
   (cancellare, perché un turno che non sappiamo leggere non dovrebbe restare a calendario) è
   difendibile — un orario sbagliato sul telefono di un'infermiera è peggio di un buco — ma è
   irreversibile, e la griglia di conferma segnala già il codice ignoto. **Da rivedere con il
   proprietario:** se preferisce il buco al dato vecchio, è una riga in `event.ts`.
3. **Una tabella senza nessuna `Assignment` fa rifiutare il sync** invece di svuotare il mese. Con
   la Fase 3 ancora da fare, un sync lanciato prima della conferma avrebbe cancellato tutto ciò che
   c'era. Effetto collaterale accettato: se un mese diventa legittimamente vuoto per un'utente, i
   suoi eventi vecchi vanno rimossi a mano.
4. **Un turno tornato in bozza protegge il proprio evento.** Serve alla Fase 5 (re-upload con
   riconferma parziale): una nuova versione parzialmente confermata non deve svuotare il calendario
   dei giorni non ancora rivisti.
5. **La referente può sincronizzare la colonna di un'altra**, come dice la regola 6 del design. Non
   allarga di nulla *cosa* viene scritto: si scrive solo ciò che l'intestataria ha confermato, e si
   scrive sul calendario di lei con il token di lei. Se anche questo dà fastidio, la restrizione è
   una riga in `policy.ts`.

Due scelte minori, per completezza: gli eventi non portano colore (la legenda ha colori esadecimali,
Google vuole un `colorId` da 1 a 11 — non ho voluto indovinare la corrispondenza) e **non c'è
nessun retry automatico** sulle scritture. Un retry su una `insert` che in realtà era andata a buon
fine creerebbe un doppione; l'utente rilancia il sync e il diff ripara. I 429/5xx finiscono
nell'esito con il messaggio di Google.

## Preoccupazioni residue

1. **Il flusso non è ancora percorribile da capo a fondo, e non per colpa di questa fase.** Manca la
   Fase 3: nessuno crea le righe `Assignment` né le marca `confirmedAt`. Il modulo `calendar` è
   pronto e testato, ma finché la griglia di conferma non esiste, `syncRoster` si può invocare solo
   da uno script con dati inseriti a mano. **Se l'obiettivo è usare il sistema la settimana
   prossima, la Fase 3 è il pezzo critico rimasto** — insieme alla Fase 2A-bis, dato che
   l'estrazione a tabella intera è ancora al 18,5%.
2. **Il consenso Google va rifatto.** Ho aggiunto lo scope `calendar.app.created`, indispensabile
   per creare il calendario dedicato (`calendar.events` da solo risponde 403 alla creazione). Chi
   aveva già acconsentito deve revocare l'accesso da myaccount.google.com/permissions e riaccedere.
   Dato che secondo CLAUDE.md l'OAuth reale non è mai stato eseguito, oggi non c'è nessun token
   installato da invalidare.
3. **Niente di tutto questo ha ancora parlato con Google davvero.** I test coprono la logica e la
   forma delle richieste, non il comportamento del servizio: i nomi esatti dei campi accettati da
   `calendars.insert`, il fatto che `calendar.app.created` basti per `calendarList.list`, la forma
   reale di un `invalid_grant`. Ho aggiunto a `docs/verifica-manuale-oauth.md` una checklist di
   nove passi per la Fase 4, da eseguire **con l'account di prova** prima di toccare il calendario
   di tua moglie. Il passo 4 (rilanciare il sync senza cambiare niente e vedere zero movimenti) è
   quello che vale doppio.
4. **`calendar.events` è ancora fra gli scope richiesti** (lo prevedeva il design) e dà accesso agli
   eventi di *tutti* i calendari, più di quanto serva. Il codice non lo usa: `calendar.app.created`
   basta a tutto ciò che facciamo. Si potrebbe togliere per ridurre i permessi, ma preferisco che
   la verifica manuale confermi prima che tutto funzioni con il solo scope ristretto: se lo togliessi
   adesso e mi sbagliassi, il sync non funzionerebbe la settimana in cui deve funzionare.
5. **`Assignment` la ho definita io, ma la Fase 3 la possiede.** Ho aggiunto solo ciò che il sync
   deve leggere e scrivere (`confirmedAt`, `eventId`, `syncState`, `syncError`, `syncedAt`) seguendo
   la bozza del design. Se la griglia di conferma avrà bisogno di altro (per esempio la traccia di
   quale cella ha generato l'assegnazione), è una migrazione additiva.
6. **`ColumnAlias` non esiste ancora** — è il mapping colonna → utente, e appartiene alla Fase 3. Il
   sync non ne ha bisogno perché parte da `Assignment.userId`.
7. **Un evento riscritto a mano dall'utente viene riportato alla versione dell'app** al primo sync
   utile: sul dedicato l'app è la fonte di verità. La descrizione dell'evento e del calendario lo
   dicono in italiano, così la cosa non sorprende nessuno.
8. **`node_modules` è condiviso fra i worktree di questa sessione,** quindi il client Prisma
   generato è una risorsa contesa: due volte i test sono caduti perché un altro agente lo aveva
   rigenerato dal proprio schema. La cura è `npx prisma generate` e si riparte. Ogni commit di
   questa fase è stato fatto dopo un `generate` seguito dalla suite intera verde.
