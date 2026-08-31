# Veste «Corsia»: interfaccia mobile-first — design

> **Stato:** approvato in conversazione il 2026-08-31. Attua la Fase 6 (rifinitura UI) del design
> generale, che resta l'autorità: [2026-08-26-toni-turni-design.md](2026-08-26-toni-turni-design.md).

## 1 · Cosa e perché

L'app la userà un'infermiera **da iPhone**, in piedi in corsia o a letto alle sei e quaranta. Oggi
funziona ma è HTML nudo: bottoni scritti a mano invece dei componenti installati, quattro riquadri
d'avviso stilati in quattro modi diversi, palette interamente grigia, e cinque pagine che scrivono
colori letterali (`emerald-50`, `gray-600`, `amber-900`) invece dei token — quindi in tema scuro si
romperebbero.

Questo documento definisce una veste sola, applicata a tutte le pagine, e il guscio che la tiene:
token semantici, tipografia, PWA installabile, un punto d'atterraggio nuovo e componenti condivisi.

**Il criterio di riuscita:** tua moglie apre l'app, vede i turni del mese senza toccare niente,
capisce quali giorni deve rileggere, e conferma col pollice senza cambiare mano.

## 2 · Decisioni già prese, e da chi

| decisione | scelta | dove si è deciso |
|---|---|---|
| ambizione | **PWA installabile**, senza service worker | conversazione 2026-08-31 |
| navigazione | **si apre sul mese in corso**, voci della referente dietro un ⋯ | conversazione 2026-08-31 |
| direzione visiva | **«Corsia»**: schede bianche su fondo azzurro freddo, blu netto per le azioni | mockup delle tre direzioni, 2026-08-31 |
| tema | **segue iOS** via `prefers-color-scheme`, nessun interruttore | conversazione 2026-08-31 |
| dipendenze | **nessuna nuova** (§9) | questo documento |

Il service worker è stato **escluso**: una cache su dati che cambiano (una correzione, una
riconferma) farebbe vedere turni vecchi credendoli attuali, che è esattamente il guasto che questa
app esiste per evitare.

## 3 · Fuori perimetro

- Il diff fra versioni della stessa tabella (Fase 5) — non si tocca.
- `extract`, `roster`, `review`, `calendar`, `ingest`, `codes`, `auth`: **nessuna modifica alla
  logica**. Le 897 prove esistenti devono restare verdi senza essere riscritte.
- Notifiche push: fuori. iOS le permette a una PWA installata, ma sono un'altra funzione, non una
  veste.
- Interruttore manuale chiaro/scuro: fuori, per decisione (§2). Aggiungerlo dopo costa **una riga**
  (§4.3).

## 4 · Il sistema di token

Questa è la sezione che porta il 70% del risultato: finché i colori stanno nelle pagine, nessuna
veste tiene.

### 4.1 · La regola

**Nessun file sotto `src/app/` o `src/components/` nomina una famiglia di colore Tailwind.** Non
`emerald-500`, non `gray-600`, non `bg-white`. Ogni colore arriva da un token. La regola è
verificata da una prova automatica (§10.5), non dalla buona volontà.

Il corollario utile: se ogni colore viene da un token, il tema scuro **non ha bisogno di varianti
`dark:` nelle pagine** — arrivano gratis dalla ridefinizione dei token.

### 4.2 · La palette, in esadecimale

L'intera palette passa da `oklch` a **esadecimale**. Non è una preferenza di stile: la prova sui
contrasti (§10.6) legge questi valori, e un solo formato è un parser solo. In `:root`:

