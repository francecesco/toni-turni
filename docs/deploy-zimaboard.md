# Installazione sulla ZimaBoard

Procedura completa, dall'appliance vuota all'app raggiungibile dal telefono via https. Ogni passo
dice cosa si fa e come si verifica che sia riuscito. Tempo stimato: un'ora, di cui una decina di
minuti di build.

## 0. Cosa serve avere prima di iniziare

| cosa | dove | serve per |
|---|---|---|
| ZimaBoard (x86_64) con Docker e Docker Compose v2 | `docker compose version` sulla Zima | far girare l'app |
| Un dominio gestito da Cloudflare, piano gratuito | dash.cloudflare.com | il tunnel https, che Google esige per il redirect OAuth |
| Il **nome pubblico** scelto per l'app, es. `turni.tuodominio.it` | decisione tua | `APP_URL`, redirect Google, hostname del tunnel: **deve essere lo stesso in tutti e tre** |
| Client OAuth Google con il redirect **di produzione** registrato | console.cloud.google.com → Google Auth Platform → Client | login e calendario |
| Chiave API Gemini | aistudio.google.com/apikey | lettura delle foto |

Il client OAuth è lo stesso usato in sviluppo: basta che fra gli *URI di reindirizzamento
autorizzati* ci sia anche `https://turni.tuodominio.it/api/auth/google/callback` (senza barra
finale, senza porta). Gli scope sono quelli già configurati: `openid`, `email`, `profile`,
`calendar.events`, `calendar.app.created`.

## 1. Il tunnel Cloudflare

1. dash.cloudflare.com → **Zero Trust** → *Networks* → *Tunnels* → **Create a tunnel** → tipo
   *Cloudflared* → nome `toni-turni`.
2. Come ambiente scegli **Docker**: Cloudflare mostra un comando con `--token eyJ…`. Copia **solo il
   token** (la stringa lunga dopo `--token`): va in `.env` come `CLOUDFLARE_TUNNEL_TOKEN`. Non
   eseguire quel comando: il container `cloudflared` lo lancia già `docker-compose.yml`.
3. Scheda **Public Hostname** → *Add a public hostname*:
   - *Subdomain*: `turni`, *Domain*: `tuodominio.it`
   - *Service*: tipo `HTTP`, URL **`app:3000`**

   `app` è il nome del servizio nel `docker-compose.yml`: i due container stanno sulla stessa rete
   Docker e il tunnel raggiunge l'app per nome. Non serve aprire porte sul router né sulla Zima.
4. Salva. Il tunnel risulterà *Inactive* finché il container non parte: è normale.

## 2. I segreti

Sulla Zima (o sul Mac, poi li incolli), genera le due chiavi:

```bash
openssl rand -base64 32   # → APP_ENCRYPTION_KEY (cifra i refresh token Google a riposo)
openssl rand -base64 32   # → SESSION_SECRET (firma il cookie di sessione)
```

Sono due valori **diversi**. Cambiare `APP_ENCRYPTION_KEY` dopo il primo accesso rende illeggibili i
token già salvati: ogni utente dovrebbe rifare il login Google. Cambiare `SESSION_SECRET` scollega
solo le sessioni aperte.

## 3. Installazione

```bash
ssh <utente>@<ip-della-zima>
git clone https://github.com/francecesco/toni-turni.git
cd toni-turni
cp deploy/zimaboard.env.example .env
nano .env        # compila ogni riga: APP_URL, le due chiavi, Google, Gemini, token del tunnel
docker compose up -d --build
```

La build scarica le dipendenze, compila l'app e prepara il seed: sulla Zima aspettati **5-10 minuti**
la prima volta. Il container `app` all'avvio applica le migrazioni e carica la legenda dei codici
turno; `cloudflared` parte solo quando `app` risponde all'healthcheck.

### Verifiche, nell'ordine

```bash
docker compose ps                        # app: healthy, cloudflared: running
docker compose logs app | head -30       # «Applico le migrazioni…», «Carico i codici turno…», poi Next in ascolto
docker compose logs cloudflared | tail   # «Registered tunnel connection» (di solito quattro)
```

Poi dal telefono, **fuori** dalla Wi-Fi di casa per provare davvero il tunnel:
`https://turni.tuodominio.it` → pagina di accesso con il bottone Google.

Se il tunnel su Cloudflare resta *Inactive*: il token è sbagliato o incompleto. Se risponde 502: il
public hostname non punta a `app:3000`, oppure `app` non è ancora *healthy*.

