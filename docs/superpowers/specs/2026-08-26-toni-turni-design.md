# Toni Turni — Documento di design

- **Data:** 2026-08-26
- **Stato:** approvato, non ancora implementato
- **Autore:** Francesco Negretti (con Claude)

## 1. Problema

Il reparto (3° Piano) distribuisce i turni su una **tabella cartacea mensile**: righe = giorni del
mese, colonne = infermieri, cella = codice turno. La tabella viene fotografata con lo smartphone e
girata su WhatsApp; contiene correzioni a penna, celle coperte con correttore e riscritte,
evidenziature a colori.

Oggi ogni infermiera ricopia a mano i propri turni sul calendario del telefono: operazione lenta,
ripetitiva e soggetta a errori (turni saltati, giorni sbagliati, correzioni dell'ultimo minuto non
recepite).

## 2. Obiettivo

Dalla foto della tabella al calendario Google personale, con **conferma umana obbligatoria** prima di
scrivere qualsiasi evento.

Non-obiettivi (esplicitamente fuori scope):

- Generare o ottimizzare i turni: la pianificazione resta alla caposala, su carta.
- Sostituire la tabella cartacea come fonte di verità.
- Gestire timbrature, presenze, buste paga.
- Sincronizzare calendari non-Google (iCloud, Outlook) nella prima versione.

## 3. Decisioni prese

| Tema | Decisione |
|---|---|
| Utenti | Multi-utente leggero: tua moglie + poche colleghe, ognuna con il proprio Google |
| Input | Foto da smartphone (JPEG/PNG/HEIC) |
| Chi carica | Solo l'utente con ruolo `referente`; le altre confermano la propria colonna |
| Calendario | Evento con orario su un **calendario dedicato** creato dall'app |
| AI | Provider vision astratto: Groq come default, provider alternativo selezionabile da env |
| Rete | Cloudflare Tunnel + dominio https (richiesto dal redirect OAuth Google) |
| Stack | Next.js 15 + Prisma/SQLite + Tailwind + shadcn/ui, un solo container applicativo |
| Legenda turni | Default precaricati, **modificabili dalla referente** in Impostazioni |

## 4. Architettura

Due container in `docker-compose.yml`:

- **`app`** — Next.js 15 in output standalone su `node:22-alpine`. Contiene UI, API, job di
  estrazione e sync. SQLite su volume Docker.
- **`cloudflared`** — tunnel verso il dominio https pubblico. La ZimaBoard non espone porte verso
  internet.

Nessun database server e nessun broker di code: il carico reale è di **una foto al mese**. I job
girano in-process con lo stato persistito su SQLite, quindi un restart li riprende invece di
perderli.

### Moduli

Ogni modulo vive in `src/modules/<nome>/` con un `index.ts` che esporta la sua interfaccia pubblica.
Il resto della cartella è interno e non va importato da fuori.

| Modulo | Cosa fa | Cosa NON sa |
|---|---|---|
| `ingest` | Riceve la foto, auto-rotate da EXIF, resize lato lungo ~2000px, JPEG q85, salva su volume | AI, calendari |
| `extract` | Interfaccia `VisionProvider` + prompt + validazione Zod dell'output | database, calendari |
| `roster` | Persistenza della tabella: mese/anno/piano, colonne, celle, versioni | AI, calendari |
| `codes` | Dizionario codici turno → orari e tipo evento, configurabile a runtime | AI, calendari |
| `review` | Griglia di conferma: evidenzia bassa confidenza, correzioni a penna, codici ignoti | AI, calendari |
| `calendar` | OAuth Google, calendario dedicato, diff e sync idempotente | AI, foto |
| `auth` | Login con Google, sessioni, ruoli, allowlist inviti, mapping colonna → utente | AI, calendari |

Il vincolo di isolamento che conta: `extract` produce **dati grezzi con confidenza per cella**,
`codes` traduce codice → orario, `calendar` non sa nulla dell'AI. Si può cambiare provider, o
inserire una tabella interamente a mano senza AI, senza toccare gli altri moduli.

### Modello dati (Prisma, bozza)

**Autenticazione: solo Google, nessuna password.** L'app richiede comunque il consenso Google per
scrivere sul calendario, quindi lo stesso consenso vale da login: un solo flusso, nessuna password da
custodire o reimpostare. Scope richiesti: `openid`, `email`, `profile`, `calendar.events`.

Il primo utente che entra diventa `REFERENTE`. Dopo di lui l'accesso è chiuso: possono entrare solo le
email presenti in `Invite`, inserite dalla referente. Senza questa allowlist qualunque account Google
potrebbe registrarsi.

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  displayName   String
  role          Role     @default(NURSE)      // REFERENTE | NURSE
  googleAccount GoogleAccount?
  aliases       ColumnAlias[]
  assignments   Assignment[]
}