```css
:root {
  /* superfici */
  --background: #F2F6F9;
  --foreground: #0F1B24;
  --card: #FFFFFF;
  --card-foreground: #0F1B24;
  --popover: #FFFFFF;
  --popover-foreground: #0F1B24;

  /* azione */
  --primary: #1A6FD4;
  --primary-foreground: #FFFFFF;
  --secondary: #E7EEF4;
  --secondary-foreground: #0F1B24;
  --accent: #DCE9F7;
  --accent-foreground: #14548F;

  /* testo secondario e bordi */
  --muted: #E7EEF4;
  --muted-foreground: #55697A;
  --border: #DFE8EF;
  --input: #DFE8EF;
  --ring: #1A6FD4;

  /* semantici: coppia piena + coppia tenue */
  --ok: #0C7A55;
  --ok-foreground: #FFFFFF;
  --ok-soft: #DDF3EA;
  --ok-soft-foreground: #0A5F42;

  --warn: #9A5B00;
  --warn-foreground: #FFFFFF;
  --warn-soft: #FDEFD6;
  --warn-soft-foreground: #6F4200;

  --destructive: #C1332A;
  --destructive-foreground: #FFFFFF;
  --destructive-soft: #FBE6E4;
  --destructive-soft-foreground: #8A241D;

  --sunday: #C24A70;
  --sunday-soft: #FCEDF2;
  --sunday-soft-foreground: #963556;

  --radius: 1rem;
}
```

Questi esadecimali sono il **punto di partenza**, non un dogma: l'autorità sul contrasto è la prova
di §10.6. Un valore che non la passa si scurisce o si schiarisce restando sulla stessa tinta —
`--ok` è già stato corretto così in fase di scrittura (`#0F8A60` dava 4,35:1 con testo bianco,
`#0C7A55` dà 5,34:1). Un valore che non passa **non** si aggira abbassando la soglia.

