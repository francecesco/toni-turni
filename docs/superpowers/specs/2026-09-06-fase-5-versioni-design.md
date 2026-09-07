# Fase 5 — Versioni della stessa tabella: riporto delle conferme e diff

Data: 2026-09-06. Stato: implementata (piano `docs/superpowers/plans/2026-09-06-fase-5-versioni.md`).

## 1. Il problema

La referente fotografa la tabella del mese una prima volta e, quando in reparto la correggono a
penna, la fotografa di nuovo. Oggi il secondo caricamento crea un `Roster` con `version + 1` e
**tutto ricomincia da zero**: le conferme (`Assignment`) sono legate al `rosterId`, quindi
l'infermiera si ritrova con zero conferme e zero «sul calendario», e deve rileggere e riconfermare
trenta giorni per due celle cambiate. Il design originale (§ flusso, punto 6) prometteva il
contrario: «vengono evidenziate solo le celle cambiate, da riconfermare; le celle identiche restano
confermate».

## 2. Decisioni del proprietario (2026-09-06)

1. L'infermiera vede **solo i giorni cambiati** della propria colonna, non tutta la colonna
   rievidenziata.
2. Un turno già confermato e già sul calendario che cambia nella foto nuova **non torna in bozza**:
   basta un avviso. La regola invariante 1 resta: sul calendario non si scrive il valore nuovo finché
   lei non lo conferma.
3. **Conta solo l'ultima versione.** Le versioni precedenti non sono consultabili dall'interfaccia.
4. Il diff **completo**, di tutte le colonne, lo vede **solo la referente**.

Due decisioni prese in sede di design e comunicate:

5. Se la foto nuova **non contiene la colonna** di una persona (lettura parziale), le sue
   assegnazioni restano sulla versione precedente e lei continua a vedere quella.
6. Un turno **tolto** dal foglio nuovo non sparisce da solo dal calendario: la riga lo dice e offre
   il gesto «Togli dal calendario».

## 3. Le tre strade considerate per il riporto

| strada | come | perché no / perché sì |
|---|---|---|
| **1. Spostare** le assegnazioni sulla versione nuova | `UPDATE Assignment SET rosterId = nuovo` in transazione, quando la nuova lettura è finita | una riga sola per persona e giorno, sempre sull'ultima versione; nessuna migrazione. **Scelta.** |
| 2. Copiarle | due versioni con due copie e lo stesso `eventId` | un sync sulla vecchia litigherebbe con la nuova; conserva una storia che il proprietario ha detto di non volere |
| 3. Legarle a (utente, anno, mese, giorno) | migrazione dello schema | più pulito in astratto, ma tocca conferma, sync, griglia e i loro test per ottenere quello che la 1 dà con una transazione |

## 4. Il riporto (`carryOverAssignments`)

**Quando.** Alla transizione della versione N+1 a `extracted` o `partial`, nel punto in cui
`runExtractionJob`/il repository chiude la lettura. Una volta sola per versione: la funzione è
idempotente (se non ci sono assegnazioni sulla N, non fa niente).

**Cosa.** Per ogni utente con assegnazioni su **una qualsiasi** delle versioni lette precedenti
(`extracted` o `partial`, `version` minore, stesso `(year, month, ward)`) — non solo sulla N:
una collega saltata da una lettura parziale ha le conferme due versioni indietro, e guardando solo
la precedente ci resterebbero per sempre. Se la stessa persona ha una riga su più versioni vecchie
per lo stesso giorno (non dovrebbe: le righe si spostano) vince quella della versione più alta e le
altre restano dove sono. Le celle vecchie del riporto delle **correzioni a mano** restano quelle
della versione immediatamente precedente letta (`previousVersionOf`):

- se la versione N+1 contiene almeno una cella di una colonna a lui associata (`ColumnAlias` non
  ignorato, confronto con `normalizeColumn`), le sue assegnazioni passano alla N+1 con **tutti** i
  campi intatti: `confirmedAt`, `code`, `eventId`, `syncState`, `syncedAt`, `syncError`,
  `columnLabel`;
- altrimenti restano dove sono (decisione 5): `reviewableRosters` continua a mostrargli la N,
  perché la N+1 non ha la sua colonna.