model GoogleAccount {
  id            String   @id @default(cuid())
  userId        String   @unique
  refreshToken  String   // cifrato a riposo con APP_ENCRYPTION_KEY
  calendarId    String?  // calendario dedicato creato dall'app
  status        String   @default("ok")       // ok | needs_reauth
}

model Invite {
  email     String   @id                     // allowlist: solo queste email possono registrarsi
  invitedBy String
  createdAt DateTime @default(now())
  usedAt    DateTime?
}

model ColumnAlias {
  id       String @id @default(cuid())
  label    String @unique                     // es. "MERY", "SARA DP."
  userId   String
}

model Roster {
  id        String   @id @default(cuid())
  year      Int
  month     Int
  ward      String                            // es. "3°PIANO"
  version   Int      @default(1)
  imagePath String
  status    String                             // uploaded | extracting | extracted | failed
  rawOutput String?                            // JSON grezzo del provider, per debug
  cells     RosterCell[]
  @@unique([year, month, ward, version])
}

model RosterCell {
  id            String  @id @default(cuid())
  rosterId      String
  day           Int
  columnLabel   String
  rawCode       String                        // testo letto, non normalizzato
  code          String?                       // codice risolto in ShiftCode, null se ignoto
  confidence    Float
  handCorrected Boolean @default(false)       // il modello ha visto una correzione a penna
}

model ShiftCode {
  code          String  @id                   // "M", "P", "M/P", "NOTTE", ...
  label         String
  kind          String                        // work | absence | info | unknown
  startTime     String?                       // "07:00", null per all-day
  endTime       String?                       // "14:00"
  crossesMidnight Boolean @default(false)
  location      String?                       // es. "1° Piano", "RSF"
  color         String?
  needsReview   Boolean @default(false)       // default incerto, da confermare dalla referente
}