## 4. Primo accesso

1. Accedi con Google con **il tuo** account: il primo accesso in assoluto diventa **referente**. Da
   qui in avanti si entra solo su invito.
2. *Impostazioni → Utenti*: invita le colleghe con la loro email Google. Ognuna accede con il proprio
   account e vede solo la propria colonna.
3. *Impostazioni → Codici turno*: controlla orari e significati (in particolare `M+`, `P+`, `RSF`,
   marcati «da confermare»).
4. Carica la prima foto, associa le colonne alle persone (`Colonne e persone`), conferma, «Manda sul
   mio calendario». Su Google deve nascere il calendario **«Turni Toniolo»**.

Il database parte **vuoto**: nessun utente di prova, nessuna tabella. È voluto. Se vuoi portare sulla
Zima le conferme già fatte sul Mac, vedi «Portare i dati dal Mac» in fondo.

## 5. La trappola dei 7 giorni (da fare prima dell'uso vero)

Finché il client OAuth su Google è in stato **In test**, i refresh token scadono dopo **7 giorni**: il
sync smette di funzionare ogni settimana e ogni persona deve riaccedere. Su *Google Auth Platform →
Pubblico* premi **Pubblica app**. Con questi scope Google mostrerà una volta l'avviso «app non
verificata» e ognuna dovrà premere *Avanzate → Vai a Toni Turni*: fastidioso una volta sola, e fino a
100 utenti non serve la verifica formale.

## 6. Aggiornare

```bash
cd toni-turni
git pull
docker compose up -d --build
```

Le migrazioni si applicano da sole all'avvio; la legenda non viene sovrascritta. Il volume
`turni-data` (database e foto) sopravvive a qualunque ricostruzione del container.

## 7. Backup e ripristino

Tutto lo stato è nel volume Docker `turni-data`: il database SQLite e le foto caricate.

```bash
# backup coerente del database (sqlite3 è nell'immagine)
docker compose exec app sqlite3 /data/turni.db ".backup '/data/backup.db'"
docker compose cp app:/data/backup.db ./backup-$(date +%F).db

# ripristino: a container fermo
docker compose stop app
docker compose cp ./backup-2026-09-07.db app:/data/turni.db
docker compose start app
```

Le foto stanno in `/data/uploads` e vengono cancellate dopo `IMAGE_RETENTION_DAYS` (90 per default):
non è necessario salvarle, la tabella confermata vive nel database.

## 8. Se qualcosa non va

| sintomo | causa probabile | rimedio |
|---|---|---|
| Google: `redirect_uri_mismatch` | `APP_URL` e l'URI nella console non coincidono carattere per carattere | correggi uno dei due; niente barra finale, `https` |
| il sync risponde 403 alla creazione del calendario | manca lo scope `calendar.app.created` o il consenso è vecchio | aggiungi lo scope, revoca l'accesso da myaccount.google.com/permissions, riaccedi |
| dopo una settimana il sync dice «il consenso Google va rinnovato» | app OAuth ancora «In test» | passo 5 |
| la griglia mostra «Ricollega il calendario» | il calendario «Turni Toniolo» è stato cancellato su Google | è voluto: l'app non ne crea uno da sola; premi il bottone e rimanda |
| lettura della foto fallita, log con `503` o `RESOURCE_EXHAUSTED` | Gemini in alta domanda o quota | riprova più tardi; il modello è pinnato a `gemini-3.6-flash` per una ragione, vedi `CLAUDE.md` |
| `app` non diventa *healthy* | manca una variabile obbligatoria in `.env` | `docker compose logs app`: l'errore nomina la variabile |

## Portare i dati dal Mac (facoltativo)

Il database di sviluppo (`prisma/data/turni.db`) contiene utenti di prova (`@esempio.it`) e le
tabelle caricate in sviluppo. Portarlo sulla Zima è possibile ma sconsigliato: gli utenti di prova
non hanno un account Google e i refresh token sono cifrati con la `APP_ENCRYPTION_KEY` del Mac. Se lo
fai, copia il file **prima** del primo `docker compose up` e usa sulla Zima la **stessa**
`APP_ENCRYPTION_KEY` del Mac:

```bash
docker volume create toni-turni_turni-data
docker run --rm -v toni-turni_turni-data:/data -v "$PWD":/src alpine cp /src/turni.db /data/turni.db
```

Il nome del volume è `<cartella-del-progetto>_turni-data`: se la cartella non si chiama
`toni-turni`, adegualo.
