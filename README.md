# Toni Turni

Digitalizza la tabella turni cartacea del reparto e la porta sul Google Calendar di ogni infermiera —
con conferma umana prima di scrivere qualsiasi evento.

> **Stato: fondamenta pronte, lettura delle foto in arrivo.** Funzionano accesso con Google, ruoli e
> inviti, legenda dei turni configurabile e deploy in container. L'upload della foto, l'estrazione AI,
> la conferma e il sync con Google Calendar sono le fasi successive: oggi l'app non legge ancora le
> tabelle.

## Il problema

I turni arrivano su un foglio A3 stampato: righe = giorni del mese, colonne = infermieri, cella =
codice turno (`M`, `P`, `NOTTE`, `RP`…). Il foglio viene fotografato e girato su WhatsApp, correzioni
a penna incluse. Chi lo riceve ricopia a mano trenta caselle sul calendario del telefono, ogni mese.

## Come funziona

```
Foto della tabella  →  Estrazione AI  →  Conferma dell'infermiera  →  Google Calendar
   (referente)         (Groq vision)      (griglia editabile)         (calendario dedicato)
```

1. **Caricamento** — l'infermiera referente carica la foto del mese. L'immagine viene raddrizzata e
   ottimizzata localmente.
2. **Estrazione** — un modello vision legge la griglia e restituisce mese, colonne e una cella per
   giorno, **con un livello di confidenza per ciascuna**.
3. **Conferma** — ogni infermiera vede solo la propria colonna. Celle incerte, correzioni a penna e
   codici mai visti prima sono evidenziati. Niente viene scritto su Google finché non si conferma.
4. **Sincronizzazione** — i turni finiscono su un calendario dedicato "Turni", separato da quello
   personale. Ricaricare la foto corretta a metà mese aggiorna solo le celle cambiate, senza duplicati.

## Caratteristiche

- **Conferma umana obbligatoria** — l'AI propone, la persona decide.
- **Confidenza per cella** — l'app dice quali caselle rileggere, invece di chiedere di ricontrollare
  tutto.
- **Legenda turni configurabile** — orari e significato dei codici si modificano dalle impostazioni,
  senza toccare il codice.
- **Sync idempotente** — l'app riconosce gli eventi che ha creato e non tocca gli altri. Un ricarico
  aggiorna, non duplica.
- **Calendario dedicato** — si può nascondere o rimuovere in blocco senza intaccare il calendario
  personale.
- **Multi-utente** — ogni infermiera collega il proprio account Google e vede solo i propri turni.
- **Provider AI sostituibile** — Groq per default, alternativa selezionabile da configurazione.
- **Funziona anche senza AI** — l'inserimento manuale resta sempre disponibile.

## Requisiti

