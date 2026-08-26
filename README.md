# Toni Turni

Digitalizza la tabella turni cartacea del reparto e la porta sul Google Calendar di ogni infermiera —
con conferma umana prima di scrivere qualsiasi evento.

> **Stato: in sviluppo.** Design approvato, implementazione non ancora iniziata. Le istruzioni di
> installazione descrivono l'assetto previsto.

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
git clone <url-del-repo> toni-turni
cd toni-turni
cp .env.example .env
# compila .env (vedi sotto), poi:
docker compose up -d --build
```

L'app resta raggiungibile solo attraverso il tunnel: sulla ZimaBoard non serve aprire porte del router.

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
5. Nella schermata consenso aggiungi lo scope `https://www.googleapis.com/auth/calendar.events` e
   inserisci le utenti come *test users* (nessuna verifica Google necessaria per un uso familiare).
6. Copia client ID e secret in `.env`.

L'app chiede solo il permesso sugli eventi del calendario, non l'accesso all'account completo.

### Primo avvio

1. Apri `https://tuo-dominio` e registra il primo utente: diventa automaticamente **referente**.
2. Invita le colleghe; ognuna collega il proprio Google dal proprio profilo.
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

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # unit test, AI e Google API mockate
npm run eval     # accuratezza dell'estrazione sul provider reale (consuma token)
```

Lo sviluppo segue **TDD**: prima il test che fallisce, poi il codice minimo che lo fa passare, poi il
refactor. Vale in particolare per la logica dove un errore non si vede a occhio — orari a cavallo
della mezzanotte, ora legale, diff del sync.

Convenzioni, confini dei moduli e regole invarianti sono in [CLAUDE.md](CLAUDE.md); il design
completo in [docs/superpowers/specs/2026-08-26-toni-turni-design.md](docs/superpowers/specs/2026-08-26-toni-turni-design.md).

## Limiti noti

- La pianificazione dei turni resta cartacea: l'app legge, non genera.
- Solo Google Calendar (niente iCloud o Outlook).
- Le correzioni a penna sono il punto debole del riconoscimento: per questo la conferma umana non è
  opzionale.
- Una foto sfocata o molto obliqua va rifatta: nessun modello recupera ciò che non si vede.

## Licenza

Uso personale e familiare. Nessuna garanzia.