model Assignment {
  id         String   @id @default(cuid())
  userId     String
  rosterId   String
  day        Int
  code       String
  confirmedAt DateTime?
  eventId    String?                          // id evento Google, per update/delete
  syncState  String                            // draft | confirmed | synced | failed
  @@unique([userId, rosterId, day])
}
```

### Legenda turni di default

Precaricata al primo avvio via seed, **modificabile dalla referente** in Impostazioni → Codici turno.
`needsReview: true` marca i default incerti: l'app li mostra con un avviso finché non vengono
confermati.

| Codice | Etichetta | Tipo | Orario | Note |
|---|---|---|---|---|
| `M` | Mattino | work | 07:00–14:00 | |
| `P` | Pomeriggio | work | 14:00–21:00 | |
| `M/P` | Giornata lunga | work | 07:00–21:00 | mattina + pomeriggio, evento unico |
| `NOTTE` | Notte | work | 21:00–07:00 | attraversa la mezzanotte |
| `SN` | Smonto notte | info | all-day | evento informativo |
| `RP` | Riposo programmato | info | all-day | evento informativo |
| `RIP` | Riposo | info | all-day | evento informativo |
| `F` | Ferie | absence | all-day | |
| `ASS` | Assenza | absence | all-day | |
| `M+` | Mattino prolungato | work | 07:00–14:00 | `needsReview`: durata del prolungamento da definire |
| `P+` | Pomeriggio prolungato | work | 14:00–21:00 | `needsReview`: idem |
| `M RSF` / `P RSF` | Turno in RSF | work | come `M` / `P` | `needsReview`: significato di RSF da confermare |
| `M1°P`, `M2°P`, `M4°P` | Mattino al piano N | work | come `M` | `location` = piano |
| `P1°P`, `P2°P`, `P4°P` | Pomeriggio al piano N | work | come `P` | `location` = piano |

## 5. Flusso applicativo

1. La **referente** carica la foto del mese. `ingest` normalizza l'immagine e crea un `Roster` in
   stato `uploaded`.
2. `extract` invia l'immagine al provider vision chiedendo JSON strutturato:
   `{ year, month, ward, columns[], cells[{ day, column, code, confidence, handCorrected }] }`.
   Le celle con correzione a penna vengono marcate: sono le più a rischio e vanno sempre riviste.
3. **Mapping colonne → utenti**, una volta sola e memorizzato come `ColumnAlias` (`MERY` → utente X).
   Le colonne `AIUTO MATT.` / `AIUTO POM.` e i totali `TOT M` / `TOT P` vengono ignorati: non sono
   assegnazioni di turno.
4. Ogni **infermiera** vede la bozza della propria colonna come griglia del mese. Sono evidenziate:
   confidenza bassa, correzioni a penna, codici sconosciuti.
5. Alla conferma esplicita, `calendar` calcola il diff e crea/aggiorna/cancella gli eventi.
   **Senza conferma non viene scritto nulla su Google.**
6. Re-upload dello stesso mese → nuova `version` → vengono evidenziate **solo le celle cambiate**,
   da riconfermare. Le celle identiche restano confermate.

### Idempotenza del sync

Ogni evento creato porta `extendedProperties.private.shiftKey = "<userId>:<YYYY-MM-DD>"`. Il sync:

1. Elenca gli eventi del calendario dedicato nel mese, filtrando per `shiftKey`.
2. Confronta con le assegnazioni confermate.
3. Crea i mancanti, aggiorna i diversi, cancella quelli non più previsti.

Vincolo assoluto: **l'app non modifica né cancella eventi che non ha creato lei**. Nessun `shiftKey`,
nessun tocco.

## 6. Gestione errori

| Situazione | Comportamento |
|---|---|
| Foto illeggibile / griglia non riconosciuta | Errore chiaro con anteprima immagine; l'inserimento manuale resta disponibile — l'app è usabile anche senza AI |
| Output AI non conforme allo schema | Un retry con prompt di riparazione → provider alternativo → errore con `rawOutput` salvato per debug |
| Codice turno sconosciuto | **Non blocca**: cella `unknown`, l'utente lo mappa (la mappatura resta per i mesi successivi) o lo salta |
| Token Google revocato / scaduto | `GoogleAccount.status = needs_reauth`, banner in UI; i turni confermati restano salvati |
| Rate limit del provider | Backoff esponenziale, il job resta `extracting` e riprende |
| Conflitto con evento personale esistente | Segnalato in fase di conferma, non risolto automaticamente |

## 7. Testing

- **Unità (Vitest):** validazione Zod dell'output AI; mapping codice → intervallo orario, con i casi
  duri **notte a cavallo della mezzanotte** e **cambio ora legale**; motore di diff e idempotenza del
  sync con Google API mockata.
- **Golden test:** le due foto reali (Agosto e Settembre 2026) come fixture con il JSON atteso. In CI
  la chiamata AI è mockata.
- **Valutazione del prompt:** `npm run eval` esegue l'estrazione contro il provider reale e misura
  l'**accuratezza per cella** rispetto alle fixture. Serve a sapere se un cambio di prompt migliora o
  peggiora, invece di indovinare.
- **E2E (Playwright):** flusso upload → conferma → sync, in una fase successiva.

## 8. Privacy e dati

Le foto contengono dati personali di terzi (nomi delle colleghe e loro presenze/assenze).

- Le immagini restano sul volume locale della ZimaBoard.
- Vengono inviate al provider AI **solo su azione esplicita** della referente.
- Retention configurabile: cancellazione automatica delle immagini dopo N giorni (default 90).
- Ogni infermiera vede solo la propria colonna. La referente vede tutto, per necessità operativa.
- `refreshToken` di Google cifrato a riposo con `APP_ENCRYPTION_KEY`.
- Scope Google richiesti: `openid`, `email`, `profile` per il login e `calendar.events` per gli eventi.
  Nessun accesso a Gmail, Drive o contatti.
- Nessuna password gestita dall'app: nessun database di hash, nessun reset da implementare.

## 9. Domande ancora aperte

1. Durata effettiva del prolungamento nei codici `M+` / `P+`.
2. Significato di `RSF` (sede diversa? tipo di reparto?) e se richiede un `location` distinto.
3. Se le colonne `AIUTO MATT.` / `AIUTO POM.` interessano qualcuna delle utenti (oggi: ignorate).

Nessuna di queste blocca la prima implementazione: sono codici marcati `needsReview` e correggibili da
Impostazioni.

## 10. Fasi di sviluppo

1. **Fondamenta** — progetto Next.js, Prisma/SQLite, Docker, login Google con ruoli e inviti, legenda
   turni con orari configurabili.
2. **Ingest + estrazione** — upload, normalizzazione, `VisionProvider` Groq, schema Zod, golden test.
3. **Review** — griglia di conferma, mapping colonne → utenti, gestione codici ignoti.
4. **Sync Google** — OAuth, calendario dedicato, motore di diff idempotente.
5. **Versioning** — re-upload, diff tra versioni, riconferma parziale.
6. **Rifinitura UI** — è la fase in cui shadcn/ui e le animazioni ripagano l'investimento.