In tema scuro, **solo** i valori cambiano:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0E1620;
    --foreground: #E6EDF3;
    --card: #16212C;
    --card-foreground: #E6EDF3;
    --popover: #16212C;
    --popover-foreground: #E6EDF3;

    --primary: #5EA3F0;
    --primary-foreground: #06182B;
    --secondary: #1E2C39;
    --secondary-foreground: #E6EDF3;
    --accent: #1B2F45;
    --accent-foreground: #A8CDF7;

    --muted: #1E2C39;
    --muted-foreground: #97AAB9;
    --border: #24313D;
    --input: #2A3946;
    --ring: #5EA3F0;

    --ok: #3ECF98;
    --ok-foreground: #06231A;
    --ok-soft: #10261F;
    --ok-soft-foreground: #74E2B7;

    --warn: #F0B95E;
    --warn-foreground: #2A1B04;
    --warn-soft: #2A2113;
    --warn-soft-foreground: #F5CE8C;

    --destructive: #F2695E;
    --destructive-foreground: #2A0D0A;
    --destructive-soft: #2B1512;
    --destructive-soft-foreground: #F7A79E;

    --sunday: #EC8AA9;
    --sunday-soft: #2A1720;
    --sunday-soft-foreground: #F2A8BF;
  }
}
```

I token `--chart-1..5` e `--sidebar-*` generati da shadcn **restano dove sono e non si usano**:
questa app non ha grafici né barra laterale. Toglierli farebbe fallire un futuro `shadcn add`.

Ogni token nuovo va anche dichiarato in `@theme inline`, altrimenti non nasce nessuna classe:

```css
@theme inline {
  --color-ok: var(--ok);
  --color-ok-foreground: var(--ok-foreground);
  --color-ok-soft: var(--ok-soft);
  --color-ok-soft-foreground: var(--ok-soft-foreground);
  /* idem per warn-*, destructive-soft*, sunday* */
}
```

### 4.3 · La variante `dark`, e perché va cambiata

Oggi `globals.css` dichiara:

```css
@custom-variant dark (&:is(.dark *));
```

Vuol dire che le utility `dark:` scattano **solo** sotto un elemento con classe `.dark`. Nessuna
pagina la mette, e nessuno la metterà: abbiamo deciso di seguire iOS. Ma i componenti installati
sotto `src/components/ui/` **usano** `dark:` — dieci volte, in `button`, `input`, `select`,
`checkbox`, `badge` — e sempre con token, per rifiniture reali (`dark:bg-input/30` sui campi,
`dark:aria-invalid:border-destructive/50` sugli errori). Lasciata così, quella riga rende quelle
rifiniture **codice morto**: in tema scuro i campi resterebbero trasparenti invece di avere il
riempimento previsto.

Diventa:

```css
@custom-variant dark (@media (prefers-color-scheme: dark));
```

Da qui: nessun JavaScript, nessun flash al caricamento, nessuna dipendenza. Se un giorno servisse un
interruttore manuale, è **questa riga** da riscrivere, e nient'altro.

### 4.4 · Tipografia

- **Figtree** via `next/font/google`, asse variabile 300–900, `subsets: ['latin']`, dichiarata in
  `layout.tsx` con `variable: '--font-figtree'`. In `globals.css`, `@theme inline` cambia una riga:
  `--font-sans: var(--font-figtree)` al posto di `var(--font-geist-sans)`. Geist esce, e con lui le
  due chiamate a `Geist`/`Geist_Mono` in `layout.tsx`.
- **Geist Mono esce.** `--font-mono` diventa lo stack di sistema
  (`ui-monospace, SFMono-Regular, Menlo, monospace`): risparmia un download e serve solo per i
  pochi pezzi tecnici (l'etichetta di colonna nella griglia).
- `font-variant-numeric: tabular-nums` applicato in `@layer base` a `.tabular`, e usato su **ogni**
  colonna di cifre: giorni, orari, contatori. In una colonna di orari il disallineamento si vede.
- Nessun secondo carattere da display: «Corsia» ha una famiglia sola. Era la direzione due a
  mescolare un serif, e non è quella scelta.

### 4.5 · Raggi e scala del tocco

`--radius` passa da `0.625rem` a **`1rem`**. La scala derivata di shadcn resta la sua, quindi
`rounded-lg` diventa 12,8 px e `rounded-xl` 22,4 px: gli angoli morbidi della direzione «Corsia»
arrivano senza toccare una classe.

**Il problema vero è la taglia.** `buttonVariants` ha come taglia massima `lg: "h-9"`, cioè 36 px:
sotto il minimo di 44 px raccomandato da Apple, e la ragione per cui nessuna pagina usa `Button` —
tutte scrivono `py-4` a mano. Finché i componenti sono scalati per il desktop, continueranno a
essere aggirati. Quindi si aggiungono taglie da tocco:

| componente | file | aggiunta |
|---|---|---|
| `Button` | `src/components/ui/button.tsx` | taglia `touch`: `h-12 gap-2 px-4 text-base`; taglia `icon-touch`: `size-11` |
| `Input` | `src/components/ui/input.tsx` | **non ha una cva**: `h-8` è scritto fisso nella stringa di classi. Si cambia in `h-11` e si alza `px-2.5` a `px-3`. È la mossa giusta su un'app mobile-first — il valore di partenza è quello del telefono, e i rari casi fitti da desktop passano `className="h-8"`. Il `text-base` c'è già ed è obbligatorio: sotto i 16 px iOS ingrandisce la pagina al focus |
| `Select` | `src/components/ui/select.tsx` | il trigger ha già `data-[size=default]:h-8` e `data-[size=sm]:h-7`: si aggiunge `data-[size=touch]:h-11` |

Le taglie esistenti non si toccano: servono ai pochi controlli fitti (la legenda dei codici da
desktop).

**Regola:** ogni cosa toccabile è alta almeno 44 px. Nella griglia di conferma, dove i bottoni
stanno in colonna uno sotto l'altro, 48 px.

## 5 · Il guscio PWA

### 5.1 · Manifest

`src/app/manifest.ts`, convenzione nativa di Next 16 (`MetadataRoute.Manifest`):

```ts
{
  name: 'Turni',
  short_name: 'Turni',
  description: 'I tuoi turni, dalla tabella del reparto al calendario.',
  start_url: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#F2F6F9',
  theme_color: '#F2F6F9',
  lang: 'it',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
```

`theme_color` è uguale a `--background` chiaro: la barra di stato si fonde col fondo invece di
disegnare una riga.

### 5.2 · Icone

Un quadrato ad angoli tondi (raggio 22% del lato) su `#1A6FD4`, con una griglia di caselle bianche
4 colonne × 5 righe (passo orizzontale e verticale calcolati a parte, casella quadrata sul più
piccolo dei due): le caselle al 40% di opacità, **una** sola (riga 2, colonna 3) piena al 100%.
È la tabella turni con un turno confermato — si legge a 60 px sulla schermata Home.

Generate **una volta** da `scripts/generate-icons.ts` (SVG in stringa → `sharp` → PNG) e
**committate**, non prodotte a runtime: sulla ZimaBoard un'icona generata da una route è CPU spesa
per niente. File prodotti:

| file | lato | a cosa serve |
|---|---|---|
| `src/app/icon.png` | 512 | favicon e scheda del browser (Next genera il `<link>`) |
| `src/app/apple-icon.png` | 180 | schermata Home di iOS |
| `public/icon-192.png` | 192 | manifest |
| `public/icon-512.png` | 512 | manifest, splash |
| `public/icon-maskable-512.png` | 512 | manifest `maskable`: griglia al 60% del lato, blu a filo dei bordi |

`sharp` è già una dipendenza del progetto: nessuna aggiunta.

### 5.3 · Viewport e safe-area

In `src/app/layout.tsx`:

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F6F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1620' },
  ],
}
```

**Lo zoom resta abilitato.** Non si scrive `maximumScale: 1` né `userScalable: false`: disattivare
lo zoom è un difetto di accessibilità, e su un'app che un'infermiera guarda alle sei del mattino è
esattamente la cosa da non fare.

`viewportFit: 'cover'` porta il contenuto sotto il notch, quindi le safe-area diventano
obbligatorie:

- `ActionDock`: `padding-bottom: max(1rem, env(safe-area-inset-bottom))`. Senza, a schermo intero il
  bottone «Confermo tutti» finisce sotto la barra dei gesti e non si tocca.
- `AppHeader`: `padding-top: max(0.5rem, env(safe-area-inset-top))`.
- Le colonne di contenuto: `padding-inline: max(1rem, env(safe-area-inset-left))` — serve in
  orizzontale, che `orientation: portrait` scoraggia ma iOS non vieta.

`colorScheme: 'light dark'` fa seguire il tema anche a barre di scorrimento e controlli di sistema.

## 6 · Atterraggio e navigazione

### 6.1 · La regola d'atterraggio

`src/app/page.tsx` non è più una home di bottoni: risolve su quale tabella atterrare e fa
`redirect()` a `/rosters/<id>/review`.

La regola vive in una funzione **pura**, in `src/modules/review/landing.ts`:

```ts
export interface LandingCandidate {
  id: string
  year: number
  month: number
  version: number
}

