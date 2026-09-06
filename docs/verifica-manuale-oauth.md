# Verifica manuale del flusso Google OAuth

Questa è l'unica parte della Fase 1 che **non è coperta dai test automatici**, e va eseguita una volta
dal proprietario del progetto. Il motivo è preciso: in tutti i test `exchangeGoogleCode` è sostituita
da un mock, quindi `googleClient()`, `generateAuthUrl`, `verifyIdToken`, il redirect URI reale e il
giro di cookie nel browser non hanno mai girato davvero. Finché questi passi non sono verdi, la Fase 1
è "implementata" ma non "provata".

## Prerequisiti

1. **Google Cloud Console** → progetto → *Credenziali* → client OAuth 2.0 di tipo *Applicazione web*.
   Fra gli URI di redirect autorizzati aggiungi quello dell'ambiente che stai provando:
   - sviluppo: `http://localhost:3000/api/auth/google/callback` (o `3001`, se la 3000 è occupata da
     un altro progetto: la porta deve combaciare con `APP_URL`)
   - produzione: `https://<tuo-dominio>/api/auth/google/callback`
2. Nella schermata consenso: scope `openid`, `email`, `profile`,
   `https://www.googleapis.com/auth/calendar.events` e
   `https://www.googleapis.com/auth/calendar.app.created`; le utenti vanno inserite come *test users*.
   Il secondo scope del calendario è quello che permette di **creare** il calendario dedicato: con
   `calendar.events` da solo, la creazione risponde 403. Se hai già dato il consenso prima della
   Fase 4, va rifatto: revoca l'accesso dell'app da
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions) e riaccedi.
3. `.env` compilato con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_URL` (che deve corrispondere
   **esattamente** al redirect registrato), `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, `DATABASE_URL`.
4. `npx prisma migrate deploy && npm run db:seed`, poi `npm run dev`.

## Passi

| # | Cosa fare | Cosa deve succedere |
|---|---|---|
| 1 | Apri `/login` e clicca "Accedi con Google" con l'account che diventerà referente | Consenso Google, poi redirect ad `APP_URL`; in DevTools → Application → Cookies compare `turni_session` come `httpOnly` |
| 2 | `npx prisma studio` → tabella `User` | Un record con quell'email e `role = REFERENTE` |
| 3 | Tabella `GoogleAccount` | `userId` collegato, `status = ok`, e `refreshToken` **non leggibile**: deve avere la forma `iv.ciphertext.authTag` in base64, non un token Google in chiaro |
| 4 | Da un altro account Google (o finestra anonima) prova ad accedere senza invito | Redirect a `/login?error=not_invited` con il messaggio "Questo indirizzo non è stato invitato…" |
| 5 | Come referente, *Impostazioni → Utenti*: invita l'email del secondo account, poi accedi con quello | Accesso riuscito, nuovo `User` con `role = NURSE`, e la riga `Invite` corrispondente ha `usedAt` valorizzato (`invitedBy` contiene l'**email** della referente) |
| 6 | Con la sessione dell'infermiera, apri `/settings/codes` | Redirect alla home: l'autorizzazione è lato server, non solo nascosta nell'interfaccia |
| 7 | Modifica un orario nella legenda come referente, poi riavvia l'app | Il valore modificato sopravvive e il badge "da confermare" resta sparito: il seed non sovrascrive |
| 8 | Ricarica l'URL di callback (o premi Indietro) dopo un accesso riuscito, così da riusare un `code` già consumato | Redirect a `/login?error=google` con un messaggio comprensibile, **non** una pagina di errore di Next |
| 9 | Annulla il consenso nella schermata Google | Redirect a `/login?error=denied` ("Accesso annullato") |
| 10 | Manometti lo `state` nell'URL di callback | Redirect a `/login?error=state` |
| 11 | Esegui il logout | Il cookie `turni_session` scompare e le pagine protette rimandano a `/login` |

