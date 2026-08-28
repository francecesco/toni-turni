# Fusione delle Fasi 2B e 3 in `feat/fase-2a-bis-ritagli`

## Stato

**Completata.** Suite verde, lint pulito, build riuscita, `git status` pulito,
`npx prisma migrate deploy` verificato da un database vuoto.

| | |
|---|---|
| ramo | `feat/fase-2a-bis-ritagli` |
| partenza | `709870b` (615 test) |
| ramo fuso | `worktree-agent-acb2681d947049caf` a `74dc65a`, base `9afa4ab` |
| commit di fusione | `f0dcf62` |
| identità di colonna (difetto a) | `c86ab34` |
| ricollegamento dei chiamanti | `d1fd4be` |
| correzioni a penna in UI (difetto b) | `3b071f8` |
| test | **791 passati, 61 file** (erano 615 su 51) |
| lint | `eslint && tsc --noEmit`: nessun errore, nessun warning |
| build | `npm run build`: riuscita, 19 route |

**Nessuno dei nostri test è caduto.** I 51 file di test che esistevano a `709870b`
oggi contengono 624 test (615 più 9 che il ramo fuso ha aggiunto a
`tests/lib/time.test.ts` e `tests/modules/roster/schema.test.ts`) e passano tutti.

## Cosa è stato cancellato

`src/modules/ingest/bands.ts` (255 righe), `src/modules/extract/bands.ts` (286
righe), `tests/modules/ingest/bands.test.ts`, `tests/modules/extract/bands.test.ts`
e le aggiunte a `src/modules/extract/prompt.ts` che servivano solo a loro. Git non
aveva segnalato **nessun** conflitto su questi file: hanno nomi diversi dai nostri.

## Che cosa ho dovuto ricollegare, e come

### Il job (`src/modules/roster/job.ts`)

Il loro job chiedeva al database la geometria dichiarata dalla referente
(`columnCount`, `columnsPerBand`, `dayColumnFraction`, `area*`), poi
`imageDimensions` + `planBands(geometry)` + `cropRosterBands(image, plans)`.

Ora chiama `cropRosterBands(image, { daysInMonth })`: rilevamento del riquadro,
omografia, confini di colonna ripuliti, bande. **La geometria non si chiede più a
nessuno** — è sparita dal modulo di caricamento, dal database e dalle env.

Il pezzo più delicato: la nostra `extractRosterByBands` prende tutte le bande e
restituisce l'esito alla fine, mentre la loro aveva un gancio `onBand` con cui il
job persisteva ogni banda appena letta. Non l'ho copiato dentro (vedi la sezione
seguente): il job chiama `extractRosterByBands` **una banda per volta** e salva
fra una chiamata e l'altra. Così si tengono entrambe le cose:

- la fusione, lo scarto delle colonne di servizio e del nome del reparto, e il
  conteggio delle celle attese restano i nostri, invariati;
- la persistenza per banda su `RosterBand` resta la loro, che è quello che rende
  ripartibile un lavoro da venti minuti.

Il distanziamento è **un solo** `createTokenPacer` per tutto il job, passato anche
a `extractRosterByBands` così che il ritentativo su un 429 usi lo stesso orologio.
Il job lo chiama fra una banda e l'altra, mai prima della prima (test:
«distanzia le chiamate fra una banda e l altra, e non prima della prima»).

### L'autorizzazione separata dal piano delle bande

La route `POST /api/rosters/[id]/extract` non può pianificare le bande: quel piano
costa un rilevamento sulla foto, cioè secondi dentro una richiesta HTTP. Registra
`requestedAt` con `prepareExtraction(id, [], now)` e risponde; il piano lo fa il
job alla prima passata.

Questo apriva una finestra nuova: una tabella autorizzata e **senza bande** non
era riprendibile, e un riavvio dentro quella finestra l'avrebbe lasciata ferma per
sempre — il vicolo cieco da cui `interrupted` esiste per uscire. `resumableRosters`
ora raccoglie anche quel caso (`bands: { none: {} }`). La route mantiene lo `stat`
sulla foto (`rosterImageExists`): autorizzare un invio impossibile lascerebbe solo
un guasto da capire.

### I buchi per colonna **e giorni**

Le nostre bande coprono **mezzo mese** ciascuna, le loro coprivano il mese intero.
`describeUnreadBands` avrebbe detto a una collega «la tua colonna non è stata
letta» anche quando le mancava solo la seconda metà del mese: un allarme che
spaventa a vuoto insegna a ignorare l'unico avviso che difende dai turni che
scompaiono. `RosterBand` porta ora `dayFrom`/`dayTo` e la descrizione li dice.

Aggiunto lo stato di banda `partial`: una banda letta a metà (il nostro
`countBandCells`) tiene le celle lette **e** resta un buco dichiarato, invece di
scegliere fra buttare le celle e dichiarare la banda completa.

### L'anteprima dei tagli