/**
 * La tabella su cui si apre l'app: quella del mese corrente alla versione più
 * alta; se non c'è, la più recente per (anno, mese); se non c'è niente, null.
 */
export function landingRoster(
  candidates: readonly LandingCandidate[],
  today: { year: number; month: number },
): LandingCandidate | null
```

Ordine di preferenza, in questo esatto ordine:

1. `year === today.year && month === today.month`, fra queste la `version` più alta;
2. altrimenti la più recente per `year` decrescente, poi `month` decrescente, poi `version`
   decrescente;
3. altrimenti `null`.

**La versione più alta non è un dettaglio.** `nextVersion` esiste già nel modulo `roster`, quindi
due righe `Roster` per lo stesso mese sono un caso reale: atterrare sulla versione 1 quando esiste
la 2 mostrerebbe turni superati senza dirlo. È il tipo di guasto che nessuno nota fino al giorno
sbagliato.

Il `today` non si prende da `new Date().getMonth()`: quello è il mese **UTC**, e alle 00:30 del
primo settembre a Roma l'UTC dice ancora agosto. Serve un aiuto nuovo in `src/lib/time.ts`:

```ts
/** Anno e mese (1-based) di un istante, letti sul calendario di Roma. */
export function romeYearMonth(instant: Date): { year: number; month: number }
```

È lo stesso motivo per cui `zoneOffsetMinutes` e `wallClockToUtc` esistono già in quel file: qui i
fusi non si calcolano a mano.

I candidati arrivano da `reviewableRosters(user)`, che esiste già in `src/modules/review/confirm.ts`
e restituisce `{ id, year, month, ward, version, status, createdAt }` già ordinati — l'ordine però
**non si assume**: la funzione pura ordina da sé, così una prova può passarle un elenco disordinato.

Con `null`, `page.tsx` rende uno stato vuoto, diverso per ruolo:

- `REFERENTE`: «Non c'è ancora nessuna tabella. Carica la foto del mese.» + bottone a `/rosters/upload`.
- altri: «Non c'è ancora nessuna tabella. Quando la referente carica il mese, i tuoi turni compaiono qui.»

### 6.2 · Il selettore dei mesi

`/rosters` resta la stessa route e diventa il **selettore dei mesi**: ci si arriva dal chevron
accanto al nome del mese nell'header. È un `Link`, non un pannello: zero JavaScript, URL
condivisibile, tasto indietro che funziona.

La lista si costruisce da una funzione pura in `src/modules/review/landing.ts`:

```ts
export interface MonthEntry {
  id: string
  year: number
  month: number
  current: boolean
}