## Il passo che vale doppio: una server action attraverso il tunnel

Quando l'app è raggiungibile dal dominio https via Cloudflare Tunnel, **salva un codice turno dalle
impostazioni passando dal dominio**, non da localhost.

Motivo: ogni scrittura della Fase 1 è una server action di Next, e `next.config.ts` non configura
`serverActions.allowedOrigins`. Next confronta `Origin` e `Host` per difendersi dal CSRF, e dietro un
proxy i due possono non combaciare: in quel caso la scrittura viene rifiutata pur essendo legittima.
Se accade, aggiungi il dominio a `experimental.serverActions.allowedOrigins` in `next.config.ts`.

È il tipo di guasto che non si vede in sviluppo e si manifesta solo in produzione, sul dispositivo di
tua moglie, la prima volta che tocca "Salva".

## Fase 4: la prima scrittura sul calendario vero

Il sync è coperto dai test con Google mockata: quello che i test **non** possono provare è il
consenso reale, la creazione del calendario dedicato e il fatto che gli orari arrivino giusti sul
telefono. Da fare una volta, con l'account di prova e non con quello di tua moglie.

Serve una `Assignment` confermata: finché la Fase 3 non esiste, la si crea a mano da
`npx prisma studio` (tabella `Assignment`: `userId`, `rosterId`, `day`, `code`, e **`confirmedAt`
valorizzato** — senza quello il sync non scrive, per progetto), poi si chiama `syncRoster` da un
piccolo script `tsx`.

| # | Cosa fare | Cosa deve succedere |
|---|---|---|
| 1 | Primo sync di un mese con due o tre turni confermati, uno dei quali `NOTTE` | Su Google compare un calendario nuovo chiamato "Turni Toniolo"; gli eventi stanno **lì**, non nel calendario principale. `GoogleAccount.calendarId` è valorizzato |
| 2 | Guarda la notte sul telefono | Comincia alle 21:00 e finisce alle 07:00 del **giorno dopo** |
| 3 | Metti a mano un appuntamento personale nel calendario dedicato e rilancia il sync | L'appuntamento è ancora lì, intatto: non ha `shiftKey`, quindi non si tocca. L'esito lo conta fra gli "eventi non creati dall'app" |
| 4 | Rilancia il sync senza cambiare niente | Zero creati, zero aggiornati, zero cancellati. Se qualcosa si muove, l'idempotenza è rotta: fermati e apri un test |
| 5 | Cambia il codice di un turno e rilancia | Un solo evento aggiornato, gli altri invariati |
| 6 | Cancella una riga `Assignment` e rilancia | Il suo evento sparisce, gli altri restano |
| 7 | Togli `confirmedAt` a un turno già sincronizzato e rilancia | L'evento **resta** e l'esito lo elenca come "non confermato": un turno da riconfermare non fa cancellare quello che c'è |
| 8 | Revoca l'accesso dell'app da myaccount.google.com e rilancia | Nessun errore grezzo: l'esito dice di rifare il login e `GoogleAccount.status` diventa `needs_reauth` |
| 9 | Un mese di ottobre con una notte sul 24 | Sul telefono la notte del cambio d'ora dura 11 ore, non 10 |

## Se qualcosa non torna

- `redirect_uri_mismatch` da Google: `APP_URL` e l'URI registrato non coincidono carattere per
  carattere (attenzione a `http`/`https`, alla porta e allo slash finale).
- Nessun `refreshToken` salvato: succede se il consenso era già stato dato in passato. L'app è
  scritta per non sovrascrivere con `null` un token già presente; per rigenerarlo, revoca l'accesso
  dell'app da [myaccount.google.com/permissions](https://myaccount.google.com/permissions) e riprova.
- `error=email_not_verified`: l'account Google usato non ha l'email verificata. È un rifiuto
  volontario, non un bug: tutto il modello di autorizzazione si appoggia su quell'indirizzo.