Nuovo `src/modules/ingest/preview.ts` (`previewOverlaySvg` puro +
`renderRosterPreview`), scritto in TDD, 8 test. Disegna sul riquadro
**raddrizzato** i confini di colonna **ripuliti** e la cucitura fra le due metà
del mese, prendendoli da `planBands` — gli stessi numeri che taglieranno le bande.
Se anteprima e ritagli potessero divergere, l'anteprima non verificherebbe niente.

### Altro

- `parseUploadForm` chiede solo anno, mese e reparto;
- `.env.example`: via `AI_BAND_PAUSE_MS` e `BAND_OVERLAP_FRACTION` (la pausa la
  calcola il pacer sul peso misurato di una banda, la sovrapposizione è misurata
  in `layout.ts`), documentato `GROQ_MAX_OUTPUT_TOKENS`;
- `vitest.config.mts`: la nostra versione, come da politica;
- `CLAUDE.md`: banner unico che dichiara 1, 2A, 2A-bis, 2B, 3 e 4, e dice cosa
  resta (il bottone che lancia il sync, il diff fra versioni, la rifinitura UI) e
  le tre verifiche in sospeso sulla macchina vera.

## Funzioni dei duplicati che la nostra pipeline non ha

Due, e nessuna delle due è stata copiata dentro.

1. **`onBand`**, il gancio per persistere una banda appena letta. Adattato il
   chiamante: il job guida il ciclo e chiama `extractRosterByBands` una banda per
   volta (sopra). Resta un piccolo costo: il ritaglio delle bande lo si fa per
   tutta la foto anche quando le bande da rileggere sono poche, perché
   `cropRosterBands` non ha un'API per un sottoinsieme. Su una ripresa sono
   qualche secondo di CPU contro venti minuti di attesa: non vale un'API in più.
2. **`renderBandPreview`**, l'anteprima disegnata sulla foto originale a partire
   dalla geometria dichiarata a mano. Il *bisogno* è vero e l'ho tenuto,
   riscritto sulla nostra geometria rilevata (`renderRosterPreview`); la loro
   funzione, che disegna frazioni fisse su una foto non raddrizzata, no.
   `imageDimensions` è sparita con lei: nessun chiamante restava.

## Difetto (a): una quinta nozione di identità di colonna — risolto

`src/modules/review/access.ts` esportava `normalizeLabel` (maiuscolo, spazi
compattati, **punteggiatura tenuta**) e `isNonNurseLabel` (un secondo elenco delle
colonne di servizio, per espressione regolare). Sono spariti: i consumatori
(`aliases`, `confirm`, `grid`, `holes`, la pagina delle colonne, la pagina della
tabella) usano `normalizeColumn` e `isColonnaDiServizio` di `@/modules/extract`.

`isColonnaDiServizio` è stata semplicemente **esportata** da `band-schema.ts`:
nessuna riga di logica della pipeline è stata toccata.

Il comportamento del review cambia, e cambia in meglio:

- **`SARA DP.` e `SARA DP` sono la stessa infermiera.** Con `normalizeLabel` erano
  due colonne da mezzo mese ciascuna: è lo stesso difetto che sul ramo principale
  aveva falsificato la misura. Ora l'alias vale per entrambe le grafie, e in più
  `saveBandCells` **canonizza** l'etichetta della cella su quella già in tabella
  quando l'identità coincide — necessario perché le bande arrivano una alla volta
  e `mergeBandExtractions` canonizza dentro la propria chiamata, non fra chiamate.
  Test: «canonizza l etichetta su quella già scritta quando l identità è la stessa»
  e «la punteggiatura non crea due alias per la stessa infermiera».
- **Trovato e corretto un difetto latente.** `reviewableRosters` confrontava in SQL
  la chiave dell'alias con `RosterCell.columnLabel`, cioè la forma normalizzata
  contro il testo letto dalla foto. Funzionava per caso, finché il foglio è scritto
  in maiuscolo e senza punteggiatura; con le chiavi normalizzate non avrebbe
  trovato mai niente e un'infermiera non avrebbe visto nessuna tabella da
  confermare. Il filtro ora passa in memoria, su poche righe.
- **La chiave di `ColumnAlias` è la forma normalizzata** (`SARADP`, `TOTM`). Non è
  una perdita: quella colonna non era mostrata da nessuna parte nemmeno prima —
  le etichette dell'interfaccia vengono dalle celle — ed è documentato nello schema.
- **Una differenza in meno, non in più:** la loro regex `^TOT\b` catturava un `TOT`
  seguito da qualunque parola, la nostra conosce `TOT M` e `TOT P` (e il prefisso
  `AIUTO`). Una colonna intitolata `TOT N` non verrebbe più *suggerita* come «di
  servizio» nella pagina delle colonne: resterebbe da assegnare, che è uno stato
  che non blocca niente, e la referente la marca in un clic. Su entrambe le foto
  reali esistono solo `TOT M` e `TOT P`. In cambio, il predicato del review e
  quello della fusione non possono divergere.

## Difetto (b): la confidenza come guida alla rilettura — non c'era più