/** Un'unica voce per (anno, mese): la versione più alta. Ordine: dal più recente. */
export function monthPickerEntries(
  candidates: readonly LandingCandidate[],
  today: { year: number; month: number },
): MonthEntry[]
```

Le versioni superate **non compaiono come voci separate**: una tendina con «agosto 2026» tre volte
non aiuta nessuno. `current` marca il mese di oggi, non la tabella su cui si è atterrati.

### 6.3 · Il menu della referente

Il ⋯ in alto a destra apre un **foglio dal basso** (`Drawer` di `@base-ui/react/drawer`, già
dipendenza) — non una tendina: su un telefono un foglio dal basso è dove arriva il pollice, e Base
UI dà chiusura con Esc, clic fuori e trappola del focus senza scriverli.

Le voci vengono da una funzione pura in `src/modules/auth/menu.ts`:

```ts
export interface MenuItem { href: string; label: string }

export function menuItemsFor(user: { role: string }): MenuItem[]
```

- `REFERENTE` → `/rosters/upload` «Carica la tabella», `/settings/codes` «Codici turno»,
  `/settings/users` «Utenti».
- `NURSE` → `[]`, e allora **il bottone ⋯ non si disegna affatto**.

L'uscita (`POST /api/auth/logout`) sta **in un posto solo**: in fondo al selettore dei mesi, che
tutti raggiungono dal chevron. Non anche nel foglio: due strade per uscire sono due strade da
mantenere, e l'uscita non è un'azione che si cerca di fretta.

Questa funzione è la regola invariante 7 («solo `REFERENTE` carica tabelle e modifica la legenda»)
resa verificabile: oggi è un `&&` dentro il JSX, che nessuna prova può leggere. **Non sostituisce**
i controlli lato server nelle route e nelle server action, che restano dove sono: nascondere una
voce non è autorizzare.

### 6.3-bis · Confini dei moduli

Le tre funzioni pure nuove stanno dentro moduli esistenti e vanno **esposte dalle facciate**, perché
il codice applicativo non importa mai un file interno di un altro modulo:

- `landingRoster`, `monthPickerEntries`, `LandingCandidate`, `MonthEntry` → aggiunti a
  `src/modules/review/index.ts`;
- `menuItemsFor`, `MenuItem` → aggiunti a `src/modules/auth/index.ts`.

Le **prove**, invece, importano il sottomodulo diretto (`@/modules/review/landing`,
`@/modules/auth/menu`) e non la facciata: le facciate tirano dentro il client Prisma e
`next/headers`, che fuori dal runtime di Next fallisce. È la convenzione già in uso nel progetto.

### 6.4 · Transizioni fra pagine

`@view-transition { navigation: auto; }` in `globals.css`: è nativo, supportato da Safari 18, e
costa zero byte. Dentro un blocco `@media (prefers-reduced-motion: no-preference)`, perché chi ha
chiesto meno animazioni ha chiesto anche questa.

Nessuna libreria di animazione (§9).

## 7 · Componenti condivisi

Nuovi, sotto `src/components/`:

| componente | file | cosa fa |
|---|---|---|
| `AppHeader` | `app-header.tsx` | mese + chevron verso `/rosters`, sottotitolo (reparto · colonna), ⋯ se il menu non è vuoto, safe-area in cima |
| `AppMenu` | `app-menu.tsx` (`"use client"`) | il foglio dal basso; riceve `items` già calcolati, non conosce i ruoli |
| `ActionDock` | `action-dock.tsx` | contenitore fisso in fondo: fondo `--card`, bordo in cima, safe-area, `gap` |
| `Banner` | `banner.tsx` | **un solo** riquadro d'avviso, varianti `ok \| warn \| error \| info` sulle coppie tenui; `role="alert"` solo su `error` |
| `DayRow` | `review/day-row.tsx` | una riga giorno della griglia: quadratino del giorno, codice, orario, badge, bottone, tendina di correzione |
| `ColumnSummary` | `review/column-summary.tsx` | la testa della colonna: contatore, barra d'avanzamento, avvisi |
| `EmptyState` | `empty-state.tsx` | stato vuoto con titolo, spiegazione e un'azione facoltativa |

`Banner` è quello che porta più ordine: oggi gli avvisi sono stilati a mano **quattro volte** con
quattro combinazioni di colori diverse, e sono tre quinti delle classi letterali da eliminare.

`src/app/rosters/[id]/review/page.tsx` è oggi **436 righe** e va spezzato estraendo `DayRow` e
`ColumnSummary`. Non è rifattorizzazione gratuita: è il file su cui si lavora in questa fase, e a
436 righe non ci si lavora bene.

## 8 · Le pagine, una per una

| pagina | cosa cambia | logica toccata |
|---|---|---|
| `layout.tsx` | Figtree, `viewport`, safe-area, `<body>` sui token | no |
| `manifest.ts` | **nuovo** (§5.1) | no |
| `page.tsx` | da home di bottoni a redirect + stato vuoto (§6.1) | **sì**, nuova |
| `rosters/page.tsx` | selettore dei mesi: una voce per mese, quella corrente marcata, uscita in fondo | **sì**, `monthPickerEntries` |
| `rosters/[id]/review/page.tsx` | schede «Corsia», quadratino del giorno, domenica su `--sunday`, `ActionDock`; spezzata in `DayRow` + `ColumnSummary` | no |
| `rosters/[id]/page.tsx` | avanzamento con `Progress` di Base UI, anteprima dei tagli più grande, `Banner` | no |
| `rosters/[id]/columns/page.tsx` | schede, `Select` con taglia da tocco | no |
| `rosters/upload/page.tsx` | selettore foto grande, campi con taglia da tocco | no |
| `settings/codes/page.tsx` | **la peggiore su iPhone**: tabella HTML a 5 colonne → lista di schede, griglia a 2 colonne da `md:` in su | no |
| `settings/users/page.tsx` | schede al posto delle righe di tabella, token al posto di `gray-*` | no |
| `login/page.tsx` | token al posto di `gray-600`/`red-50`, bottone Google da tocco; il riquadro dell'accesso di prova resta distinto, su `--warn-soft` | no |

Le uniche pagine con **logica nuova** sono `page.tsx` e `rosters/page.tsx`, e la loro logica sta
nelle due funzioni pure di §6. Tutto il resto è veste.

## 9 · Dipendenze: nessuna nuova

Le librerie moderne sono già installate e il problema è che l'interfaccia non le usa. Quindi non si
aggiunge niente, e per tre casi in particolare la scelta è deliberata:

| non aggiunta | peso | perché no |
|---|---|---|
| `motion` / Framer | ~34 KB | i micro-effetti al tocco sono `:active` + una transizione CSS; il cambio pagina è `@view-transition`, nativo e gratis |
| `sonner` | ~12 KB | gli avvisi passano già da `?ok=`/`?error=` dopo il redirect delle server action: funzionano senza JavaScript e sopravvivono a un ricaricamento. Un toast è più bello e più fragile. Base UI ha `toast` se un giorno servirà |
| `next-themes` | ~5 KB | il tema segue iOS: basta `prefers-color-scheme` (§4.3). Nessun interruttore, nessun flash |

Il target è una ZimaBoard: ogni KB è una scelta, non un dettaglio.

## 10 · Come si verifica

I colori non si provano, e un test che asserisce `bg-primary` verifica solo che ho scritto quello che
ho scritto. Quindi il ciclo RED → GREEN → REFACTOR morde dove c'è **comportamento**, e sono sei
prove, tutte su logica pura o su file su disco:

1. **`landingRoster`** — mese corrente scelto; versione più alta a parità di mese; elenco
   disordinato in ingresso; nessuna tabella per il mese corrente → la più recente; elenco vuoto →
   `null`; un solo mese con tre versioni → la 3.
2. **`monthPickerEntries`** — una voce per (anno, mese) anche con tre versioni; ordine dal più
   recente; `current` sul mese di oggi; `current` falso su tutte se il mese di oggi non c'è.
3. **`menuItemsFor`** — `REFERENTE` ottiene le tre voci con gli href esatti; **`NURSE`** ottiene
   l'elenco vuoto. (I due ruoli sono `REFERENTE` e `NURSE`: sono i valori dell'`enum Role` in
   `prisma/schema.prisma`, non nomi italiani.) È la regola invariante 7 resa verificabile.
4. **`manifest()`** — `display === 'standalone'`, `start_url === '/'`, `theme_color` uguale a
   `--background` chiaro, e **ognuna delle icone dichiarate esiste su disco** con il lato dichiarato
   (letto con `sharp`). Un manifest che promette un'icona assente è un'installazione senza icona.
5. **Guardia sui colori letterali** — scandisce `src/app/**/*.tsx` e `src/components/**/*.tsx` e
   fallisce se trova `(bg|text|border|ring|fill|stroke|divide|from|to|via|placeholder|shadow|outline|accent|caret|decoration)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}`.
   Un secondo modello copre i colori senza suffisso numerico:
   `(bg|text|border|fill|stroke|divide|ring)-(white|black)\b` — `bg-white` non ha cifre e sfuggirebbe
   al primo. **Non** vieta `dark:`: i dieci usi in `components/ui/` sono legittimi e su token (§4.3). È il solo
   modo per cui la regola di §4.1 resta vera il mese prossimo invece di essere una buona intenzione.
6. **`romeYearMonth`** — `2026-08-31T23:30:00Z` → `{ 2026, 9 }` (a Roma è già il primo settembre),
   `2026-01-31T23:30:00Z` → `{ 2026, 2 }` (vale anche in ora solare, dove l'offset è +01:00),
   `2026-08-31T20:00:00Z` → `{ 2026, 8 }`. Senza questa prova il mese d'atterraggio sbaglia per
   un'ora al mese, che è il tipo di guasto che nessuno riproduce.
7. **Contrasto** — legge i token da `globals.css` e calcola il rapporto WCAG per i **due** temi.
   L'elenco delle coppie è esplicito, non dedotto da un modello sui nomi: `--sunday` per esempio
   **non** ha un `--sunday-foreground`, perché non ci si scrive sopra — colora una cifra e un fondo
   tenue. Soglia **4,5:1**:

   | testo | su fondo |
   |---|---|
   | `--foreground` | `--background` |
   | `--muted-foreground` | `--background` |
   | `--card-foreground` | `--card` |
   | `--popover-foreground` | `--popover` |
   | `--primary-foreground` | `--primary` |
   | `--secondary-foreground` | `--secondary` |
   | `--accent-foreground` | `--accent` |
   | `--ok-foreground` | `--ok` |
   | `--ok-soft-foreground` | `--ok-soft` |
   | `--warn-foreground` | `--warn` |
   | `--warn-soft-foreground` | `--warn-soft` |
   | `--destructive-foreground` | `--destructive` |
   | `--destructive-soft-foreground` | `--destructive-soft` |
   | `--sunday-soft-foreground` | `--sunday-soft` |

   Soglia **3:1** per `--input` su `--background` e per `--sunday` su `--background` (è una cifra
   grande, non testo corrente).

   **`--border` è esente, e la ragione conta.** Il criterio WCAG 1.4.11 chiede 3:1 per l'informazione
   visiva *necessaria a identificare un componente*, non per ogni separatore. Il confine di un campo
   di testo è necessario — devi vedere dove toccare — e con `#DFE8EF` su `#F2F6F9` stava a **1,14:1**:
   quello è un difetto vero, e `--input` diventa `#618EB0` (chiaro) / `#4E6A84` (scuro), 3,22:1 in
   entrambi i temi. Il bordo di una scheda bianca su fondo azzurro **non** è necessario: la scheda si
   identifica dal riempimento e dall'ombra, e il filo è decorazione. Imporgli 3:1 disegnerebbe ogni
   scheda con un contorno blu-grigio ben visibile — un wireframe al posto della veste «Corsia», che
   è esattamente quello che è successo la prima volta che la prova è girata. Quindi `--border` resta
   `#DFE8EF` / `#24313D`.

   Serve a non dover *dichiarare* che i contrasti tengono: li prova la suite, e se qualcuno ritocca
   un esadecimale se ne accorge subito.