- Docker e Docker Compose (testato su ZimaBoard, x86_64, 8 GB RAM)
- Un dominio con Cloudflare (il piano gratuito basta) per il tunnel https
- Un progetto Google Cloud con Google Calendar API attiva
- Una chiave API [Groq](https://console.groq.com)

Il dominio https non è un vezzo: Google accetta redirect OAuth solo su `https` o `http://localhost`.

## Installazione

```bash
git clone https://github.com/francecesco/toni-turni.git
cd toni-turni
cp .env.example .env
# compila .env (vedi sotto), poi:
docker compose up -d --build
```

All'avvio il container applica da sé le migrazioni del database e carica i codici turno mancanti,
senza sovrascrivere quelli già modificati a mano: un aggiornamento non perde le tue impostazioni.

L'app resta raggiungibile solo attraverso il tunnel: sulla ZimaBoard non serve aprire porte del
router, e il container non pubblica porte sull'host.

### Configurazione

```dotenv
# Applicazione
APP_URL=https://turni.esempio.it          # deve combaciare con il redirect URI su Google
APP_ENCRYPTION_KEY=                       # 32 byte base64: openssl rand -base64 32
SESSION_SECRET=                           # openssl rand -base64 32
TZ=Europe/Rome

# Provider AI
AI_PROVIDER=groq                          # groq | anthropic
GROQ_API_KEY=
ANTHROPIC_API_KEY=                        # opzionale, provider alternativo

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Cloudflare Tunnel
CLOUDFLARE_TUNNEL_TOKEN=

# Privacy
IMAGE_RETENTION_DAYS=90                   # cancellazione automatica delle foto caricate
```

### Credenziali Google Calendar

1. Su [Google Cloud Console](https://console.cloud.google.com) crea un progetto.
2. Abilita **Google Calendar API**.
3. In *Credenziali* crea un **ID client OAuth 2.0** di tipo *Applicazione web*.
4. Aggiungi come redirect URI autorizzato: `https://tuo-dominio/api/auth/google/callback`.
5. Nella schermata consenso aggiungi gli scope `openid`, `email`, `profile` (per il login) e
   `https://www.googleapis.com/auth/calendar.events` (per gli eventi), poi inserisci le utenti come
   *test users*: per un uso familiare non serve la verifica Google.
6. Copia client ID e secret in `.env`.

L'app chiede solo il permesso sugli eventi del calendario, non l'accesso all'account completo.

### Primo avvio

1. Apri `https://tuo-dominio` e accedi con Google: il primo accesso diventa automaticamente
   **referente**. Non ci sono password: si entra con l'account Google, lo stesso consenso che serve
   per il calendario.
2. Invita le colleghe inserendo la loro email in *Impostazioni → Utenti*: solo le email invitate
   possono accedere.
3. Verifica in *Impostazioni → Codici turno* che orari e significati corrispondano al reparto.
4. Carica la prima foto e associa una volta per tutte le colonne della tabella alle utenti.

## Legenda turni predefinita

Modificabile dalla referente in *Impostazioni → Codici turno*.

| Codice | Significato | Evento |
|---|---|---|
| `M` | Mattino | 07:00–14:00 |
| `P` | Pomeriggio | 14:00–21:00 |
| `M/P` | Giornata lunga | 07:00–21:00 |
| `NOTTE` | Notte | 21:00–07:00 del giorno dopo |
| `SN` | Smonto notte | tutto il giorno, informativo |
| `RP` / `RIP` | Riposo | tutto il giorno, informativo |
| `F` | Ferie | tutto il giorno |
| `ASS` | Assenza | tutto il giorno |
| `M+` / `P+` | Turno prolungato | come `M` / `P`, durata da confermare |
| `M RSF` / `P RSF` | Turno in RSF | come `M` / `P` |
| `M1°P`, `P2°P`, … | Turno su un altro piano | come `M` / `P`, con sede indicata |

## Privacy

La tabella contiene nomi e assenze di persone che non usano l'app. Di conseguenza:

- le foto restano sul disco della ZimaBoard e vengono cancellate dopo `IMAGE_RETENTION_DAYS`;
- l'immagine viene inviata al provider AI solo quando la referente avvia l'estrazione;
- ogni infermiera vede solo la propria colonna;
- i token Google sono cifrati a riposo.

## Backup

Tutto lo stato vive in un volume Docker:

```bash
docker compose exec app sqlite3 /data/turni.db ".backup '/data/backup.db'"
docker compose cp app:/data/backup.db ./backup-$(date +%F).db
```

## Sviluppo

Serve Node 22 (`nvm use 22`).

```bash
npm install
npx prisma migrate dev   # crea il database in prisma/data/turni.db
npm run db:seed          # carica la legenda dei turni
npm run dev              # http://localhost:3000
npm test         # unit test, AI e Google API mockate
npm run eval     # accuratezza dell'estrazione sul provider reale (consuma token)
```

Lo sviluppo segue **TDD**: prima il test che fallisce, poi il codice minimo che lo fa passare, poi il
refactor. Vale in particolare per la logica dove un errore non si vede a occhio — orari a cavallo
della mezzanotte, ora legale, diff del sync.

Convenzioni, confini dei moduli e regole invarianti sono in [CLAUDE.md](CLAUDE.md); il design
completo in [docs/superpowers/specs/2026-08-26-toni-turni-design.md](docs/superpowers/specs/2026-08-26-toni-turni-design.md).

### Accesso di prova senza Google (solo sviluppo)

Finché le credenziali Google non sono configurate, l'unico modo di entrare sarebbe il login OAuth.
Per provare l'interfaccia c'è una scorciatoia **che vale solo fuori dalla produzione**:

```bash
# 1. serve un utente già nel database (una volta sola, se non c'è già):
npx tsx --env-file=.env -e "import {PrismaClient} from '@prisma/client'; const p = new PrismaClient(); \
  p.user.create({ data: { email: 'tu@example.com', displayName: 'Tu', role: 'REFERENTE' } }) \
  .then(() => console.log('creata')).finally(() => p.\$disconnect())"

# 2. avvia il server nominando le email ammesse:
DEV_LOGIN_EMAILS=tu@example.com npm run dev
```

All'avvio compare un avviso in chiaro nei log, e in `/login` un pulsante «Entra come …» per ogni
email elencata. `DEV_LOGIN_EMAILS` è insieme l'interruttore e l'elenco chiuso: senza la variabile
non esiste nessun accesso di prova, e le email nominate devono esistere già nel database (nessun
utente viene creato). Con `NODE_ENV=production` è ignorata e `POST /api/auth/dev-login` risponde
404. Non collega nessun account Google: il sync continuerà — correttamente — a chiedere di
autorizzare Google.

Prima di considerare l'accesso funzionante, esegui una volta la
[verifica manuale del flusso Google OAuth](docs/verifica-manuale-oauth.md): è l'unica parte non
coperta dai test automatici.

## Limiti noti

- La pianificazione dei turni resta cartacea: l'app legge, non genera.
- Solo Google Calendar (niente iCloud o Outlook).
- Le correzioni a penna sono il punto debole del riconoscimento: per questo la conferma umana non è
  opzionale.
- Una foto sfocata o molto obliqua va rifatta: nessun modello recupera ciò che non si vede.
- **Gestione utenti ridotta all'osso:** la referente può invitare e revocare un invito non ancora
  usato, ma non esiste ancora un modo per rimuovere un'utente già registrata o per invalidare la sua
  sessione prima della scadenza (30 giorni). Se serve subito, si cancella la riga dal database e si
  svuota `GoogleAccount`. Una gestione vera arriverà con le fasi successive.

## Licenza

Uso personale e familiare. Nessuna garanzia.