Il loro ultimo commit (`785bf9a`, «confidenza in UI») aveva già corretto il
difetto invece di introdurlo, ed è stato verificato riga per riga:

- `review/grid.ts` costruisce `attentionReasons` su `handCorrected`, i conflitti
  fra bande, i codici sconosciuti, i codici della legenda ancora da confermare e i
  turni cambiati dopo la conferma. **La confidenza non entra**, e c'è il test che
  lo blocca: «NON evidenzia una cella per la confidenza bassa» in
  `tests/modules/review/grid.test.ts`;
- la griglia di conferma mostra la confidenza solo sotto 0,9, come riga grigia
  accessoria (regola invariante 5), senza farne dipendere l'evidenziazione;
- la scheda del risultato non ordina né colora niente per confidenza.

Quello che mancava era **dirlo**: la scheda del risultato contava le correzioni a
penna in mezzo agli altri numeri, senza dire che sono quelle le celle da
rileggere. Aggiunta la frase (`3b071f8`). Nessuna riga che presentasse la
confidenza come «quali celle rileggere» è stata trovata, quindi non c'era niente
da rimuovere.

## Prisma: le migrazioni da un database vuoto

Tutte e sei le migrazioni sono tenute. Due aggiustamenti, perché **componessero**:

1. `Assignment` era creata due volte (la loro `20260828112905`, poi la nostra
   `20260828113351`): la crea una volta sola la nostra, che viene dopo, con
   l'unione dei campi (`columnLabel` loro, `syncError`/`syncedAt` nostri);
2. i campi di geometria dichiarata a mano (`columnCount`, `columnsPerBand`,
   `dayColumnFraction`, `area*`) non si aggiungono più: lo schema non li dichiara,
   e lasciarli avrebbe prodotto una deriva permanente fra schema e database.
   Aggiunti invece `RosterBand.dayFrom`/`dayTo`.

Verificato su un database vuoto:

```
$ DATABASE_URL=file:/tmp/.../turni.db npx prisma migrate deploy
All migrations have been successfully applied.   (tutte e 6)
$ npx prisma migrate diff --from-schema-datasource ... --to-schema-datamodel ...
No difference detected.
$ node prisma/seed.ts                            (via tsx)
Codici turno inseriti: 19
```

Cioè esattamente la sequenza che l'entrypoint del container esegue al primo avvio
sulla ZimaBoard: `migrate deploy` poi seed. `npx prisma generate` rilanciato dopo
ogni operazione sullo schema.

`Assignment.columnLabel` è **facoltativa**. Pretenderla avrebbe rotto i test del
sync della Fase 4, che creano assegnazioni come fixture: è una traccia della
provenienza e nessun codice la legge, quindi renderla obbligatoria non avrebbe
reso più vero niente e avrebbe rotto la rete che protegge la misura del sync.

## Preoccupazioni residue

1. **Il percorso completo non è mai stato percorso su una foto vera
   dall'interfaccia.** È la cosa che conta di più prima della settimana prossima:
   carica una foto, guarda l'anteprima dei tagli, e solo se i tagli cadono sui
   filetti stampati premi «Manda a leggere». Se il rilevamento sbaglia, non dà
   errore: dà ritagli spostati, cioè turni attribuiti alla persona sbagliata.
   L'anteprima esiste per rendere visibile proprio quello.
2. **L'indice di banda è stabile solo finché il rilevamento è deterministico.** La
   ripresa dopo un riavvio si fida del fatto che `cropRosterBands` sulla stessa
   foto produca le stesse bande nello stesso ordine. È vero oggi (nessun
   componente casuale), ma non è **verificato** da un test, e se un giorno il
   rilevamento cambiasse una banda già letta potrebbe corrispondere a colonne
   diverse. Un test che ritaglia due volte la stessa foto e confronta gli
   `spec` chiuderebbe il buco a costo quasi zero.
3. **Nessun bottone lancia il sync della Fase 4.** Il flusso arriva fino alla
   conferma; da lì al calendario si passa solo da codice. È il prossimo pezzo, ed
   è piccolo.
4. **`saveExtraction` e `saveBandCells` sono due strade verso le stesse celle.**
   La prima (con `missingBands` e `conflicts` su `Roster`) la usa solo
   `npm run eval`; la seconda è quella applicativa. Non è un difetto — l'eval deve
   poter salvare in un colpo solo — ma sono due posti dove si risolvono i codici
   con la legenda, e se un giorno divergono lo scoprirà l'eval, non l'utente.
5. **Le trascrizioni di riferimento in `fixtures/` sono ancora
   `"verified": false`.** Il 99,8% vale quanto la trascrizione, che nessuno che
   conosce il reparto ha ancora guardato.
6. **Il worker gira in-process e si sveglia dalle pagine.** Se nessuno apre
   l'elenco delle tabelle o la pagina di avanzamento dopo un riavvio, un'estrazione
   interrotta resta interrotta. È una scelta consapevole del ramo fuso (nessun job
   pianificato da tenere in vita) e per una foto al mese va bene, ma vale saperlo.