Le 897 prove esistenti restano verdi e non si riscrivono. Dopo ogni passo: `npm test` e
`npm run lint` (che è `eslint` + `tsc --noEmit`, quindi su un checkout pulito serve prima
`npx next typegen`).

Quello che **non** ha una prova, dichiarato apertamente: la resa visiva, la scelta dei valori
esadecimali, e il fatto che sull'iPhone di tua moglie sia bello. Quello si guarda, sul telefono, ed
è il §11.

## 11 · Il ciclo completo in locale

Prima di provare qualsiasi cosa: **oggi in locale non si entra.** `DEV_LOGIN_EMAILS` non è
impostata, e `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` nel `.env` sono lunghi 48 e 25 caratteri —
un client Google vero è ~72 e ~35 — quindi sono i segnaposto di `.env.example`.

Ordine dei passi, con il punto di fermata concordato:

1. veste e guscio (§4–§8), provati con `DEV_LOGIN_EMAILS` su due indirizzi finti: si percorre
   login → mese → correzione → conferma senza toccare Google;
2. **si ferma qui**, e si configura Google insieme: client OAuth «Web application» su Google Cloud
   Console, redirect `http://localhost:3001/api/auth/google/callback` (Google accetta `localhost`:
   nessun tunnel serve), scope `openid email profile` + `calendar.events` +
   **`calendar.app.created`** — quest'ultimo è obbligatorio, senza di lui la creazione del calendario
   dedicato risponde 403;