**Correzioni a mano.** Una cella della N con `correctedAt` si riporta alla cella omologa della N+1
(stessa colonna normalizzata, stesso giorno) **solo se** `rawCode` della N+1 è uguale a `rawCode`
della N: il modello ha letto la stessa cosa, il giudizio umano vale ancora. Se il grezzo è diverso,
il foglio è cambiato e la correzione **non** si riporta: si vedrà come cambiamento. `correctedBy` e
`correctedAt` si copiano così come sono (la provenienza non si inventa).

**Conflitti.** L'unicità è `(userId, rosterId, day)`: se sulla N+1 esiste già un'assegnazione per
quella coppia (non dovrebbe: la N+1 appena letta non ha conferme), quella della N+1 vince e la riga
della N viene lasciata. Tutto in una transazione.

**Cosa non fa.** Non tocca Google. Non cambia lo stato delle assegnazioni: un turno il cui codice è
cambiato resta `confirmedAt` valorizzato con il `code` vecchio, ed è la griglia (già oggi) a dire
«va riconfermata» quando il codice letto non coincide con quello confermato.

## 5. Il diff (`diffVersions`, puro)

Input: le celle della versione precedente e quelle della nuova, per una o tutte le colonne.
Confronto sul **codice effettivo** (`correctedAt !== null ? correctedCode : code`), normalizzato con
`compactCode`; l'identità di colonna è `normalizeColumn`. Output, per colonna e giorno:

| tipo | prima | dopo |
|---|---|---|
| `changed` | `M` | `P` |
| `added` | vuoto / cella assente | `M` |
| `removed` | `M` | vuoto / cella assente |

Una cella con `correctedCode` null **e** `correctedAt` valorizzato è «il foglio qui è vuoto», quindi
vuota. Senza correzione, se il codice non è in legenda (`code` null) vale il **grezzo**: `M h13` è un
turno letto e da rileggere, non una casella vuota, e confonderli lo farebbe comparire come «tolto».
Celle uguali non compaiono. Le colonne di servizio (`isColonnaDiServizio`) non compaiono.
Il diff si calcola **al volo** leggendo le due versioni dal database: nessuna tabella nuova.

`filterChangesByCoverage` toglie i verdetti che una lettura parziale non può dare: i `removed` se la
versione **corrente** non è `extracted` (il giorno può essere solo non letto) e gli `added` se la
**precedente** non lo era (il turno poteva esserci già). Un `changed` è stato visto due volte e resta.
Per questo `previousVersionOf` restituisce anche lo `status`.

`previousVersionOf(roster)` restituisce la versione precedente **letta** (`extracted` o `partial`)
dello stesso `(year, month, ward)`: una versione caricata e mai letta, fallita o interrotta non ha
celle e non è una base di confronto, o `null` per la prima versione.

## 6. Quello che vede l'infermiera

Nella griglia della propria colonna, sulla versione N+1:

- **Riquadro in testa**, solo se il diff della sua colonna non è vuoto: «Rispetto alla foto
  precedente sono cambiati 3 giorni: 5 (M → P), 12 nuovo, 20 tolto». Con diff vuoto il riquadro non
  c'è: un avviso che compare sempre insegna a ignorarlo.
- **Badge «cambiato»** sulle righe del diff, accanto agli altri badge di attenzione.
- **Turno cambiato e confermato** (decisione 2): la riga mostra, come oggi, che va riconfermata; in
  più, se `syncState === 'synced'`, la frase «sul calendario c'è ancora M». Il bottone «Confermo»
  conferma il valore nuovo; il sync successivo aggiorna l'evento.
- **Turno tolto** (decisione 6): la riga è vuota ma porta un'assegnazione **confermata** (una bozza
  no: il sync non l'ha mai scritta). Mostra «il foglio nuovo non ha più questo turno» — e lo dice
  così solo se la foto è letta per intero **e** il diff dichiara quel giorno `removed`, altrimenti
  «il turno confermato non risulta più letto: resta com'è» — e, se c'è un evento, «sul calendario
  c'è ancora M». Bottone «Togli dal calendario» → `removeAssignmentAction` → `removeAssignment`
  cancella l'assegnazione (stessa barriera di conferma e sync: solo chi possiede la colonna) e
  **subito dopo** `syncRoster`, che cancella l'evento: una giornata senza assegnazione non protegge
  la chiave (già provato in `planSync`). Il sync parte da qui e non «al prossimo invio» perché sul
  turno tolto per ultimo non resta niente da confermare, quindi il bottone di invio non c'è; ed è
  per questo che un sync con **zero** assegnazioni è lecito invece di essere rifiutato. La scrittura
  su Google è esplicita: il gesto si chiama «Togli dal calendario» (regola invariante 1). Se
  l'evento non era mai stato mandato (`!synced`) il bottone si chiama «Togli il turno».

Il riquadro e i badge sono derivati: nessun campo nuovo sulle celle.

## 7. Quello che vede la referente

Pagina `/rosters/[id]/diff`, solo `REFERENTE` (controllo lato server con redirect, come
`/settings/codes`), raggiungibile dal menu ⋯ della griglia con la voce «Cosa è cambiato» **solo**
quando `roster.version > 1`. Contenuto: per ogni colonna di persona, i cambiamenti per giorno con
prima → dopo, e per ognuno se la persona ha già riconfermato il valore nuovo (`Assignment.code`
uguale al codice effettivo nuovo e `confirmedAt` valorizzato). Su un `removed` non c'è niente da
riconfermare: il badge dice «da togliere» se la conferma di quella persona per quel giorno è ancora
sulla versione corrente, «tolto» se non c'è più. Il banner della lettura parziale dice **quale** delle
due letture è incompleta. Con diff vuoto: «Nessuna differenza
rispetto alla foto precedente». Sulla prima versione la pagina dice che non c'è una versione
precedente.

## 8. Moduli e confini

- `roster`: `previousVersionOf`, `cellsForDiff(rosterId)` (celle con i campi che servono al diff),
  `carryOverAssignments(newRosterId)` chiamato alla chiusura della lettura.
- `review`: `diffVersions` (puro, `diff.ts`), `removeAssignment` (accanto a `unconfirmDays`),
  esteso `GridRow` con `changed: 'changed' | 'added' | 'removed' | null`, `previousCode`, e
  `orphanAssignment: boolean` (riga vuota con assegnazione). `gridSummary.changed`.
- `app/rosters/[id]/review`: riquadro, badge, frasi, bottone «Togli dal calendario».
- `app/rosters/[id]/diff`: la pagina della referente. Voce di menu in `menuItemsFor`? No: la voce
  dipende dalla tabella (`version > 1`), quindi la costruisce la pagina della griglia, come già fa
  per «Colonne e persone».
- `calendar`: **niente**. Il sync non cambia.

## 9. Cosa non si fa

- Nessuna consultazione delle versioni vecchie dall'interfaccia (decisione 3).
- Nessuna riconferma automatica e nessuna scrittura sul calendario senza conferma nuova.
- Nessuna cancellazione automatica di eventi per un turno tolto: serve il gesto.
- Nessun diff sulle colonne di servizio o sui totali.

## 10. Test (TDD, come sempre)

- `diffVersions`: i tre tipi; uguali non compaiono; codice effettivo con correzione a mano; cella
  svuotata a mano è vuota; colonne di servizio escluse; forme compatte (`M 2°P` = `M2°P`) uguali.
- `carryOverAssignments` (db): riporto con campi intatti; colonna mancante → resta sulla N;
  correzione riportata solo a grezzo uguale; idempotenza; transazione (o tutto o niente).
- `removeAssignment` (db): cancella solo per chi possiede la colonna; referente esclusa.
- Griglia: `changed`/`previousCode`/`orphanAssignment` sulle righe; `gridSummary.changed`;
  riquadro presente solo con diff non vuoto; frase «sul calendario c'è ancora».
- Pagina diff: negata a `NURSE`; con `version = 1` dice che non c'è una versione precedente; voce
  di menu solo con `version > 1`.
- Sync: un test che documenta che una giornata senza assegnazione porta alla cancellazione
  dell'evento, se non già presente in `sync.test.ts` (verificare, non duplicare).