3. ciclo completo: foto reale → anteprima dei tagli → estrazione su Gemini (**una chiamata,
   150–165 s**) → associazione colonna→persona → griglia → correzione a mano → conferma → **evento
   vero sul Google Calendar**;
4. `DEV_LOGIN_EMAILS` **si rimuove** prima di qualsiasi esposizione fuori dal Mac;
5. solo dopo, il deploy sulla ZimaBoard.

Il punto 3 è la prima volta che il percorso passa dalle route HTTP e dal job invece che dallo script
di misura, e la prima volta in assoluto che qualcuno vede il sync funzionare.

## 12 · Rischi, e cosa si è scelto di non fare

- **`start_url: '/'` con un redirect.** L'app installata parte da `/`, che reindirizza. Costa un
  salto in più all'avvio. L'alternativa — salvare l'ultima tabella vista in un cookie — aggiunge
  stato per risparmiare un redirect: non vale.
- **Il mese in corso può non esistere.** A inizio mese, prima che la referente carichi la foto,
  l'atterraggio cade sul mese precedente. È il comportamento giusto (i turni di ieri sono ancora
  informazione), ma l'header deve rendere **ovvio** quale mese si sta guardando: è la ragione per
  cui il mese è il titolo della schermata e non una didascalia.
- **La direzione «Corsia» è la più familiare e la meno memorabile**, per sua natura. Era il
  compromesso accettato scegliendola: se c'è un solo tentativo per convincere un'infermiera a usare
  l'app, la familiarità vale più della personalità.
- **Non si mescolano le direzioni.** L'opzione era sul tavolo (la densità della direzione uno con i
  colori della tre) e non è stata scelta: si fa «Corsia» intera, e si guarda sul telefono vero prima
  di ritoccare. Cambiare i valori dei token dopo costa un file.
