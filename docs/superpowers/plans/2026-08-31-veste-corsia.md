# Veste «Corsia» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vestire tutta l'interfaccia con la direzione «Corsia», mobile-first per iPhone, come PWA
installabile che si apre direttamente sui turni del mese in corso.

**Architecture:** Tre strati, in questo ordine. (1) I **token**: l'intera palette passa a
esadecimale in `globals.css`, con coppie semantiche nuove (`--ok`, `--warn`, `--sunday`) e il tema
scuro in `@media (prefers-color-scheme: dark)`, così nessuna pagina nomina più un colore. (2) Il
**guscio**: Figtree, `viewport` con `viewportFit: 'cover'`, manifest e icone, componenti condivisi
(`AppHeader`, `ActionDock`, `Banner`) e taglie da tocco da 44 px sui controlli shadcn, che oggi
sono scalati per il desktop e per questo vengono aggirati. (3) Le **pagine**, una per una, con
l'atterraggio spostato sul mese corrente. La logica applicativa (`extract`, `roster`, `review`,
`calendar`) non si tocca: le sole funzioni nuove sono quattro, pure, con la loro prova.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui stile `base-nova`
sopra `@base-ui/react` 1.7 · `lucide-react` · `sharp` · Vitest. **Nessuna dipendenza nuova.**

**Spec:** [docs/superpowers/specs/2026-08-31-veste-corsia-design.md](../specs/2026-08-31-veste-corsia-design.md)

## Global Constraints

- **Node 22 obbligatorio.** La shell può partire su una versione più vecchia: verifica con `node -v`
  e, se serve, `. "$NVM_DIR/nvm.sh"; nvm use 22` prima di installare o eseguire i test. Su Node 18
  vitest muore con `SyntaxError: ... 'node:util' does not provide an export named 'styleText'`.
- **Nessuna dipendenza nuova**, né di runtime né di sviluppo. In particolare **non** si aggiungono
  `motion`/Framer, `sonner`, `next-themes`, `jsdom`, `@testing-library/*`.
- **TDD non negoziabile:** RED → GREEN → REFACTOR. Il test si scrive prima, **si esegue**, e deve
  fallire per il motivo giusto. Non si dichiara niente «fatto» senza aver eseguito `npm test` e
  letto l'output.
- **Nessun file sotto `src/app/` o `src/components/` nomina una famiglia di colore Tailwind**
  (`emerald-500`, `gray-600`, `bg-white`…). Ogni colore arriva da un token. La prova di guardia del
  Task 1 lo verifica.
- **Lo zoom resta abilitato:** non si scrive `maximumScale` né `userScalable: false`.
- **Ogni cosa toccabile è alta almeno 44 px**; nella griglia di conferma, dove i bottoni stanno in
  colonna, 48 px.
- **I confini dei moduli non si aggirano:** il codice applicativo importa dalla facciata
  (`@/modules/review`), le prove di logica pura importano il sottomodulo (`@/modules/review/landing`)
  perché le facciate tirano dentro Prisma e `next/headers`.
- **Identificatori e messaggi di commit in inglese; testi dell'interfaccia, commenti e descrizioni
  dei test in italiano.**
- **I codici turno restano in italiano** come sulla carta (`M`, `P`, `NOTTE`, `RP`).
- **Le 897 prove esistenti restano verdi e non si riscrivono.** Dopo ogni task: `npm test` e
  `npm run lint`. Su un checkout pulito `npm run lint` richiede prima `npx next typegen`.
- Server Components per default; `"use client"` solo dove serve interattività (in questo piano: un
  file solo, `app-menu.tsx`).
- **I due ruoli sono `REFERENTE` e `NURSE`**, i valori dell'`enum Role` in `prisma/schema.prisma`.

---

## Mappa dei file

### Creati

| file | responsabilità |
|---|---|
| `src/lib/contrast.ts` | rapporto di contrasto WCAG da esadecimale. Puro, nessuna dipendenza |
| `src/modules/review/landing.ts` | `landingRoster`, `monthPickerEntries`: su quale tabella si apre l'app e quali mesi elenca il selettore |
| `src/modules/auth/menu.ts` | `menuItemsFor`: le voci del ⋯ per ruolo |
| `src/app/manifest.ts` | manifest della PWA |
| `scripts/generate-icons.ts` | genera le cinque icone da un SVG con `sharp`. Si esegue una volta, l'esito si committa |
| `src/components/banner.tsx` | `Banner` + `bannerClasses`: **un solo** riquadro d'avviso, quattro varianti |
| `src/components/action-dock.tsx` | `ActionDock`: le azioni fisse in fondo, con la safe-area |
| `src/components/app-header.tsx` | `AppHeader`: titolo, chevron al selettore, ⋯, safe-area in cima |
| `src/components/app-menu.tsx` | `AppMenu` (`"use client"`): il foglio dal basso |
| `src/components/empty-state.tsx` | `EmptyState`: titolo, spiegazione, un'azione |
| `src/app/rosters/[id]/review/day-row.tsx` | `DayRow`: una riga giorno della griglia |
| `src/app/rosters/[id]/review/column-summary.tsx` | `ColumnSummary`: la testa della colonna |
| `tests/helpers/tokens.ts` | legge i token esadecimali da `globals.css`, per tema |

### Modificati

| file | cosa |
|---|---|
| `src/app/globals.css` | palette in esadecimale, token semantici, `@custom-variant dark`, `@theme inline`, `@view-transition` |
| `src/app/layout.tsx` | Figtree al posto di Geist, `viewport`, safe-area sul `<body>` |
| `src/lib/time.ts` | `romeYearMonth` |
| `src/components/ui/button.tsx` | taglie `touch` e `icon-touch` |
| `src/components/ui/input.tsx` | `h-8` → `h-11`, `px-2.5` → `px-3` |
| `src/components/ui/select.tsx` | `data-[size=touch]:h-11` sul trigger |
| `src/modules/review/index.ts` | esporta `landing.ts` |
| `src/modules/auth/index.ts` | esporta `menu.ts` |
| `src/app/page.tsx` | da home di bottoni a redirect + stato vuoto |
| `src/app/rosters/page.tsx` | selettore dei mesi |
| `src/app/rosters/[id]/review/page.tsx` | veste, e spezzata in `DayRow` + `ColumnSummary` |
| `src/app/rosters/[id]/review/sync-button.tsx` | `Button` con taglia da tocco |
| `src/app/rosters/[id]/page.tsx` | veste, `Progress` di Base UI |
| `src/app/rosters/[id]/extraction-progress.tsx` | veste |
| `src/app/rosters/[id]/columns/page.tsx` | veste |
| `src/app/rosters/upload/page.tsx` | veste, selettore foto grande |
| `src/app/settings/codes/page.tsx` | tabella a 5 colonne → schede |
| `src/app/settings/users/page.tsx` | veste |
| `src/app/login/page.tsx` | veste |

### Generati e committati

`src/app/icon.png` (512) · `src/app/apple-icon.png` (180) · `public/icon-192.png` ·
`public/icon-512.png` · `public/icon-maskable-512.png`

---

## Task 1: Token, contrasto e la guardia sui colori

**Files:**
- Create: `src/lib/contrast.ts`, `tests/lib/contrast.test.ts`, `tests/helpers/tokens.ts`,
  `tests/lib/no-literal-colors.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: niente.
- Produces: `contrastRatio(a: string, b: string): number`, `relativeLuminance(hex: string): number`,
  `parseHex(hex: string): { r: number; g: number; b: number }` da `@/lib/contrast`;
  `tokenColors(tema: 'chiaro' | 'scuro'): Record<string, string>` da `tests/helpers/tokens`; e i
  token CSS che ogni task successivo usa: `--background --foreground --card --card-foreground
  --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground
  --accent --accent-foreground --muted --muted-foreground --border --input --ring --ok
  --ok-foreground --ok-soft --ok-soft-foreground --warn --warn-foreground --warn-soft
  --warn-soft-foreground --destructive --destructive-foreground --destructive-soft
  --destructive-soft-foreground --sunday --sunday-soft --sunday-soft-foreground`.

- [ ] **Step 1: Scrivi la prova che fallisce, sul calcolo del contrasto**

`tests/lib/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHex, relativeLuminance } from '@/lib/contrast'

describe('parseHex', () => {
  it('legge #RRGGBB', () => {
    expect(parseHex('#1A6FD4')).toEqual({ r: 26, g: 111, b: 212 })
  })

  it('accetta le minuscole e gli spazi intorno', () => {
    expect(parseHex('  #ffffff ')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('rifiuta quello che non è un esadecimale a sei cifre, invece di restituire NaN', () => {
    // Un NaN silenzioso qui diventerebbe un rapporto di contrasto finto, e la
    // prova sui token passerebbe senza aver misurato niente.
    expect(() => parseHex('oklch(0.5 0 0)')).toThrow(/esadecimale/)
    expect(() => parseHex('#fff')).toThrow(/esadecimale/)
  })
})

describe('relativeLuminance', () => {
  it('vale 0 sul nero e 1 sul bianco', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6)
  })
})

describe('contrastRatio', () => {
  it('dà 21 fra nero e bianco', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2)
  })

  it('dà 1 fra un colore e se stesso', () => {
    expect(contrastRatio('#1A6FD4', '#1A6FD4')).toBeCloseTo(1, 6)
  })

  it('non dipende dall ordine degli argomenti', () => {
    expect(contrastRatio('#1A6FD4', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#1A6FD4'),
      6,
    )
  })

  it('misura il blu delle azioni con testo bianco sopra la soglia di 4,5', () => {
    expect(contrastRatio('#1A6FD4', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })

  it('boccia il verde che era stato scelto per primo', () => {
    // #0F8A60 dava 4,35:1 con testo bianco: è stato sostituito da #0C7A55.
    // Questa prova esiste perché quel valore non torni per distrazione.
    expect(contrastRatio('#0F8A60', '#FFFFFF')).toBeLessThan(4.5)
    expect(contrastRatio('#0C7A55', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })
})
```

- [ ] **Step 2: Esegui la prova e verifica che fallisca**

Run: `. "$NVM_DIR/nvm.sh"; nvm use 22; npx vitest run tests/lib/contrast.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/contrast"`.

- [ ] **Step 3: Scrivi `src/lib/contrast.ts`**

```ts
/**
 * Rapporto di contrasto WCAG 2.1. Serve alla prova sui token della veste: le
 * soglie di leggibilità si misurano, non si dichiarano.
 */

/** Un colore #RRGGBB. La palette non usa l alfa, quindi non si accetta. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  const trovato = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!trovato) throw new Error(`Colore non esadecimale a sei cifre: ${hex}`)
  const numero = Number.parseInt(trovato[1], 16)
  return { r: (numero >> 16) & 0xff, g: (numero >> 8) & 0xff, b: numero & 0xff }
}

function canale(componente: number): number {
  const normalizzato = componente / 255
  return normalizzato <= 0.03928
    ? normalizzato / 12.92
    : ((normalizzato + 0.055) / 1.055) ** 2.4
}

/** Luminanza relativa: 0 sul nero, 1 sul bianco. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * canale(r) + 0.7152 * canale(g) + 0.0722 * canale(b)
}

/** Fra 1 (colori identici) e 21 (nero su bianco). */
export function contrastRatio(a: string, b: string): number {
  const primo = relativeLuminance(a)
  const secondo = relativeLuminance(b)
  return (Math.max(primo, secondo) + 0.05) / (Math.min(primo, secondo) + 0.05)
}
```

- [ ] **Step 4: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/lib/contrast.test.ts`
Expected: PASS, 9 prove.

- [ ] **Step 5: Scrivi il lettore dei token e la prova sui token, che deve fallire**

`tests/helpers/tokens.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

const PERCORSO_CSS = path.join(import.meta.dirname, '../../src/app/globals.css')

/** Il blocco graffe-bilanciate che comincia con `apertura`. */
function blocco(css: string, apertura: string): string {
  const inizio = css.indexOf(apertura)
  if (inizio === -1) throw new Error(`Blocco non trovato in globals.css: ${apertura}`)
  let profondita = 0
  for (let i = inizio + apertura.length - 1; i < css.length; i += 1) {
    if (css[i] === '{') profondita += 1
    else if (css[i] === '}') {
      profondita -= 1
      if (profondita === 0) return css.slice(inizio, i + 1)
    }
  }
  throw new Error(`Blocco non chiuso in globals.css: ${apertura}`)
}

/**
 * I token colore di un tema, senza il `--` iniziale. Il tema chiaro sta nel
 * `:root` in cima al file, lo scuro nel `:root` dentro la media query: l ordine
 * dei due blocchi nel file conta, ed è quello che la spec fissa.
 */
export function tokenColors(tema: 'chiaro' | 'scuro'): Record<string, string> {
  const css = readFileSync(PERCORSO_CSS, 'utf8')
  const sorgente =
    tema === 'chiaro'
      ? blocco(css, ':root {')
      : blocco(blocco(css, '@media (prefers-color-scheme: dark) {'), ':root {')

  const token: Record<string, string> = {}
  for (const trovato of sorgente.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    token[trovato[1]] = trovato[2]
  }
  return token
}
```

Nello stesso file `tests/lib/contrast.test.ts`: aggiungi **in cima**, accanto agli import che ci
sono già, `import { tokenColors } from '../helpers/tokens'` — e **non** un secondo import di
`contrastRatio`, che è già importato. Poi, in fondo al file:

```ts
/** Le coppie sono elencate, non dedotte dai nomi: `--sunday` non ha un `--sunday-foreground`. */
const COPPIE_TESTO: ReadonlyArray<readonly [string, string]> = [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['ok-foreground', 'ok'],
  ['ok-soft-foreground', 'ok-soft'],
  ['warn-foreground', 'warn'],
  ['warn-soft-foreground', 'warn-soft'],
  ['destructive-foreground', 'destructive'],
  ['destructive-soft-foreground', 'destructive-soft'],
  ['sunday-soft-foreground', 'sunday-soft'],
]

/** Bordi e cifre grandi: 3:1 basta, non è testo corrente. */
const COPPIE_NON_TESTO: ReadonlyArray<readonly [string, string]> = [
  ['border', 'background'],
  ['sunday', 'background'],
]

describe.each(['chiaro', 'scuro'] as const)('token della veste, tema %s', (tema) => {
  const token = tokenColors(tema)

  it('dichiara tutti i token che le coppie citano', () => {
    const citati = [...COPPIE_TESTO, ...COPPIE_NON_TESTO].flat()
    const mancanti = citati.filter((nome) => token[nome] === undefined)
    expect(mancanti).toEqual([])
  })

  it.each(COPPIE_TESTO)('%s su %s sta a 4,5:1 o meglio', (davanti, dietro) => {
    expect(contrastRatio(token[davanti], token[dietro])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(COPPIE_NON_TESTO)('%s su %s sta a 3:1 o meglio', (davanti, dietro) => {
    expect(contrastRatio(token[davanti], token[dietro])).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 6: Esegui e verifica che fallisca sui token, non sul calcolo**

Run: `npx vitest run tests/lib/contrast.test.ts`
Expected: FAIL — `globals.css` dichiara ancora la palette in `oklch(...)`, quindi `tokenColors`
restituisce un oggetto vuoto e la prova «dichiara tutti i token che le coppie citano» elenca tutti i
nomi come mancanti. **Questo è il fallimento giusto:** se invece fallisse `parseHex`, vorrebbe dire
che il regex sta pescando `oklch`.

- [ ] **Step 7: Riscrivi la palette in `src/app/globals.css`**

Sostituisci il blocco `:root { ... }` e il blocco `.dark { ... }` esistenti con:

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

  /* Generati da shadcn, inerti: questa app non ha grafici né barra laterale.
     Restano perché toglierli farebbe fallire un futuro `shadcn add`. */
  --chart-1: #A8CDF7;
  --chart-2: #5EA3F0;
  --chart-3: #1A6FD4;
  --chart-4: #14548F;
  --chart-5: #0F1B24;
  --sidebar: #FFFFFF;
  --sidebar-foreground: #0F1B24;
  --sidebar-primary: #1A6FD4;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: #DCE9F7;
  --sidebar-accent-foreground: #14548F;
  --sidebar-border: #DFE8EF;
  --sidebar-ring: #1A6FD4;
}

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

    --chart-1: #14548F;
    --chart-2: #1A6FD4;
    --chart-3: #5EA3F0;
    --chart-4: #A8CDF7;
    --chart-5: #E6EDF3;
    --sidebar: #16212C;
    --sidebar-foreground: #E6EDF3;
    --sidebar-primary: #5EA3F0;
    --sidebar-primary-foreground: #06182B;
    --sidebar-accent: #1B2F45;
    --sidebar-accent-foreground: #A8CDF7;
    --sidebar-border: #24313D;
    --sidebar-ring: #5EA3F0;
  }
}
```

**Il blocco `:root` chiaro deve stare prima della media query**: `tokenColors('chiaro')` prende il
primo `:root {` del file.

- [ ] **Step 8: Cambia la variante `dark` e dichiara i token semantici**

In `src/app/globals.css`, sostituisci la riga:

```css
@custom-variant dark (&:is(.dark *));
```

con:

```css
/* Il tema segue iOS: nessun interruttore, nessuna classe `.dark` da mettere su
   <html>, nessun flash al caricamento. I dieci `dark:` dentro components/ui
   dipendono da questa riga: con il selettore `.dark *` non scattavano mai. Se un
   giorno servisse un interruttore manuale, è questa riga da riscrivere. */
@custom-variant dark (@media (prefers-color-scheme: dark));
```

E aggiungi dentro `@theme inline { ... }`, accanto a quelli che ci sono già:

```css
  --color-ok: var(--ok);
  --color-ok-foreground: var(--ok-foreground);
  --color-ok-soft: var(--ok-soft);
  --color-ok-soft-foreground: var(--ok-soft-foreground);
  --color-warn: var(--warn);
  --color-warn-foreground: var(--warn-foreground);
  --color-warn-soft: var(--warn-soft);
  --color-warn-soft-foreground: var(--warn-soft-foreground);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-destructive-soft: var(--destructive-soft);
  --color-destructive-soft-foreground: var(--destructive-soft-foreground);
  --color-sunday: var(--sunday);
  --color-sunday-soft: var(--sunday-soft);
  --color-sunday-soft-foreground: var(--sunday-soft-foreground);
```

E in fondo al file:

```css
/* Transizione fra pagine nativa: zero byte di JavaScript. Dentro la media query
   perché chi ha chiesto meno animazioni ha chiesto anche questa. */
@media (prefers-reduced-motion: no-preference) {
  @view-transition {
    navigation: auto;
  }
}
```

- [ ] **Step 9: Esegui la prova sui token e verifica che passi**

Run: `npx vitest run tests/lib/contrast.test.ts`
Expected: PASS. Se una coppia fallisce, **si scurisce o si schiarisce il valore restando sulla stessa
tinta** — non si abbassa la soglia.

- [ ] **Step 10: Scrivi la guardia sui colori letterali, con l'elenco che si accorcia**

`tests/lib/no-literal-colors.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RADICE = path.join(import.meta.dirname, '../../src')

/**
 * Le pagine non ancora convertite alla veste «Corsia».
 *
 * **Questo elenco si accorcia.** Ogni task che riveste una pagina la toglie da
 * qui prima di toccarla, così la prova diventa rossa e guida il lavoro. Quando è
 * vuoto, si cancella l elenco insieme a questo commento e alla prova che lo usa.
 */
const DA_CONVERTIRE: readonly string[] = [
  'app/login/page.tsx',
  'app/rosters/[id]/page.tsx',
  'app/rosters/[id]/review/page.tsx',
  'app/settings/codes/page.tsx',
  'app/settings/users/page.tsx',
]

const FAMIGLIE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const UTILITY =
  'bg|text|border|ring|fill|stroke|divide|from|to|via|placeholder|shadow|outline|accent|caret|decoration'

/** `bg-emerald-50`, `dark:text-amber-900`, `hover:border-rose-300`. */
const CON_CIFRE = new RegExp(`\\b(?:${UTILITY})-(?:${FAMIGLIE})-\\d{2,3}\\b`, 'g')
/** `bg-white` non ha cifre e sfuggirebbe al primo modello. */
const SENZA_CIFRE = /\b(?:bg|text|border|fill|stroke|divide|ring)-(?:white|black)\b/g

function sorgenti(cartella: string): string[] {
  const trovati: string[] = []
  for (const voce of readdirSync(cartella)) {
    const completo = path.join(cartella, voce)
    if (statSync(completo).isDirectory()) trovati.push(...sorgenti(completo))
    else if (voce.endsWith('.tsx')) trovati.push(completo)
  }
  return trovati
}

function coloriLetterali(file: string): string[] {
  const testo = readFileSync(file, 'utf8')
  return [...testo.matchAll(CON_CIFRE), ...testo.matchAll(SENZA_CIFRE)].map((m) => m[0])
}

const TUTTI = [
  ...sorgenti(path.join(RADICE, 'app')),
  ...sorgenti(path.join(RADICE, 'components')),
].map((file) => path.relative(RADICE, file))

describe('nessuna pagina nomina un colore', () => {
  const convertiti = TUTTI.filter((file) => !DA_CONVERTIRE.includes(file))

  it.each(convertiti)('%s usa solo token', (relativo) => {
    expect(coloriLetterali(path.join(RADICE, relativo))).toEqual([])
  })

  // Senza questa, una pagina convertita e dimenticata nell elenco smetterebbe di
  // essere protetta in silenzio: l elenco resterebbe lungo e nessuno lo saprebbe.
  it.each(DA_CONVERTIRE)('%s è ancora nell elenco a ragione', (relativo) => {
    expect(TUTTI).toContain(relativo)
    expect(coloriLetterali(path.join(RADICE, relativo)).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 11: Esegui la guardia e verifica che passi**

Run: `npx vitest run tests/lib/no-literal-colors.test.ts`
Expected: PASS — i cinque file con colori letterali sono nell'elenco e ci sono a ragione, tutti gli
altri sono già puliti. Se un sesto file avesse colori letterali, fallirebbe qui: aggiungilo
all'elenco **e** dillo nel messaggio di commit.

- [ ] **Step 12: Esegui la suite intera e il lint**

Run: `npm test && npx next typegen && npm run lint`
Expected: tutte verdi (897 esistenti + le nuove), lint pulito.

- [ ] **Step 13: Commit**

```bash
git add src/lib/contrast.ts src/app/globals.css tests/lib/contrast.test.ts \
        tests/lib/no-literal-colors.test.ts tests/helpers/tokens.ts
git commit -m "feat(ui): Corsia palette as measured semantic tokens

The whole palette moves from oklch to hex so a test can read it, and
gains semantic pairs (--ok, --warn, --sunday) plus soft variants. A
contrast test measures 16 pairs in both themes instead of us claiming
they are legible -- it already rejected the first green (#0F8A60 gave
4.35:1 with white text). The dark variant becomes a media query: the ten
dark: utilities in components/ui never fired under the .dark selector,
because nothing puts that class on <html>."
```

---

## Task 2: Figtree, viewport e il guscio

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/globals.css`
- Create: `tests/app/layout.test.ts`

**Interfaces:**
- Consumes: i token del Task 1 (`--background` chiaro `#F2F6F9`, scuro `#0E1620`).
- Produces: `viewport` e `metadata` esportati da `@/app/layout`; la variabile CSS `--font-figtree`;
  le classi `pt-safe` / `pb-safe` / `px-safe` usate da `AppHeader` e `ActionDock`.

- [ ] **Step 1: Scrivi la prova che fallisce**

`tests/app/layout.test.ts`. **Il mock di `next/font/google` è obbligatorio, non una comodità:**
fuori dal compilatore di Next quel modulo non si può nemmeno risolvere (`Directory import ... is not
supported`), quindi senza il mock la prova fallirebbe all'import invece di misurare il `viewport`.

```ts
import { describe, expect, it, vi } from 'vitest'

// `Figtree()` è una chiamata che solo il compilatore di Next sa eseguire. Qui
// serve soltanto che `layout.tsx` si importi: del carattere non si prova niente.
vi.mock('next/font/google', () => ({
  Figtree: () => ({ variable: '--font-figtree', className: 'font-figtree', style: {} }),
}))

const { metadata, viewport } = await import('@/app/layout')
const { tokenColors } = await import('../helpers/tokens')

describe('viewport del guscio', () => {
  it('porta il contenuto sotto il notch', () => {
    // Senza `cover` le safe-area valgono zero e il dock non ha da cosa scostarsi.
    expect(viewport.viewportFit).toBe('cover')
  })

  it('lascia lo zoom abilitato', () => {
    // Disattivarlo è un difetto di accessibilità, non una rifinitura: su un app
    // che si guarda alle sei del mattino è esattamente la cosa da non fare.
    expect(viewport.maximumScale).toBeUndefined()
    expect(viewport.userScalable).toBeUndefined()
  })

  it('dichiara i due temi ai controlli di sistema', () => {
    expect(viewport.colorScheme).toBe('light dark')
  })

  it('tinge la barra di stato del colore del fondo, in entrambi i temi', () => {
    // Un `theme_color` diverso dal fondo disegna una riga in cima allo schermo.
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: tokenColors('chiaro').background },
      { media: '(prefers-color-scheme: dark)', color: tokenColors('scuro').background },
    ])
  })
})

describe('metadata', () => {
  it('si chiama Turni', () => {
    expect(metadata.title).toBe('Turni')
  })

  it('dichiara che è un applicazione web capace, così iOS la apre a schermo intero', () => {
    expect(metadata.appleWebApp).toMatchObject({ capable: true, title: 'Turni' })
  })
})
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/app/layout.test.ts`
Expected: FAIL — `layout.tsx` non esporta `viewport`, quindi `viewport.viewportFit` solleva
`TypeError: Cannot read properties of undefined`.

- [ ] **Step 3: Riscrivi `src/app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from 'next'
import { Figtree } from 'next/font/google'
import './globals.css'

const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Turni',
  description: 'I tuoi turni, dalla tabella del reparto al calendario.',
  applicationName: 'Turni',
  // Senza questo iOS apre il collegamento in Safari invece che a schermo intero.
  appleWebApp: { capable: true, title: 'Turni', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Il contenuto arriva sotto il notch: da qui in poi le safe-area sono
  // obbligatorie, o il bottone in fondo finisce sotto la barra dei gesti.
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F6F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1620' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="it" className={`${figtree.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col">{children}</body>
    </html>
  )
}
```

- [ ] **Step 4: Aggancia il carattere e le classi safe-area in `globals.css`**

Dentro `@theme inline`, sostituisci le due righe dei caratteri:

```css
  --font-sans: var(--font-figtree);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
```

(le vecchie erano `var(--font-geist-sans)` e `var(--font-geist-mono)`; Geist Mono esce, e con lui un
download.)

E dentro `@layer base`, aggiungi le tre classi che il guscio usa — sono aiuti, non decorazione, e
stanno qui perché `env()` non si può scrivere in una utility Tailwind:

```css
@layer base {
  /* Le cifre in colonna si allineano: giorni, orari, contatori. */
  .tabular {
    font-variant-numeric: tabular-nums;
  }
  /* Safe-area. Il `max()` tiene un margine minimo sui telefoni senza notch. */
  .pt-safe {
    padding-top: max(0.5rem, env(safe-area-inset-top));
  }
  .pb-safe {
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }
  .px-safe {
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
  }
}
```

- [ ] **Step 5: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/app/layout.test.ts`
Expected: PASS, 6 prove.

- [ ] **Step 6: Guarda con gli occhi che il carattere sia arrivato**

Run: `npm run dev` e apri `http://localhost:3001` (o 3000: `APP_URL` dice 3001, `next dev` usa 3000
se libera — guarda cosa stampa).
Expected: il testo è in Figtree, non in Geist. Nel pannello dei caratteri degli strumenti di
sviluppo compare `Figtree`, e **non** compare `Geist`. Se compare Geist, `@theme inline` ha ancora la
riga vecchia.

- [ ] **Step 7: Suite intera, lint, commit**

```bash
npm test && npx next typegen && npm run lint
git add src/app/layout.tsx src/app/globals.css tests/app/layout.test.ts
git commit -m "feat(ui): Figtree, full-bleed viewport and safe-area helpers

Geist and Geist Mono both go: Figtree carries the whole Corsia direction
and the mono stack becomes the system one, saving a download. The
viewport goes viewport-fit: cover, so the safe-area helpers land in the
same commit -- without them the bottom action dock sits under the home
indicator. Zoom stays enabled on purpose, and a test asserts it."
```

---

## Task 3: Manifest e icone

**Files:**
- Create: `scripts/generate-icons.ts`, `src/app/manifest.ts`, `tests/app/manifest.test.ts`
- Generate and commit: `src/app/icon.png`, `src/app/apple-icon.png`, `public/icon-192.png`,
  `public/icon-512.png`, `public/icon-maskable-512.png`

**Interfaces:**
- Consumes: `--background` chiaro `#F2F6F9` (Task 1).
- Produces: `manifest(): MetadataRoute.Manifest` da `@/app/manifest`.

- [ ] **Step 1: Scrivi la prova che fallisce**

`tests/app/manifest.test.ts`:

```ts
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import manifest from '@/app/manifest'
import { tokenColors } from '../helpers/tokens'

const RADICE = path.join(import.meta.dirname, '../..')

describe('manifest della PWA', () => {
  const m = manifest()

  it('si installa e si apre a schermo intero', () => {
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(m.name).toBe('Turni')
    expect(m.short_name).toBe('Turni')
    expect(m.lang).toBe('it')
  })

  it('tinge la barra di stato come il fondo chiaro', () => {
    expect(m.theme_color).toBe(tokenColors('chiaro').background)
    expect(m.background_color).toBe(tokenColors('chiaro').background)
  })

  it('dichiara un icona mascherabile, che è quella che iOS e Android ritagliano', () => {
    const mascherabili = (m.icons ?? []).filter((icona) => icona.purpose === 'maskable')
    expect(mascherabili).toHaveLength(1)
  })

  // Un manifest che promette un icona assente è un installazione senza icona, e
  // non lo dice nessuno: il browser mette un rettangolo grigio e via.
  it('ogni icona promessa esiste su disco, del lato dichiarato', async () => {
    for (const icona of m.icons ?? []) {
      const file = path.join(RADICE, 'public', String(icona.src))
      expect(existsSync(file), `manca ${icona.src}`).toBe(true)

      const [larghezza, altezza] = String(icona.sizes).split('x').map(Number)
      const dati = await sharp(file).metadata()
      expect(dati.width, `${icona.src} larghezza`).toBe(larghezza)
      expect(dati.height, `${icona.src} altezza`).toBe(altezza)
    }
  })

  it('porta anche le icone che Next aggancia da sé', async () => {
    // `src/app/icon.png` e `src/app/apple-icon.png` non stanno nel manifest:
    // Next genera i <link> da sé sulla convenzione dei nomi. Se sparissero,
    // la scheda del browser e la schermata Home resterebbero senza icona senza
    // che nessuna prova sul manifest se ne accorga.
    for (const [file, lato] of [
      ['src/app/icon.png', 512],
      ['src/app/apple-icon.png', 180],
    ] as const) {
      const completo = path.join(RADICE, file)
      expect(existsSync(completo), `manca ${file}`).toBe(true)
      const dati = await sharp(completo).metadata()
      expect(dati.width, `${file} lato`).toBe(lato)
      expect(dati.height, `${file} lato`).toBe(lato)
    }
  })
})
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/app/manifest.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/manifest"`.

- [ ] **Step 3: Scrivi lo script che genera le icone**

`scripts/generate-icons.ts`:

```ts
/**
 * Genera le cinque icone della PWA da un SVG, una volta sola: l esito si
 * committa. Su una ZimaBoard un icona prodotta da una route è CPU spesa a ogni
 * richiesta per un immagine che non cambia mai.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * Il segno: la tabella turni con un turno confermato — una griglia di caselle
 * bianche 4 colonne × 5 righe su fondo blu, tutte al 40% tranne una piena.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const BLU = '#1A6FD4'
const COLONNE = 4
const RIGHE = 5
/** La casella piena: riga 2, colonna 3 (contate da 1). */
const PIENA = { riga: 2, colonna: 3 }

/**
 * @param lato   lato dell immagine in pixel
 * @param scala  quanta parte del lato occupa la griglia (il resto è margine)
 * @param raggio angolo del fondo; 0 per le icone che il sistema ritaglia da sé
 */
function svg(lato: number, scala: number, raggio: number): string {
  const area = lato * scala
  const margineX = (lato - area) / 2
  const margineY = (lato - area) / 2
  const passoX = area / COLONNE
  const passoY = area / RIGHE
  // Casella quadrata sul più piccolo dei due passi: 4 colonne e 5 righe in un
  // quadrato non danno passi uguali, e caselle rettangolari sembrerebbero un errore.
  const casella = Math.min(passoX, passoY) * 0.62
  const arrotonda = casella * 0.28

  let celle = ''
  for (let riga = 0; riga < RIGHE; riga += 1) {
    for (let colonna = 0; colonna < COLONNE; colonna += 1) {
      const piena = riga + 1 === PIENA.riga && colonna + 1 === PIENA.colonna
      const x = margineX + colonna * passoX + (passoX - casella) / 2
      const y = margineY + riga * passoY + (passoY - casella) / 2
      celle +=
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
        `width="${casella.toFixed(2)}" height="${casella.toFixed(2)}" ` +
        `rx="${arrotonda.toFixed(2)}" fill="#FFFFFF" fill-opacity="${piena ? '1' : '0.4'}"/>`
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}" ` +
    `viewBox="0 0 ${lato} ${lato}">` +
    `<rect width="${lato}" height="${lato}" rx="${raggio.toFixed(2)}" fill="${BLU}"/>` +
    `${celle}</svg>`
  )
}

interface Icona {
  file: string
  lato: number
  scala: number
  raggio: number
  perche: string
}

const ICONE: readonly Icona[] = [
  {
    file: 'src/app/icon.png',
    lato: 512,
    scala: 0.66,
    raggio: 512 * 0.22,
    perche: 'scheda del browser: Next genera il <link> dal nome del file',
  },
  {
    file: 'src/app/apple-icon.png',
    lato: 180,
    scala: 0.62,
    raggio: 0,
    perche: 'schermata Home di iOS: iOS arrotonda da sé, quindi il fondo va a filo',
  },
  { file: 'public/icon-192.png', lato: 192, scala: 0.66, raggio: 192 * 0.22, perche: 'manifest' },
  { file: 'public/icon-512.png', lato: 512, scala: 0.66, raggio: 512 * 0.22, perche: 'manifest, splash' },
  {
    file: 'public/icon-maskable-512.png',
    lato: 512,
    // La zona sicura di un icona mascherabile è il cerchio interno: la griglia
    // sta al 55% del lato, il blu arriva ai bordi.
    scala: 0.55,
    raggio: 0,
    perche: 'manifest, purpose: maskable',
  },
]

const radice = path.join(import.meta.dirname, '..')

for (const icona of ICONE) {
  const destinazione = path.join(radice, icona.file)
  mkdirSync(path.dirname(destinazione), { recursive: true })
  const png = await sharp(Buffer.from(svg(icona.lato, icona.scala, icona.raggio)))
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(destinazione, png)
  console.log(`${icona.file.padEnd(32)} ${icona.lato}px  ${icona.perche}`)
}
```

- [ ] **Step 4: Esegui lo script e guarda le icone**

Run: `npx tsx scripts/generate-icons.ts`
Expected: cinque righe di uscita, cinque file su disco. Aprili (`open public/icon-512.png`): si deve
vedere un quadrato blu ad angoli tondi con la griglia di caselle bianche e **una** casella accesa. Se
le caselle sono rettangolari, `casella` non sta usando il passo più piccolo.

- [ ] **Step 5: Scrivi `src/app/manifest.ts`**

```ts
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Turni',
    short_name: 'Turni',
    description: 'I tuoi turni, dalla tabella del reparto al calendario.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'it',
    // Uguali a `--background` chiaro: la barra di stato si fonde col fondo
    // invece di disegnare una riga in cima allo schermo.
    background_color: '#F2F6F9',
    theme_color: '#F2F6F9',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
```

- [ ] **Step 6: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/app/manifest.test.ts`
Expected: PASS, 5 prove.

- [ ] **Step 7: Prova l'installazione vera sull'iPhone**

Questo non ha una prova automatica e va guardato:

1. `npm run dev`, poi dall'iPhone sulla stessa rete apri `http://<ip-del-mac>:3000`
   (`ipconfig getifaddr en0` dà l'indirizzo).
2. Condividi → «Aggiungi alla schermata Home».
3. Expected: **l'icona è quella generata**, non uno screenshot della pagina; il nome proposto è
   «Turni»; aprendola **non** c'è la barra di Safari; la barra di stato è dello stesso colore del
   fondo.

Se compare uno screenshot al posto dell'icona, `src/app/apple-icon.png` non è stato trovato.

- [ ] **Step 8: Suite intera, lint, commit**

```bash
npm test && npx next typegen && npm run lint
git add scripts/generate-icons.ts src/app/manifest.ts tests/app/manifest.test.ts \
        src/app/icon.png src/app/apple-icon.png public/icon-192.png public/icon-512.png \
        public/icon-maskable-512.png
git commit -m "feat(ui): installable PWA with committed icons

The mark is the roster itself: a 4x5 grid of white cells on Corsia blue
with one cell lit -- one confirmed shift. Generated once by a script and
committed, not produced by a route: on a ZimaBoard an icon rendered per
request is CPU spent on an image that never changes. The test asserts
every icon the manifest promises actually exists at the declared size,
because a manifest pointing at a missing file installs a grey rectangle
and says nothing."
```

---

## Task 4: Taglie da tocco sui controlli

**Files:**
- Modify: `src/components/ui/button.tsx:24-35`, `src/components/ui/input.tsx:12`,
  `src/components/ui/select.tsx:44`
- Create: `tests/components/touch-size.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces: `size="touch"` e `size="icon-touch"` su `Button`; `Input` alto 44 px per default;
  `data-[size=touch]` sul trigger di `Select`. Ogni task successivo usa **queste** taglie per i
  controlli su cui si tocca col pollice.

**Perché questo task esiste:** la taglia più grande di `Button` è `lg: "h-9"`, cioè 36 px — sotto il
minimo di 44 px raccomandato da Apple. È la ragione per cui **nessuna pagina usa `Button`**: tutte
scrivono `py-4` a mano. Finché i componenti sono scalati per il desktop, continueranno a essere
aggirati, e la veste non attaccherà.

- [ ] **Step 1: Scrivi la prova che fallisce**

`tests/components/touch-size.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buttonVariants } from '@/components/ui/button'

const UI = path.join(import.meta.dirname, '../../src/components/ui')

/**
 * Il valore di queste prove non è dimostrare un design: è la regressione. Questi
 * file li rigenera `shadcn add`, e una rigenerazione riporterebbe `h-8`
 * silenziosamente — con tutti i controlli sotto i 44 px e nessuno che se ne
 * accorge finché non lo prova col pollice.
 */
describe('taglie da tocco', () => {
  it('Button ha una taglia da 48 px', () => {
    expect(buttonVariants({ size: 'touch' })).toContain('h-12')
  })

  it('Button ha una taglia icona da 44 px', () => {
    expect(buttonVariants({ size: 'icon-touch' })).toContain('size-11')
  })

  it('la taglia da tocco porta il testo a 16 px', () => {
    // Sotto i 16 px iOS ingrandisce la pagina quando il campo prende il focus.
    expect(buttonVariants({ size: 'touch' })).toContain('text-base')
  })

  it('Input è alto 44 px per default, non 32', () => {
    const sorgente = readFileSync(path.join(UI, 'input.tsx'), 'utf8')
    expect(sorgente).toContain('h-11')
    expect(sorgente).not.toContain('h-8')
  })

  it('il trigger di Select ha una taglia da tocco', () => {
    const sorgente = readFileSync(path.join(UI, 'select.tsx'), 'utf8')
    expect(sorgente).toContain('data-[size=touch]:h-11')
  })
})
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/components/touch-size.test.ts`
Expected: FAIL — cinque prove rosse. La prima dice che `buttonVariants({ size: 'touch' })` non
contiene `h-12` (cva ignora una taglia che non conosce e ricade su `default`, cioè `h-8`).

- [ ] **Step 3: Aggiungi le taglie a `Button`**

In `src/components/ui/button.tsx`, dentro `size: { ... }`, aggiungi due voci accanto a quelle che ci
sono (non toccare le esistenti: servono ai controlli fitti della legenda da desktop):

```ts
        touch:
          "h-12 gap-2 rounded-xl px-4 text-base has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-5",
        "icon-touch": "size-11 rounded-xl [&_svg:not([class*='size-'])]:size-5",
```

- [ ] **Step 4: Alza `Input`**

In `src/components/ui/input.tsx`, nella stringa di classi, cambia `h-8` in `h-11` e `px-2.5` in
`px-3`. Il resto della stringa non si tocca — `text-base` con `md:text-sm` c'è già ed è giusto: 16 px
sul telefono, 14 sul desktop.

Aggiungi sopra la funzione il commento che spiega perché il valore di partenza è quello del telefono:

```tsx
/**
 * Alto 44 px per default, non 32: l app è mobile-first, quindi il valore di
 * partenza è quello del pollice. I rari casi fitti da desktop passano
 * `className="h-8"`.
 */
```

- [ ] **Step 5: Aggiungi la taglia al trigger di `Select`**

In `src/components/ui/select.tsx:44`, nella stringa del trigger, accanto a
`data-[size=default]:h-8 data-[size=sm]:h-7`, aggiungi:

```
data-[size=touch]:h-11 data-[size=touch]:text-base data-[size=touch]:rounded-xl
```

- [ ] **Step 6: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/components/touch-size.test.ts`
Expected: PASS, 5 prove.

- [ ] **Step 7: Suite intera, lint, commit**

```bash
npm test && npx next typegen && npm run lint
git add src/components/ui/button.tsx src/components/ui/input.tsx src/components/ui/select.tsx \
        tests/components/touch-size.test.ts
git commit -m "feat(ui): touch sizes on the shadcn controls

The biggest Button was h-9, 36px -- under Apple's 44px minimum, which is
exactly why no page used Button and every one of them hand-rolled py-4
instead. Input's height was hardcoded with no cva, so it becomes h-11 by
default: on a mobile-first app the starting value is the thumb's, and the
rare dense desktop cases pass className. The test guards against a future
shadcn add silently restoring h-8."
```

---

## Task 5: Le quattro funzioni pure

**Files:**
- Modify: `src/lib/time.ts`, `src/modules/review/index.ts`, `src/modules/auth/index.ts`
- Create: `src/modules/review/landing.ts`, `src/modules/auth/menu.ts`,
  `tests/lib/rome-year-month.test.ts`, `tests/modules/review/landing.test.ts`,
  `tests/modules/auth/menu.test.ts`

**Interfaces:**
- Consumes: `ROME_TZ` da `@/lib/time`; `Role` da `@/modules/auth/policy`.
- Produces:
  - `romeYearMonth(instant: Date): { year: number; month: number }` da `@/lib/time`;
  - `interface LandingCandidate { id: string; year: number; month: number; version: number }`,
    `interface MonthEntry { id: string; year: number; month: number; current: boolean }`,
    `landingRoster(candidates: readonly LandingCandidate[], today: { year: number; month: number }): LandingCandidate | null`,
    `monthPickerEntries(candidates: readonly LandingCandidate[], today: { year: number; month: number }): MonthEntry[]`
    da `@/modules/review/landing`, riesportate da `@/modules/review`;
  - `interface MenuItem { href: string; label: string }`,
    `menuItemsFor(user: { role: Role }): MenuItem[]` da `@/modules/auth/menu`, riesportate da
    `@/modules/auth`.

- [ ] **Step 1: Scrivi la prova che fallisce, su `romeYearMonth`**

`tests/lib/rome-year-month.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { romeYearMonth } from '@/lib/time'

describe('romeYearMonth', () => {
  it('legge il mese sul calendario di Roma, non su quello UTC', () => {
    // 23:30 UTC del 31 agosto: a Roma è già il primo settembre (ora legale, +02:00).
    // Con `new Date().getMonth()` l app atterrerebbe su agosto per un ora al mese,
    // che è il tipo di guasto che nessuno riproduce.
    expect(romeYearMonth(new Date('2026-08-31T23:30:00Z'))).toEqual({ year: 2026, month: 9 })
  })

  it('vale anche in ora solare, dove l offset è di un ora sola', () => {
    expect(romeYearMonth(new Date('2026-01-31T23:30:00Z'))).toEqual({ year: 2026, month: 2 })
  })

  it('non anticipa il mese quando a Roma non è ancora cambiato', () => {
    expect(romeYearMonth(new Date('2026-08-31T20:00:00Z'))).toEqual({ year: 2026, month: 8 })
  })

  it('cambia anche l anno a cavallo di capodanno', () => {
    expect(romeYearMonth(new Date('2025-12-31T23:30:00Z'))).toEqual({ year: 2026, month: 1 })
  })
})
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/lib/rome-year-month.test.ts`
Expected: FAIL — `romeYearMonth is not a function`.

- [ ] **Step 3: Aggiungi `romeYearMonth` a `src/lib/time.ts`**

In fondo al file, accanto a `zoneOffsetMinutes` e `wallClockToUtc` — che esistono per la stessa
ragione: qui i fusi non si calcolano a mano.

```ts
/**
 * Anno e mese (1-based) di un istante, letti sul calendario di Roma. Serve a
 * sapere su quale mese aprire l app: `getMonth()` darebbe il mese UTC, e alle
 * 00:30 del primo settembre a Roma l UTC dice ancora agosto.
 */
export function romeYearMonth(instant: Date): { year: number; month: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROME_TZ,
    year: 'numeric',
    month: '2-digit',
  })

  const parti: Record<string, string> = {}
  for (const parte of formatter.formatToParts(instant)) {
    if (parte.type !== 'literal') parti[parte.type] = parte.value
  }

  return { year: Number(parti.year), month: Number(parti.month) }
}
```

- [ ] **Step 4: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/lib/rome-year-month.test.ts`
Expected: PASS, 4 prove.

- [ ] **Step 5: Scrivi la prova che fallisce, sull'atterraggio**

`tests/modules/review/landing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  landingRoster,
  monthPickerEntries,
  type LandingCandidate,
} from '@/modules/review/landing'

const OGGI = { year: 2026, month: 8 }

function tabella(
  id: string,
  year: number,
  month: number,
  version = 1,
): LandingCandidate {
  return { id, year, month, version }
}

describe('landingRoster', () => {
  it('sceglie la tabella del mese corrente', () => {
    const scelta = landingRoster(
      [tabella('lug', 2026, 7), tabella('ago', 2026, 8), tabella('giu', 2026, 6)],
      OGGI,
    )
    expect(scelta?.id).toBe('ago')
  })

  it('a parità di mese sceglie la versione più alta', () => {
    // `nextVersion` esiste già nel modulo roster, quindi due righe per lo stesso
    // mese sono un caso reale: atterrare sulla versione 1 quando esiste la 2
    // mostrerebbe turni superati senza dirlo.
    const scelta = landingRoster(
      [tabella('v1', 2026, 8, 1), tabella('v3', 2026, 8, 3), tabella('v2', 2026, 8, 2)],
      OGGI,
    )
    expect(scelta?.id).toBe('v3')
  })

  it('non si fida dell ordine in cui arrivano i candidati', () => {
    const scelta = landingRoster(
      [tabella('v2', 2026, 8, 2), tabella('v3', 2026, 8, 3), tabella('v1', 2026, 8, 1)],
      OGGI,
    )
    expect(scelta?.id).toBe('v3')
  })

  it('se il mese corrente non c è, prende la più recente', () => {
    // A inizio mese, prima che la referente carichi la foto: i turni di ieri sono
    // ancora informazione, quindi si mostra il mese scorso invece di niente.
    const scelta = landingRoster([tabella('giu', 2026, 6), tabella('lug', 2026, 7)], OGGI)
    expect(scelta?.id).toBe('lug')
  })

  it('confronta l anno prima del mese', () => {
    const scelta = landingRoster([tabella('dic', 2025, 12), tabella('gen', 2026, 1)], OGGI)
    expect(scelta?.id).toBe('gen')
  })

  it('della più recente prende comunque la versione più alta', () => {
    const scelta = landingRoster(
      [tabella('lug-v1', 2026, 7, 1), tabella('lug-v2', 2026, 7, 2)],
      OGGI,
    )
    expect(scelta?.id).toBe('lug-v2')
  })

  it('senza tabelle restituisce null, non solleva', () => {
    expect(landingRoster([], OGGI)).toBeNull()
  })
})

describe('monthPickerEntries', () => {
  it('dà una voce per mese, anche con tre versioni', () => {
    // Una tendina con «agosto 2026» tre volte non aiuta nessuno.
    const voci = monthPickerEntries(
      [tabella('v1', 2026, 8, 1), tabella('v2', 2026, 8, 2), tabella('v3', 2026, 8, 3)],
      OGGI,
    )
    expect(voci).toHaveLength(1)
    expect(voci[0].id).toBe('v3')
  })

  it('ordina dal più recente', () => {
    const voci = monthPickerEntries(
      [tabella('giu', 2026, 6), tabella('ago', 2026, 8), tabella('lug', 2026, 7)],
      OGGI,
    )
    expect(voci.map((v) => v.month)).toEqual([8, 7, 6])
  })

  it('marca il mese di oggi', () => {
    const voci = monthPickerEntries([tabella('ago', 2026, 8), tabella('lug', 2026, 7)], OGGI)
    expect(voci.map((v) => v.current)).toEqual([true, false])
  })

  it('non marca niente se il mese di oggi non c è', () => {
    // `current` dice qual è il mese corrente, non su quale tabella si è atterrati.
    const voci = monthPickerEntries([tabella('lug', 2026, 7), tabella('giu', 2026, 6)], OGGI)
    expect(voci.every((v) => !v.current)).toBe(true)
  })

  it('senza tabelle dà un elenco vuoto', () => {
    expect(monthPickerEntries([], OGGI)).toEqual([])
  })
})
```

- [ ] **Step 6: Esegui e verifica che fallisca**

Run: `npx vitest run tests/modules/review/landing.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/review/landing"`.

- [ ] **Step 7: Scrivi `src/modules/review/landing.ts`**

```ts
/**
 * Su quale tabella si apre l app, e quali mesi elenca il selettore. Logica pura:
 * i candidati arrivano da `reviewableRosters`, che filtra già per quello che
 * l utente ha il diritto di vedere.
 */

export interface LandingCandidate {
  id: string
  year: number
  month: number
  version: number
}

export interface MonthEntry {
  id: string
  year: number
  month: number
  /** Vero sul mese di **oggi**, non sulla tabella su cui si è atterrati. */
  current: boolean
}

/** Dal più recente: anno, poi mese, poi versione. Tutti e tre decrescenti. */
function piuRecentePrima(a: LandingCandidate, b: LandingCandidate): number {
  return b.year - a.year || b.month - a.month || b.version - a.version
}

/**
 * La tabella del mese corrente alla versione più alta; se non c è, la più
 * recente; se non c è niente, `null`.
 *
 * L ordine in ingresso non si assume: si riordina qui, così chi chiama non ha un
 * contratto implicito da rispettare.
 */
export function landingRoster(
  candidates: readonly LandingCandidate[],
  today: { year: number; month: number },
): LandingCandidate | null {
  if (candidates.length === 0) return null

  const ordinati = [...candidates].sort(piuRecentePrima)
  // Ordinati per versione decrescente, il primo del mese giusto è la versione più alta.
  const delMese = ordinati.find((c) => c.year === today.year && c.month === today.month)
  return delMese ?? ordinati[0]
}

/**
 * Una voce per (anno, mese), quella della versione più alta, dal più recente. Le
 * versioni superate non compaiono come voci separate.
 */
export function monthPickerEntries(
  candidates: readonly LandingCandidate[],
  today: { year: number; month: number },
): MonthEntry[] {
  const visti = new Set<string>()
  const voci: MonthEntry[] = []

  for (const candidato of [...candidates].sort(piuRecentePrima)) {
    const chiave = `${candidato.year}-${candidato.month}`
    if (visti.has(chiave)) continue
    visti.add(chiave)

    voci.push({
      id: candidato.id,
      year: candidato.year,
      month: candidato.month,
      current: candidato.year === today.year && candidato.month === today.month,
    })
  }

  return voci
}
```

- [ ] **Step 8: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/modules/review/landing.test.ts`
Expected: PASS, 12 prove.

- [ ] **Step 9: Scrivi la prova che fallisce, sul menu**

`tests/modules/auth/menu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { menuItemsFor } from '@/modules/auth/menu'

describe('menuItemsFor', () => {
  it('dà alla referente le tre voci, con gli href esatti', () => {
    expect(menuItemsFor({ role: 'REFERENTE' })).toEqual([
      { href: '/rosters/upload', label: 'Carica la tabella' },
      { href: '/settings/codes', label: 'Codici turno' },
      { href: '/settings/users', label: 'Utenti' },
    ])
  })

  it('non dà niente a un infermiera', () => {
    // È la regola invariante 7 resa verificabile: oggi è un `&&` dentro il JSX,
    // che nessuna prova può leggere. Nascondere una voce non autorizza niente —
    // i controlli veri restano nelle route e nelle server action.
    expect(menuItemsFor({ role: 'NURSE' })).toEqual([])
  })

  it('restituisce una copia, non l elenco condiviso', () => {
    // Chi chiama potrebbe ordinare o filtrare in posto: senza la copia
    // modificherebbe le voci di tutti gli altri.
    const primo = menuItemsFor({ role: 'REFERENTE' })
    primo.pop()
    expect(menuItemsFor({ role: 'REFERENTE' })).toHaveLength(3)
  })
})
```

- [ ] **Step 10: Esegui e verifica che fallisca**

Run: `npx vitest run tests/modules/auth/menu.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/auth/menu"`.

- [ ] **Step 11: Scrivi `src/modules/auth/menu.ts`**

```ts
import type { Role } from './policy'

export interface MenuItem {
  href: string
  label: string
}

const VOCI_REFERENTE: readonly MenuItem[] = [
  { href: '/rosters/upload', label: 'Carica la tabella' },
  { href: '/settings/codes', label: 'Codici turno' },
  { href: '/settings/users', label: 'Utenti' },
]

/**
 * Le voci del menu ⋯. Vuoto per chi non è referente, e allora il bottone non si
 * disegna affatto.
 *
 * È la regola invariante 7 («solo REFERENTE carica tabelle e modifica la
 * legenda») resa verificabile. **Non sostituisce** i controlli lato server:
 * nascondere una voce non è autorizzare.
 */
export function menuItemsFor(user: { role: Role }): MenuItem[] {
  return user.role === 'REFERENTE' ? [...VOCI_REFERENTE] : []
}
```

- [ ] **Step 12: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/modules/auth/menu.test.ts`
Expected: PASS, 3 prove.

- [ ] **Step 13: Allarga le due facciate**

In `src/modules/review/index.ts`, in ordine alfabetico fra i gruppi esistenti:

```ts
export type { LandingCandidate, MonthEntry } from './landing'
export { landingRoster, monthPickerEntries } from './landing'
```

In `src/modules/auth/index.ts`:

```ts
export type { MenuItem } from './menu'
export { menuItemsFor } from './menu'
```

Le facciate esistono perché il codice applicativo non importi file interni di un altro modulo. Le
**prove** invece importano il sottomodulo diretto, come sopra: le facciate tirano dentro il client
Prisma e `next/headers`, che fuori dal runtime di Next fallisce.

- [ ] **Step 14: Suite intera, lint, commit**

```bash
npm test && npx next typegen && npm run lint
git add src/lib/time.ts src/modules/review/landing.ts src/modules/review/index.ts \
        src/modules/auth/menu.ts src/modules/auth/index.ts \
        tests/lib/rome-year-month.test.ts tests/modules/review/landing.test.ts \
        tests/modules/auth/menu.test.ts
git commit -m "feat(review): the pure logic behind landing on the current month

Four functions, all pure, all tested before they existed. romeYearMonth
reads the month on Rome's calendar because getMonth() gives the UTC one,
and at 00:30 on 1 September UTC still says August -- a fault that would
be wrong for one hour a month and that nobody reproduces. landingRoster
picks the highest version of the current month: nextVersion already
exists, so two rows for one month is a real case, and landing on version
1 while version 2 exists would show superseded shifts without saying so.
menuItemsFor turns invariant 7 from a && inside JSX into something a test
can read."
```

---
## Task 6: I componenti condivisi

**Files:**
- Create: `src/components/banner.tsx`, `src/components/action-dock.tsx`,
  `src/components/empty-state.tsx`, `src/components/app-menu.tsx`,
  `src/components/app-header.tsx`, `tests/components/banner.test.ts`

**Interfaces:**
- Consumes: i token del Task 1; `pt-safe`/`pb-safe`/`px-safe` del Task 2; `size="touch"` e
  `size="icon-touch"` del Task 4; `MenuItem` del Task 5.
- Produces:
  - `type BannerVariant = 'ok' | 'warn' | 'error' | 'info'`,
    `bannerClasses(variant: BannerVariant): string`,
    `Banner({ variant, title, children, className }: { variant: BannerVariant; title?: string; children: React.ReactNode; className?: string })`;
  - `ActionDock({ children, note }: { children: React.ReactNode; note?: string })`;
  - `EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: { href: string; label: string } })`;
  - `AppMenu({ items }: { items: MenuItem[] })` — `"use client"`;
  - `AppHeader({ title, subtitle, pickerHref, backHref, menuItems }: { title: string; subtitle?: string; pickerHref?: string; backHref?: string; menuItems?: MenuItem[] })`.

**Nota sulle prove, dichiarata apertamente:** vitest gira in ambiente `node` e il progetto non ha
jsdom né `@testing-library` — e non li aggiunge (vincolo globale). Quindi questi componenti **non
hanno una prova di resa**: si guardano sul telefono al Task 10. Quello che ha una prova è la parte
pura, `bannerClasses`, che è dove sta la decisione (quale variante usa quale coppia di token) e dove
un errore sarebbe invisibile — un avviso d'errore colorato come un avviso riuscito.

- [ ] **Step 1: Scrivi la prova che fallisce**

`tests/components/banner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bannerClasses, type BannerVariant } from '@/components/banner'

const VARIANTI: BannerVariant[] = ['ok', 'warn', 'error', 'info']

describe('bannerClasses', () => {
  it('usa la coppia tenue giusta per ogni variante', () => {
    expect(bannerClasses('ok')).toBe('bg-ok-soft text-ok-soft-foreground')
    expect(bannerClasses('warn')).toBe('bg-warn-soft text-warn-soft-foreground')
    expect(bannerClasses('error')).toBe('bg-destructive-soft text-destructive-soft-foreground')
    expect(bannerClasses('info')).toBe('bg-muted text-muted-foreground')
  })

  it('dà a ogni variante il suo colore, senza ripetizioni', () => {
    // Un avviso d errore colorato come un avviso riuscito è il tipo di errore
    // che si vede solo quando è tardi.
    const classi = VARIANTI.map(bannerClasses)
    expect(new Set(classi).size).toBe(VARIANTI.length)
  })

  it('accoppia sempre un fondo con il suo testo', () => {
    for (const variante of VARIANTI) {
      const classi = bannerClasses(variante)
      const fondo = /\bbg-([a-z-]+)\b/.exec(classi)?.[1]
      const testo = /\btext-([a-z-]+)\b/.exec(classi)?.[1]
      expect(fondo, variante).toBeDefined()
      expect(testo, variante).toBe(`${fondo}-foreground`)
    }
  })
})
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/components/banner.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/banner"`.

- [ ] **Step 3: Scrivi `src/components/banner.tsx`**

```tsx
import type React from 'react'
import { cn } from '@/lib/utils'

export type BannerVariant = 'ok' | 'warn' | 'error' | 'info'

const CLASSI: Record<BannerVariant, string> = {
  ok: 'bg-ok-soft text-ok-soft-foreground',
  warn: 'bg-warn-soft text-warn-soft-foreground',
  error: 'bg-destructive-soft text-destructive-soft-foreground',
  info: 'bg-muted text-muted-foreground',
}

/** Estratta perché è la decisione, e una decisione si prova. */
export function bannerClasses(variant: BannerVariant): string {
  return CLASSI[variant]
}

/**
 * Un solo riquadro d avviso per tutta l app. Prima ce n erano quattro, stilati a
 * mano in quattro modi diversi: erano tre quinti dei colori letterali del
 * progetto.
 *
 * `role="alert"` solo sull errore: un lettore di schermo che annuncia ogni
 * conferma riuscita interrompe la lettura per niente.
 */
export function Banner({
  variant,
  title,
  children,
  className,
}: {
  variant: BannerVariant
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={variant === 'error' ? 'alert' : undefined}
      className={cn('rounded-xl px-4 py-3 text-sm', bannerClasses(variant), className)}
    >
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/components/banner.test.ts`
Expected: PASS, 3 prove.

- [ ] **Step 5: Scrivi `src/components/action-dock.tsx`**

```tsx
import type React from 'react'

/**
 * Le azioni fisse in fondo, dove arriva il pollice, ferme mentre la lista scorre.
 *
 * `pb-safe` non è decorazione: con `viewport-fit: cover` il contenuto arriva
 * sotto la barra dei gesti, e senza quel margine il bottone non si tocca.
 */
export function ActionDock({
  children,
  note,
}: {
  children: React.ReactNode
  note?: string
}) {
  return (
    <div className="bg-card border-border sticky bottom-0 z-10 border-t px-4 pt-3 pb-safe">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        {children}
        {note && <p className="text-muted-foreground text-center text-xs">{note}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Scrivi `src/components/empty-state.tsx`**

```tsx
import Link from 'next/link'
import type React from 'react'
import { Button } from '@/components/ui/button'

/** Uno stato vuoto dice cosa manca **e** cosa si può fare, o non serve a niente. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: React.ReactNode
  action?: { href: string; label: string }
}) {
  return (
    <div className="bg-card border-border mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border px-6 py-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="text-muted-foreground text-sm">{children}</div>}
      {action && (
        <Button size="touch" render={<Link href={action.href} />} className="mt-2 w-full">
          {action.label}
        </Button>
      )}
    </div>
  )
}
```

**Attenzione al `render`:** `Button` è il primitivo di Base UI, che compone con la prop `render`, non
con `asChild` come nello shadcn su Radix. Se il tipo si lamenta, guarda come lo fa
`src/components/ui/select.tsx`, che usa gli stessi primitivi, e allinea.

- [ ] **Step 7: Scrivi `src/components/app-menu.tsx`**

```tsx
'use client'

import { Drawer } from '@base-ui/react/drawer'
import { EllipsisIcon } from 'lucide-react'
import Link from 'next/link'
import type { MenuItem } from '@/modules/auth'

/**
 * Il menu della referente, come foglio dal basso e non come tendina: su un
 * telefono il basso è dove arriva il pollice. Base UI dà chiusura con Esc, clic
 * fuori e trappola del focus senza scriverli.
 *
 * Con l elenco vuoto **non disegna niente**, nemmeno il bottone: chi non è
 * referente non deve vedere un ⋯ che apre un foglio vuoto.
 */
export function AppMenu({ items }: { items: MenuItem[] }) {
  if (items.length === 0) return null

  return (
    <Drawer.Root>
      <Drawer.Trigger
        aria-label="Altro"
        className="text-muted-foreground bg-muted flex size-11 items-center justify-center rounded-full"
      >
        <EllipsisIcon className="size-5" />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 bg-black/40" />
        <Drawer.Popup className="bg-card fixed inset-x-0 bottom-0 z-50 rounded-t-3xl px-4 pt-3 pb-safe">
          <div className="bg-border mx-auto mb-4 h-1 w-10 rounded-full" />
          <nav className="flex flex-col gap-1">
            {items.map((voce) => (
              <Drawer.Close
                key={voce.href}
                render={<Link href={voce.href} />}
                className="hover:bg-muted flex h-12 items-center rounded-xl px-3 text-base font-medium"
              >
                {voce.label}
              </Drawer.Close>
            ))}
          </nav>
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
```

**Se i nomi delle parti di `Drawer` non corrispondono**, non indovinare: leggi
`node_modules/@base-ui/react/drawer/index.d.ts` e usa quelli veri. `Drawer` è nuovo in Base UI 1.7 e
la sua superficie non è nella memoria di nessuno.

- [ ] **Step 8: Scrivi `src/components/app-header.tsx`**

```tsx
import { ChevronDownIcon, ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { AppMenu } from '@/components/app-menu'
import type { MenuItem } from '@/modules/auth'

/**
 * L intestazione di ogni schermata. Il titolo è **il mese**, non una didascalia:
 * a inizio mese l atterraggio può cadere sul mese scorso, e chi guarda deve
 * capire subito quale sta guardando.
 *
 * `backHref` vince su `pickerHref`: una sotto-pagina ha una freccia indietro, non
 * un selettore di mesi.
 */
export function AppHeader({
  title,
  subtitle,
  pickerHref,
  backHref,
  menuItems = [],
}: {
  title: string
  subtitle?: string
  pickerHref?: string
  backHref?: string
  menuItems?: MenuItem[]
}) {
  return (
    <header className="mx-auto flex w-full max-w-2xl items-start justify-between gap-3 px-4 pt-safe pb-3">
      <div className="min-w-0">
        {backHref ? (
          <Link href={backHref} className="text-muted-foreground -ml-1 flex h-11 items-center gap-1 text-sm">
            <ChevronLeftIcon className="size-4" />
            Indietro
          </Link>
        ) : null}

        {!backHref && pickerHref ? (
          <Link href={pickerHref} className="flex items-center gap-1.5">
            <h1 className="truncate text-2xl font-extrabold tracking-tight capitalize">{title}</h1>
            <ChevronDownIcon className="text-muted-foreground size-5 shrink-0" />
          </Link>
        ) : (
          <h1 className="truncate text-2xl font-extrabold tracking-tight capitalize">{title}</h1>
        )}

        {subtitle && <p className="text-muted-foreground mt-0.5 truncate text-sm">{subtitle}</p>}
      </div>

      <div className="shrink-0 pt-1">
        <AppMenu items={menuItems} />
      </div>
    </header>
  )
}
```

- [ ] **Step 9: Verifica che tutto compili**

Run: `npx next typegen && npm run lint`
Expected: pulito. Qui è dove escono gli errori sulla prop `render` di Base UI e sui nomi delle parti
di `Drawer`: se ne trovi, leggi i tipi in `node_modules/@base-ui/react/` e correggi — non aggirare
con `as any`.

- [ ] **Step 10: Suite intera e commit**

```bash
npm test
git add src/components/banner.tsx src/components/action-dock.tsx src/components/empty-state.tsx \
        src/components/app-menu.tsx src/components/app-header.tsx tests/components/banner.test.ts
git commit -m "feat(ui): the shared shell components

Banner replaces four hand-styled alert boxes that between them were
three fifths of the project's literal colors, and only its error variant
carries role=alert -- a screen reader announcing every successful
confirmation interrupts for nothing. ActionDock owns the safe-area
padding, without which the bottom button sits under the home indicator.
AppMenu draws nothing at all on an empty item list, so a nurse never
sees a menu button that opens an empty sheet.

Only bannerClasses has a test: vitest runs in node with no jsdom, and
the project does not add one. What is tested is the decision -- which
variant uses which token pair -- because an error styled like a success
is the kind of mistake you notice late."
```

---

## Task 7: Atterraggio e selettore dei mesi

**Files:**
- Modify: `src/app/page.tsx`, `src/app/rosters/page.tsx`
- Create: `tests/app/landing.test.ts`

**Interfaces:**
- Consumes: `romeYearMonth` da `@/lib/time`; `landingRoster`, `monthPickerEntries`,
  `reviewableRosters` da `@/modules/review`; `menuItemsFor`, `requireUser` da `@/modules/auth`;
  `AppHeader`, `EmptyState` dal Task 6; `monthLabel` da `@/lib/time`.
- Produces: `/` reindirizza a `/rosters/<id>/review`; `/rosters` è il selettore dei mesi.

- [ ] **Step 1: Scrivi la prova che fallisce**

`tests/app/landing.test.ts`. Segue lo schema già in uso in `tests/app/rosters/actions-auth.test.ts`:
mock di `next/headers` e `next/navigation`, database vero da `createTestDb`.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '../helpers/db'

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let db: ReturnType<typeof createTestDb>
let prisma: PrismaClient
let session: typeof import('@/modules/auth/session')
let homePage: typeof import('@/app/page')
let referente: { id: string }

beforeAll(async () => {
  db = createTestDb()
  prisma = db.prisma
  process.env.DATABASE_URL = db.url
  process.env.SESSION_SECRET = 'session-secret-di-test-abbastanza-lungo-32+'
  delete (globalThis as unknown as { prisma?: unknown }).prisma
  vi.resetModules()

  session = await import('@/modules/auth/session')
  homePage = await import('@/app/page')

  // **Referente di proposito.** Per un ruolo `NURSE`, `reviewableRosters`
  // restituisce `[]` se non ha un `ColumnAlias` *e* la tabella non ha celle nella
  // sua colonna: con un infermiera nuda queste prove misurerebbero il filtro di
  // visibilità (che ha già le sue prove altrove) invece della regola
  // d'atterraggio. La referente vede tutte le tabelle, che è quello che serve qui
  // — ed è anche un'utente reale: la referente è un'infermiera con una colonna sua.
  referente = await prisma.user.create({
    data: { email: 'referente@esempio.it', displayName: 'Anna', role: 'REFERENTE' },
  })
})

afterAll(() => db.cleanup())

beforeEach(async () => {
  cookieStore.clear()
  await prisma.roster.deleteMany()
  await session.openSessionCookie(referente.id)
})

/**
 * Una tabella per un mese, alla versione data. `imagePath` è obbligatorio nello
 * schema, e `Roster` non ha un campo per chi l'ha caricata: il vincolo di unicità
 * è `[year, month, ward, version]`.
 */
async function tabella(year: number, month: number, version = 1): Promise<string> {
  const roster = await prisma.roster.create({
    data: { year, month, version, ward: '3°PIANO', imagePath: 'prova.jpg', status: 'extracted' },
  })
  return roster.id
}

/** Il redirect è mockato come un throw: qui si legge la destinazione. */
async function destinazioneDi(pagina: () => Promise<unknown>): Promise<string> {
  try {
    await pagina()
  } catch (errore) {
    const messaggio = errore instanceof Error ? errore.message : String(errore)
    if (messaggio.startsWith('REDIRECT:')) return messaggio.slice('REDIRECT:'.length)
    throw errore
  }
  throw new Error('la pagina non ha reindirizzato')
}

describe('la home apre sui turni del mese', () => {
  it('reindirizza alla griglia della tabella del mese corrente', async () => {
    const oggi = new Date()
    const anno = oggi.getFullYear()
    const mese = oggi.getMonth() + 1
    await tabella(anno, mese === 1 ? 12 : mese - 1)
    const corrente = await tabella(anno, mese)

    expect(await destinazioneDi(() => homePage.default())).toBe(`/rosters/${corrente}/review`)
  })

  it('a parità di mese usa la versione più alta', async () => {
    const oggi = new Date()
    await tabella(oggi.getFullYear(), oggi.getMonth() + 1, 1)
    const seconda = await tabella(oggi.getFullYear(), oggi.getMonth() + 1, 2)

    expect(await destinazioneDi(() => homePage.default())).toBe(`/rosters/${seconda}/review`)
  })

  it('senza il mese corrente cade sulla tabella più recente', async () => {
    const vecchia = await tabella(2024, 3)
    await tabella(2024, 1)

    expect(await destinazioneDi(() => homePage.default())).toBe(`/rosters/${vecchia}/review`)
  })

  it('senza nessuna tabella non reindirizza: rende lo stato vuoto', async () => {
    // Un redirect qui manderebbe l app in un ciclo, o su una griglia inesistente.
    await expect(homePage.default()).resolves.toBeTruthy()
  })

  it('a un infermiera senza colonna mostra lo stato vuoto, non un guasto', async () => {
    // `reviewableRosters` non le dà niente finché la referente non le associa una
    // colonna: la tabella esiste ma non è sua. Deve leggere una spiegazione, non
    // finire su una griglia vuota.
    const oggi = new Date()
    await tabella(oggi.getFullYear(), oggi.getMonth() + 1)

    const cristina = await prisma.user.create({
      data: { email: `cristina-${Date.now()}@esempio.it`, displayName: 'Cristina', role: 'NURSE' },
    })
    cookieStore.clear()
    await session.openSessionCookie(cristina.id)

    await expect(homePage.default()).resolves.toBeTruthy()
  })
})
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `. "$NVM_DIR/nvm.sh"; nvm use 22; npx vitest run tests/app/landing.test.ts`
Expected: FAIL — la home attuale rende la pagina di bottoni e non reindirizza mai, quindi
`destinazioneDi` solleva `la pagina non ha reindirizzato` sulle prime tre prove. La quarta passa già:
è normale, e passerà anche dopo.

- [ ] **Step 3: Riscrivi `src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { EmptyState } from '@/components/empty-state'
import { romeYearMonth } from '@/lib/time'
import { menuItemsFor, requireUser } from '@/modules/auth'
import { landingRoster, reviewableRosters } from '@/modules/review'

export const dynamic = 'force-dynamic'

/**
 * L app si apre sui turni del mese in corso: zero tocchi fra l apertura e il
 * motivo per cui è stata aperta. Non c è più una home di bottoni — le voci della
 * referente stanno nel menu ⋯ dell intestazione.
 */
export default async function HomePage() {
  const user = await requireUser()
  const tabelle = await reviewableRosters(user)
  const scelta = landingRoster(tabelle, romeYearMonth(new Date()))

  if (scelta) redirect(`/rosters/${scelta.id}/review`)

  const referente = user.role === 'REFERENTE'

  return (
    <>
      <AppHeader title="Turni" menuItems={menuItemsFor(user)} />
      <main className="flex flex-1 items-center px-safe pb-10">
        <EmptyState
          title="Non c è ancora nessuna tabella"
          action={referente ? { href: '/rosters/upload', label: 'Carica la foto del mese' } : undefined}
        >
          {referente ? (
            <p>Fotografa la tabella appesa in reparto e caricala: la lettura ci mette un paio di minuti.</p>
          ) : (
            <p>
              Quando la referente carica la tabella del mese, i tuoi turni compaiono qui e ti basterà
              confermarli.
            </p>
          )}
        </EmptyState>
      </main>
    </>
  )
}
```

- [ ] **Step 4: Esegui la prova e verifica che passi**

Run: `npx vitest run tests/app/landing.test.ts`
Expected: PASS, 4 prove.

- [ ] **Step 5: Riscrivi `src/app/rosters/page.tsx` come selettore dei mesi**

Struttura, mantenendo `ensureExtractionWorker()` e la mappa `ETICHETTE_STATO` che ci sono già:

```tsx
import Link from 'next/link'
import { AppHeader } from '@/components/app-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { monthLabel, romeYearMonth } from '@/lib/time'
import { menuItemsFor, requireUser } from '@/modules/auth'
import { ensureExtractionWorker } from '@/modules/roster'
import { monthPickerEntries, reviewableRosters } from '@/modules/review'
```

Il corpo:

1. `const user = await requireUser()`, `void ensureExtractionWorker()`, `const tabelle = await reviewableRosters(user)`.
2. `const voci = monthPickerEntries(tabelle, romeYearMonth(new Date()))`.
3. `const statoPerId = new Map(tabelle.map((t) => [t.id, t.status]))` — lo stato serve al badge, e
   `MonthEntry` non lo porta di proposito: la funzione pura decide *quali mesi*, non *come stanno*.
4. `<AppHeader title="I mesi" backHref="/" menuItems={menuItemsFor(user)} />`.
5. Se `voci.length === 0`, `<EmptyState title="Non c è ancora nessuna tabella">` con lo stesso testo
   per ruolo della home.
6. Altrimenti una `<ul className="mx-auto max-w-2xl flex flex-col gap-3 px-safe pb-10">`, e per ogni
   voce un `<li>` con dentro un `<Link href={\`/rosters/${voce.id}/review\`}>` e una scheda:

```tsx
<div
  className={[
    'bg-card border-border flex min-h-16 items-center justify-between gap-3 rounded-2xl border px-4 py-3',
    voce.current ? 'border-primary' : '',
  ].join(' ')}
>
  <div className="min-w-0">
    <p className="truncate text-base font-semibold capitalize">
      {monthLabel(voce.year, voce.month)}
    </p>
    {voce.current && <p className="text-primary text-xs font-medium">mese in corso</p>}
  </div>
  <Badge variant={ETICHETTE_STATO[statoPerId.get(voce.id) ?? '']?.variante ?? 'outline'}>
    {ETICHETTE_STATO[statoPerId.get(voce.id) ?? '']?.testo ?? 'sconosciuto'}
  </Badge>
</div>
```

7. In fondo alla pagina, l'unica uscita dell'app:

```tsx
<form action="/api/auth/logout" method="post" className="mx-auto max-w-2xl px-safe pb-10">
  <Button type="submit" variant="ghost" size="touch" className="w-full">
    Esci
  </Button>
</form>
```

L'uscita sta **solo qui**: due strade per uscire sono due strade da mantenere, e non è un'azione che
si cerca di fretta.

- [ ] **Step 6: Percorri le due pagine col browser**

Run: `npm run dev`, entra (serve `DEV_LOGIN_EMAILS`, che arriva al Task 10 — se non ce l'hai ancora,
mettila ora in `.env`: `DEV_LOGIN_EMAILS=cristina@esempio.it,referente@esempio.it`) e apri `/`.
Expected: con almeno una tabella nel database, `/` salta direttamente sulla griglia. Il chevron
accanto al mese porta a `/rosters`, che elenca **un mese per riga** — non tre righe «agosto 2026» se
ci sono tre versioni.

- [ ] **Step 7: Suite intera, lint, commit**

```bash
npm test && npx next typegen && npm run lint
git add src/app/page.tsx src/app/rosters/page.tsx tests/app/landing.test.ts
git commit -m "feat(app): open straight on the current month

The home stops being a screen of buttons and becomes the redirect: zero
taps between opening the app and the reason it was opened. /rosters
becomes the month picker behind the chevron -- a Link, not a panel, so
there is no JavaScript and the URL stays shareable -- and shows one row
per month even when a month has three versions. Logout lives there and
only there."
```

---

## Task 8: La griglia di conferma

**Files:**
- Modify: `src/app/rosters/[id]/review/page.tsx`, `src/app/rosters/[id]/review/sync-button.tsx`,
  `tests/lib/no-literal-colors.test.ts`
- Create: `src/app/rosters/[id]/review/day-row.tsx`,
  `src/app/rosters/[id]/review/column-summary.tsx`

**Interfaces:**
- Consumes: `GridRow`, `GridSummary` da `@/modules/review`; `ShiftCodeDef` da `@/modules/codes`;
  `AppHeader`, `ActionDock`, `Banner`, `EmptyState` (Task 6); `size="touch"` (Task 4); i token
  semantici (Task 1). Le server action `confirmDayAction`, `unconfirmDayAction`, `correctCellAction`,
  `confirmColumnAction`, `syncColumnAction` restano dove sono, in `./actions`.
- Produces:
  - `DayRow({ row, rosterId, columnLabel, codes, canConfirm, canCorrect }: { row: GridRow; rosterId: string; columnLabel: string; codes: ShiftCodeDef[]; canConfirm: boolean; canCorrect: boolean })`
  - `ColumnSummary({ columnLabel, summary, canConfirm, extracting, unreadTouchingColumn, unknownBands }: { columnLabel: string; summary: GridSummary; canConfirm: boolean; extracting: boolean; unreadTouchingColumn: boolean; unknownBands: boolean })`

- [ ] **Step 1: Togli il file dall'elenco della guardia, e guarda la prova diventare rossa**

In `tests/lib/no-literal-colors.test.ts`, cancella la riga:

```ts
  'app/rosters/[id]/review/page.tsx',
```

Run: `npx vitest run tests/lib/no-literal-colors.test.ts`
Expected: FAIL — `app/rosters/[id]/review/page.tsx usa solo token` elenca i colori letterali trovati
(`bg-emerald-50`, `text-emerald-900`, `border-emerald-300`, `bg-amber-50`, `text-amber-900`,
`border-amber-400`, `bg-amber-900`, `text-amber-50`, `bg-rose-100`, `text-rose-900`,
`border-emerald-400`, `bg-emerald-100`). **Questo è il RED del task**, e guida il resto.

- [ ] **Step 2: Scrivi `day-row.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ShiftCodeDef } from '@/modules/codes'
import type { GridRow } from '@/modules/review'
import { confirmDayAction, correctCellAction, unconfirmDayAction } from './actions'

/**
 * Una riga giorno. Estratta da `page.tsx`, che a 436 righe non era più un file su
 * cui lavorare.
 *
 * Quello che guida l attenzione è `attention` (correzioni a penna, conflitti,
 * codici sconosciuti), **non** la confidenza: sulla misura reale nessuna cella
 * stava sotto 0,8 ed entrambe le celle sbagliate erano dichiarate con confidenza
 * alta. La confidenza si mostra comunque, come dato accessorio (regola
 * invariante 5), ma non colora niente.
 */
export function DayRow({
  row,
  rosterId,
  columnLabel,
  codes,
  canConfirm,
  canCorrect,
}: {
  row: GridRow
  rosterId: string
  columnLabel: string
  codes: ShiftCodeDef[]
  canConfirm: boolean
  canCorrect: boolean
}) {
  const domenica = row.weekday === 'dom'

  return (
    <li
      className={[
        'bg-card rounded-2xl px-3 py-3 shadow-sm',
        row.attention ? 'ring-warn/40 ring-2' : '',
        row.confirmed && !row.attention ? 'ring-ok/30 ring-1' : '',
        row.empty ? 'opacity-70' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <div
          className={[
            'flex size-12 shrink-0 flex-col items-center justify-center rounded-xl tabular',
            domenica ? 'bg-sunday-soft text-sunday-soft-foreground' : 'bg-muted text-foreground',
          ].join(' ')}
        >
          <span className="text-xl leading-none font-extrabold">{row.day}</span>
          <span className="text-[10px] tracking-wide uppercase opacity-70">{row.weekday}</span>
        </div>

        <div className="min-w-0 flex-1">
          {row.empty ? (
            <p className="text-muted-foreground text-sm">
              {row.declaredEmpty ? 'vuota — svuotata a mano' : 'nessun turno letto'}
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold">
                  {row.manuallyCorrected ? row.correctedCode : row.rawCode}
                </span>
                {row.codeLabel && (
                  <span className="text-muted-foreground text-sm">{row.codeLabel}</span>
                )}
                {row.unknownCode && <Badge variant="destructive">sconosciuto</Badge>}
                {row.manuallyCorrected && <Badge variant="outline">corretta a mano</Badge>}
              </p>
              {row.time && (
                <p className="text-muted-foreground text-sm tabular">
                  {row.time}
                  {row.crossesMidnight ? ` del ${row.day + 1}` : ''}
                  {row.location ? ` · ${row.location}` : ''}
                </p>
              )}
              {/* Chi guarda deve sapere cosa è stato corretto, e da cosa: senza
                  questo, una correzione sbagliata sarebbe invisibile. */}
              {row.manuallyCorrected && (
                <p className="text-muted-foreground text-xs">
                  {row.rawCode === null
                    ? 'scritta a mano: il lettore automatico non aveva letto niente qui'
                    : `corretta a mano: il lettore automatico aveva letto ${row.rawCode}`}
                </p>
              )}
              {!row.manuallyCorrected && row.confidence !== null && row.confidence < 0.9 && (
                <p className="text-muted-foreground text-xs tabular">
                  il lettore automatico si dichiara sicuro al {Math.round(row.confidence * 100)}%
                </p>
              )}
            </>
          )}

          {row.attentionReasons.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {row.attentionReasons.map((motivo) => (
                <li key={motivo} className="text-warn-soft-foreground bg-warn-soft rounded-lg px-2 py-1 text-xs font-medium">
                  {motivo}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canConfirm && row.confirmable && (
          <form
            action={row.confirmed ? unconfirmDayAction : confirmDayAction}
            className="shrink-0"
          >
            <input type="hidden" name="rosterId" value={rosterId} />
            <input type="hidden" name="columnLabel" value={columnLabel} />
            <input type="hidden" name="day" value={row.day} />
            <Button
              type="submit"
              size="touch"
              variant={row.confirmed ? 'outline' : 'default'}
              className={row.confirmed ? 'text-ok min-w-24' : 'min-w-24'}
            >
              {row.confirmed ? 'Confermato' : 'Confermo'}
            </Button>
          </form>
        )}
      </div>

      {row.confirmed && row.synced && (
        <p className="text-ok mt-2 text-xs font-medium">già sul tuo calendario</p>
      )}

      {/* La correzione si apre solo quando serve: una tendina per ogni giorno
          renderebbe illeggibile un mese intero sul telefono. Si sceglie fra i
          codici della legenda, perché un codice inventato non ha orario e non
          potrebbe diventare un evento. */}
      {canCorrect && (
        <details className="mt-2">
          <summary className="text-muted-foreground cursor-pointer py-2 text-xs underline">
            {row.empty ? 'Scrivi il turno di questo giorno' : 'Correggi questo giorno'}
          </summary>
          <form action={correctCellAction} className="mt-2 flex items-center gap-2">
            <input type="hidden" name="rosterId" value={rosterId} />
            <input type="hidden" name="columnLabel" value={columnLabel} />
            <input type="hidden" name="day" value={row.day} />
            <select
              name="code"
              defaultValue={row.code ?? ''}
              aria-label={`Codice del giorno ${row.day}`}
              className="border-input bg-background h-11 min-w-0 flex-1 rounded-xl border px-3 text-base"
            >
              <option value="">— la casella è vuota —</option>
              {codes.map((def) => (
                <option key={def.code} value={def.code}>
                  {def.code} · {def.label}
                </option>
              ))}
            </select>
            <Button type="submit" size="touch" variant="outline" className="shrink-0">
              Salva
            </Button>
          </form>
          <p className="text-muted-foreground mt-1.5 text-xs">
            Una correzione annulla la conferma di quel giorno: va riconfermato prima di finire sul
            calendario.
          </p>
        </details>
      )}
    </li>
  )
}
```

**Il `<select>` resta nativo e non diventa `Select` di Base UI:** su iOS il selettore nativo è una
ruota a tutto schermo, che per scegliere fra venti codici col pollice batte qualsiasi tendina
disegnata. È una scelta, non una dimenticanza.

- [ ] **Step 3: Scrivi `column-summary.tsx`**

```tsx
import { Banner } from '@/components/banner'
import { Badge } from '@/components/ui/badge'
import type { GridSummary } from '@/modules/review'

function elencoGiorni(giorni: number[]): string {
  if (giorni.length <= 8) return giorni.join(', ')
  return `${giorni.slice(0, 8).join(', ')} e altri ${giorni.length - 8}`
}

/** La testa della colonna: quanto è confermato, e cosa va guardato prima. */
export function ColumnSummary({
  columnLabel,
  summary,
  canConfirm,
  extracting,
  unreadTouchingColumn,
  unknownBands,
}: {
  columnLabel: string
  summary: GridSummary
  canConfirm: boolean
  extracting: boolean
  unreadTouchingColumn: boolean
  unknownBands: boolean
}) {
  const percentuale =
    summary.confirmable === 0 ? 0 : Math.round((summary.confirmed / summary.confirmable) * 100)

  return (
    <section className="flex flex-col gap-3">
      <div className="bg-card rounded-2xl px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-base font-bold">{columnLabel}</span>
          {summary.attention > 0 && (
            <Badge variant="destructive">{summary.attention} da rileggere</Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-2 text-sm tabular">
          <span className="text-foreground font-bold">{summary.confirmed}</span> di{' '}
          {summary.confirmable} confermati
        </p>
        <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
          <div className="bg-ok h-full rounded-full" style={{ width: `${percentuale}%` }} />
        </div>
      </div>

      {!canConfirm && (
        <Banner variant="info">
          Stai guardando la colonna di un altra persona: puoi leggerla, ma confermarla spetta solo a
          lei. Un turno finisce sul calendario di qualcuno unicamente con la sua conferma.
        </Banner>
      )}

      {extracting && (
        <Banner variant="warn">
          La lettura della tabella è ancora in corso: quello che vedi può essere incompleto.
        </Banner>
      )}

      {summary.emptyDays.length > 0 ? (
        <Banner
          variant="error"
          title={`${summary.emptyDays.length} ${summary.emptyDays.length === 1 ? 'giorno' : 'giorni'} senza turno letto`}
        >
          In questa colonna: {elencoGiorni(summary.emptyDays)}. Può voler dire che sulla tabella la
          casella era vuota, oppure che quel giorno non è stato letto: controllalo con la referente
          prima di fidarti.
        </Banner>
      ) : unreadTouchingColumn ? (
        <Banner variant="error">
          Una parte della tabella che contiene questa colonna non è stata letta.
        </Banner>
      ) : unknownBands ? (
        <Banner variant="info">
          Alcune parti della tabella non sono state lette, ma questa colonna risulta completa per
          tutti i giorni del mese.
        </Banner>
      ) : null}

      {summary.unknownCodes > 0 && (
        <Banner variant="warn">
          {summary.unknownCodes} {summary.unknownCodes === 1 ? 'codice' : 'codici'} non sono nella
          legenda: non si possono confermare finché la referente non li aggiunge, perché l app non
          inventa un orario che non conosce.
        </Banner>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Riscrivi `page.tsx` intorno ai due componenti**

Il calcolo resta **identico** a quello di oggi — `requireUser`, `rosterColumnLabels`,
`listColumnAliases`, `listShiftCodes`, `visibleColumns`, `aliasFor`, `canSeeColumn`,
`columnAssignments`, `buildColumnGrid`, `gridSummary`, `describeUnreadBands` — e non si tocca una
riga di logica. Cambia solo cosa si rende:

1. `<AppHeader>` al posto dell'intestazione scritta a mano:

```tsx
<AppHeader
  title={monthLabel(roster.year, roster.month)}
  subtitle={`${roster.ward}${roster.version > 1 ? ` · versione ${roster.version}` : ''} · ${scelta}`}
  pickerHref="/rosters"
  menuItems={menuItemsFor(user)}
/>
```

2. La barra delle colonne visibili (quando `visibili.length > 1`) diventa scorrevole in orizzontale,
   perché la referente ne vede dieci:

```tsx
<nav className="-mx-4 overflow-x-auto px-4">
  <div className="flex w-max gap-2 pb-1">
    {visibili.map((etichetta) => (
      <Link
        key={etichetta}
        href={`/rosters/${id}/review?colonna=${encodeURIComponent(etichetta)}`}
        className={
          etichetta === scelta
            ? 'bg-primary text-primary-foreground flex h-11 items-center rounded-full px-4 text-sm font-semibold'
            : 'border-border flex h-11 items-center rounded-full border px-4 text-sm'
        }
      >
        {etichetta}
      </Link>
    ))}
  </div>
</nav>
```

3. Gli avvisi `error` / `ok` / `sync` / `reauth` passano tutti da `<Banner>`. La tabella esatta delle
   sostituzioni:

| oggi | diventa |
|---|---|
| `bg-destructive/10 text-destructive` (errore) | `<Banner variant="error">` |
| `bg-emerald-50 text-emerald-900` (ok) | `<Banner variant="ok">` |
| `bg-muted/50` (esito del sync) | `<Banner variant="info" title="Esito del sync">` |
| `border-2 border-amber-400 bg-amber-50 text-amber-900` (reauth) | `<Banner variant="warn" title="Il collegamento con Google va rinnovato.">` |
| `bg-amber-900 text-amber-50` (bottone «Autorizza Google») | `<Button size="touch" render={<a href="/api/auth/google/start" />}>` |

Il **testo** dei messaggi non cambia: è stato scritto per spiegare, e riscriverlo qui sarebbe un
secondo lavoro dentro il primo.

4. `<ColumnSummary>` al posto della `Card` di riassunto, con:

```tsx
<ColumnSummary
  columnLabel={scelta}
  summary={riassunto}
  canConfirm={puoConfermare}
  extracting={inLettura}
  unreadTouchingColumn={bandeCheToccanoQuestaColonna.length > 0}
  unknownBands={bandeIgnote.length > 0}
/>
```

5. La lista dei giorni:

```tsx
<ul className="flex flex-col gap-2">
  {righe.map((riga) => (
    <DayRow
      key={riga.day}
      row={riga}
      rosterId={id}
      columnLabel={scelta}
      codes={codes}
      canConfirm={puoConfermare}
      canCorrect={puoCorreggere}
    />
  ))}
</ul>
```

6. Il blocco `sticky bottom-4` scritto a mano diventa `<ActionDock>`, **fuori** dal `<main>` così il
   bordo superiore taglia tutta la larghezza:

```tsx
{puoConfermare && (
  <ActionDock note="Niente finisce sul calendario prima di questa conferma.">
    <form action={confirmColumnAction}>
      <input type="hidden" name="rosterId" value={id} />
      <input type="hidden" name="columnLabel" value={scelta} />
      <Button type="submit" size="touch" className="w-full">
        Confermo tutti i {riassunto.confirmable} turni
      </Button>
    </form>
    {/* Due decisioni, due bottoni. La conferma dice «ho letto e va bene», il sync
        dice «scrivilo sul mio calendario»: il secondo non parte mai da sé dopo il
        primo (regola invariante 1). */}
    {riassunto.confirmed > 0 && (
      <form action={syncColumnAction}>
        <input type="hidden" name="rosterId" value={id} />
        <input type="hidden" name="columnLabel" value={scelta} />
        <SyncButton shifts={riassunto.confirmed} />
      </form>
    )}
  </ActionDock>
)}
```

7. Il caso `scelta === null` usa `<EmptyState title="Non c è ancora una colonna associata a te">` con
   il testo che c'è già.

8. Il `<main>` diventa `className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-safe pb-6"`
   — il `pb-32` sparisce: lo spazio in fondo ora lo occupa il dock, che è nel flusso.

- [ ] **Step 5: Aggiorna `sync-button.tsx`**

Sostituisci il `<button>` scritto a mano con `<Button type="submit" size="touch" variant="outline" className="w-full">`, tenendo il testo e lo stato `useFormStatus` (o quello che usa) come sono.

- [ ] **Step 6: Esegui la guardia e verifica che passi**

Run: `npx vitest run tests/lib/no-literal-colors.test.ts`
Expected: PASS. Se resta un colore, il messaggio lo nomina: cercalo e sostituiscilo col token
corrispondente della tabella del Task 1.

- [ ] **Step 7: Guarda la griglia sul telefono**

Run: `npm run dev`, apri dall'iPhone e vai su una tabella con turni.
Expected: le schede giorno hanno il quadratino del giorno, la domenica è rosa, i giorni da rileggere
hanno l'anello ambra, il dock in fondo **non** è coperto dalla barra dei gesti, e i bottoni
«Confermo» si toccano senza mirare. In tema scuro (Impostazioni → Schermo → Scuro) tutto resta
leggibile: se qualcosa sparisce, è un colore che non è passato da un token.

- [ ] **Step 8: Suite intera, lint, commit**

```bash
npm test && npx next typegen && npm run lint
git add "src/app/rosters/[id]/review/page.tsx" "src/app/rosters/[id]/review/day-row.tsx" \
        "src/app/rosters/[id]/review/column-summary.tsx" \
        "src/app/rosters/[id]/review/sync-button.tsx" tests/lib/no-literal-colors.test.ts
git commit -m "feat(review): dress the confirmation grid, and split it

436 lines in one file was not a file to work in: DayRow and ColumnSummary
come out, and none of the logic moves -- the same requireUser,
buildColumnGrid, gridSummary and describeUnreadBands calls in the same
order. Twelve literal colors become tokens, so the grid finally survives
dark mode, and the guard test now covers this file.

The native <select> stays native: on iOS it is a full-screen wheel, which
for picking one of twenty codes with a thumb beats any drawn dropdown."
```

---

## Task 9: Le pagine restanti

Un lotto solo: sette file, la stessa trasformazione — colori letterali via, taglie da tocco,
`AppHeader` con la freccia indietro, `Banner` per gli avvisi. Un solo file ha un cambio
**strutturale**, ed è quello che conta di più.

**Files:**
- Modify: `src/app/settings/codes/page.tsx`, `src/app/settings/users/page.tsx`,
  `src/app/login/page.tsx`, `src/app/rosters/upload/page.tsx`,
  `src/app/rosters/[id]/columns/page.tsx`, `src/app/rosters/[id]/page.tsx`,
  `src/app/rosters/[id]/extraction-progress.tsx`, `tests/lib/no-literal-colors.test.ts`

**Interfaces:**
- Consumes: tutto quello prodotto dai Task 1, 2, 4 e 6.
- Produces: niente di nuovo. È l'ultimo task di veste, e alla sua fine l'elenco `DA_CONVERTIRE` è
  vuoto e si cancella.

- [ ] **Step 1: Svuota l'elenco della guardia e cancellalo**

In `tests/lib/no-literal-colors.test.ts`: cancella le quattro righe rimaste dentro `DA_CONVERTIRE`,
poi cancella la costante, il suo commento, il `describe.each` che la usa e il `filter` — resta:

```ts
describe('nessuna pagina nomina un colore', () => {
  it.each(TUTTI)('%s usa solo token', (relativo) => {
    expect(coloriLetterali(path.join(RADICE, relativo))).toEqual([])
  })
})
```

Run: `npx vitest run tests/lib/no-literal-colors.test.ts`
Expected: FAIL — quattro file rossi (`login`, `settings/codes`, `settings/users`,
`rosters/[id]/page`), con i colori trovati elencati file per file. **Questo è il RED del task.**

- [ ] **Step 2: `settings/codes/page.tsx` — la tabella diventa schede**

È la pagina peggiore su iPhone: una `<table>` a 5 colonne (Codice, Etichetta, Tipo, Orario, Sede) che
su 390 px di larghezza costringe a scorrere in orizzontale o si comprime fino a essere illeggibile.

Sostituisci `<table>`/`<thead>`/`<tbody>` con:

```tsx
<ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
  {codes.map((def) => (
    <li key={def.code} className="bg-card rounded-2xl px-4 py-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-bold">{def.code}</span>
        {def.needsReview && <Badge variant="destructive">da chiarire</Badge>}
      </div>
      <p className="mt-0.5 text-sm">{def.label}</p>
      <dl className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="flex gap-1">
          <dt>tipo</dt>
          <dd className="text-foreground font-medium">{def.kind}</dd>
        </div>
        <div className="flex gap-1">
          <dt>orario</dt>
          <dd className="text-foreground font-medium tabular">
            {def.startTime && def.endTime
              ? `${def.startTime}–${def.endTime}${def.crossesMidnight ? ' (+1 giorno)' : ''}`
              : 'tutto il giorno'}
          </dd>
        </div>
        {def.location && (
          <div className="flex gap-1">
            <dt>sede</dt>
            <dd className="text-foreground font-medium">{def.location}</dd>
          </div>
        )}
      </dl>
    </li>
  ))}
</ul>
```

Il form di modifica che c'è già resta dov'è, con i campi passati a `size="touch"`.
`<AppHeader title="Codici turno" backHref="/rosters" />` in cima. L'avviso d'errore
(`bg-red-50 text-red-700`) diventa `<Banner variant="error">`.

**`def.needsReview` esiste già** in `ShiftCodeDef` e marca i codici delle domande aperte (`M+`, `P+`,
`RSF`): mostrarlo qui è utile e non è una funzione nuova, è un campo che c'era e non si vedeva.

- [ ] **Step 3: `settings/users/page.tsx`**

`<AppHeader title="Utenti" backHref="/rosters" />`. Le due `<ul>` (registrate, inviti in attesa)
diventano liste di schede:

```tsx
<li className="bg-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-sm">
  <div className="min-w-0">
    <p className="truncate font-semibold">{user.displayName}</p>
    <p className="text-muted-foreground truncate text-sm">{user.email}</p>
  </div>
  <Badge variant={user.role === 'REFERENTE' ? 'default' : 'secondary'}>{user.role}</Badge>
</li>
```

Sostituzioni: `text-gray-500` → `text-muted-foreground`, `bg-red-50 text-red-700` →
`<Banner variant="error">`. Il form d'invito prende `size="touch"` su campo e bottone.

- [ ] **Step 4: `login/page.tsx`**

`text-gray-600` → `text-muted-foreground`; `bg-red-50 text-red-700` → `<Banner variant="error">`;
`bg-black text-white` sul bottone Google → `<Button size="touch" className="w-full" render={<a href="/api/auth/google/start" />}>`.

Il riquadro dell'accesso di prova **resta visivamente distinto** — è un avviso, non una comodità — e
diventa `<Banner variant="warn" title="Accesso di prova, attivo solo in sviluppo">`, con i bottoni
per ogni indirizzo a `size="touch"` e `variant="outline"`. `border-dashed` si può tenere: non è un
colore.

Questa pagina non ha `AppHeader`: non c'è nessuna sessione, quindi nessun menu e nessun indietro.
Tiene il suo `min-h-screen` centrato, con `px-safe`.

- [ ] **Step 5: `rosters/upload/page.tsx`**

Nessun colore letterale da togliere; serve la veste. `<AppHeader title="Carica la tabella" backHref="/rosters" />`.
Il campo file diventa grande e ovvio — è la cosa che la referente fa una volta al mese:

```tsx
<label
  htmlFor="photo"
  className="border-border bg-card flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center"
>
  <CameraIcon className="text-muted-foreground size-8" />
  <span className="font-semibold">Scegli la foto della tabella</span>
  <span className="text-muted-foreground text-sm">
    Inquadra tutto il riquadro stampato, il più in piano possibile.
  </span>
</label>
<input id="photo" name="photo" type="file" accept="image/*" required className="sr-only" />
```

`CameraIcon` viene da `lucide-react`, che è già dipendenza. I `<select>` di mese e anno prendono
`h-11`, il bottone d'invio `size="touch"` e `w-full`.

- [ ] **Step 6: `rosters/[id]/columns/page.tsx`**

Nessun colore letterale. `<AppHeader title="Colonne e persone" backHref={\`/rosters/${id}/review\`} />`,
le `Card` diventano schede `bg-card rounded-2xl px-4 py-3 shadow-sm`, i `Select` prendono
`data-[size=touch]`, il bottone di salvataggio `size="touch"`.

- [ ] **Step 7: `rosters/[id]/page.tsx` e `extraction-progress.tsx`**

Qui ci sono colori letterali. `<AppHeader title={monthLabel(...)} backHref="/rosters" menuItems={menuItemsFor(user)} />`.
Gli avvisi passano da `<Banner>` con la stessa tabella di corrispondenze del Task 8. L'avanzamento
dell'estrazione usa `Meter` di `@base-ui/react/meter` — è già dipendenza — o, se il tipo dà fastidio,
la stessa barra di `ColumnSummary`:

```tsx
<div className="bg-muted h-1.5 overflow-hidden rounded-full">
  <div className="bg-primary h-full rounded-full" style={{ width: `${percentuale}%` }} />
</div>
```

L'anteprima dei tagli va più grande, a piena larghezza della colonna:
`className="w-full rounded-2xl border border-border"`. È il controllo umano prima di spendere una
chiamata al modello: piccola non serve a niente.

Il testo che si dirama su `extractionStrategyFromEnv()` (una lettura sola contro dieci) **resta
com'è**: dice il vero e cambierebbe se cambiasse la strategia.

- [ ] **Step 8: Esegui la guardia e verifica che passi**

Run: `npx vitest run tests/lib/no-literal-colors.test.ts`
Expected: PASS su tutti i file di `src/app` e `src/components`. Da qui in avanti la regola è
protetta: chiunque scriva `bg-emerald-50` in una pagina trova la suite rossa.

- [ ] **Step 9: Percorri tutte le pagine, in chiaro e in scuro**

Run: `npm run dev`, dall'iPhone: login → mese → selettore mesi → colonne → carica → codici → utenti.
Expected: nessuna pagina scorre in orizzontale; nessun testo sparisce in tema scuro; ogni bottone si
tocca al primo colpo; `settings/codes` è leggibile senza zoom.

- [ ] **Step 10: Suite intera, lint, commit**

```bash
npm test && npx next typegen && npm run lint
git add src/app tests/lib/no-literal-colors.test.ts
git commit -m "feat(ui): dress the remaining pages, and retire the allowlist

Seven files, one transformation. The one that mattered structurally is
settings/codes: a five-column HTML table that on a 390px screen either
scrolled sideways or compressed into illegibility, now a card list that
goes two-up from md: upward -- and it finally shows needsReview, a field
that was already in ShiftCodeDef and that nobody could see.

The literal-colour allowlist is now empty and deleted along with the test
that policed it. From here the rule is enforced for every file: writing
bg-emerald-50 in a page turns the suite red."
```

---

## Task 10: Il ciclo in locale, e la fermata su Google

**Files:**
- Modify: `.env` (locale, non versionato)
- Nessun file di codice: è la verifica che il piano non può automatizzare.

**Interfaces:**
- Consumes: tutto.
- Produces: la decisione se si deploya o si torna indietro.

**Questo task si interrompe a metà, per accordo:** al punto della configurazione Google si ferma e si
riprende insieme all'utente. Non provare a creare credenziali OAuth da solo.

- [ ] **Step 1: Verde su tutto, e nessun colore letterale**

```bash
. "$NVM_DIR/nvm.sh"; nvm use 22
npm test
npx next typegen && npm run lint
```
Expected: tutte verdi — le 897 esistenti più circa 55 nuove — e lint pulito. Se una delle 897 è
rossa, **non è accettabile**: nessun task di questo piano tocca la logica, quindi una regressione lì
è un errore da capire, non da aggirare.

- [ ] **Step 2: Compila per produzione, che è dove i difetti del guscio escono**

```bash
npm run build
```
Expected: build riuscita. `manifest.ts`, `icon.png` e `apple-icon.png` compaiono nell'elenco delle
route generate. Un errore su `viewport` o su `metadata` esce qui e non in sviluppo.

- [ ] **Step 3: Accesso di prova, e il ciclo senza Google**

In `.env`, aggiungi:

```
DEV_LOGIN_EMAILS=referente@esempio.it,cristina@esempio.it
```

Poi `npm run dev` e, dall'**iPhone**, `http://<ip-del-mac>:3000` (`ipconfig getifaddr en0`).
Aggiungi alla schermata Home e apri da lì, non da Safari: è il modo in cui verrà usata.

Percorri, come referente:

1. carica una delle due foto in `fixtures/` per il mese giusto;
2. guarda l'**anteprima dei tagli** — se i confini rilevati sono sbagliati si vede qui, prima di
   spendere una chiamata;
3. lancia l'estrazione: **una chiamata, 150–165 secondi**. La pagina dell'avanzamento non deve
   restare bloccata;
4. associa le colonne alle due persone in `/rosters/<id>/columns`;
5. esci, entra come `cristina@esempio.it`, e verifica che veda **solo la propria colonna**;
6. correggi a mano una cella, verifica che la conferma di quel giorno si annulli, riconferma;
7. conferma la colonna intera.

Expected: tutto questo funziona senza toccare Google. Il bottone «Manda sul mio calendario» compare
ma, premuto, chiede di autorizzare Google — ed è corretto.

- [ ] **Step 4: FERMATI QUI**

Il resto richiede credenziali Google vere, e **si configura insieme all'utente**. Riporta:

- cosa ha funzionato e cosa no nel punto 3;
- se l'icona e la modalità a schermo intero sono arrivate;
- se qualcosa non si legge in tema scuro;
- e chiedi di procedere con la configurazione OAuth.

Quello che servirà, quando si riprende: un client OAuth «Web application» su Google Cloud Console,
redirect `http://localhost:3001/api/auth/google/callback` **e** `http://<ip-del-mac>:3000/api/auth/google/callback`
se si prova dall'iPhone (Google accetta `localhost`; per un IP di rete locale **no**, quindi dal
telefono il sync andrà provato dopo il deploy, oppure dal Mac), scope `openid email profile` +
`calendar.events` + **`calendar.app.created`** — l'ultimo è obbligatorio: senza, la creazione del
calendario dedicato risponde 403.

- [ ] **Step 5: Dopo la configurazione — il ciclo completo**

Da fare solo dopo il punto 4, con l'utente:

1. accedi con Google vero, accetta i tre consensi;
2. conferma una colonna e premi «Manda sul mio calendario»;
3. apri Google Calendar: deve esserci un calendario **«Turni»** dedicato con gli eventi confermati,
   e nient'altro toccato;
4. verifica il turno di notte: comincia alle 21:00 e finisce alle 07:00 **del giorno dopo**;
5. premi di nuovo «Manda sul mio calendario»: **non deve creare doppioni** (il sync è idempotente e
   confronta istanti, non stringhe);
6. annulla la conferma di un giorno e risincronizza: l'evento già presente **non** si cancella
   (regola invariante 1).

- [ ] **Step 6: Chiudi l'accesso di prova prima di qualsiasi esposizione**

```bash
# In .env: cancella la riga, non commentarla.
# DEV_LOGIN_EMAILS=...
```
Expected: riavviando, `/login` non mostra più il riquadro dell'accesso di prova. **Prima** del deploy
sulla ZimaBoard e prima del tunnel, non dopo.

- [ ] **Step 7: Commit finale della documentazione**

Aggiorna il banner di `CLAUDE.md` con lo stato della Fase 6 e quello che è stato verificato sul
telefono vero, poi:

```bash
git add CLAUDE.md
git commit -m "docs: phase 6 done, and what was verified on a real iPhone"
```

---

## Copertura della spec

| sezione della spec | task |
|---|---|
| §4.1 regola «nessun colore letterale» | 1 (guardia), 8 e 9 (la applicano) |
| §4.2 palette in esadecimale, due temi | 1 |
| §4.3 `@custom-variant dark` | 1 |
| §4.4 tipografia Figtree, mono di sistema, `tabular-nums` | 2 |
| §4.5 raggi e taglie da tocco | 1 (`--radius`), 4 (taglie) |
| §5.1 manifest | 3 |
| §5.2 icone | 3 |
| §5.3 viewport e safe-area | 2 |
| §6.1 regola d'atterraggio, `romeYearMonth` | 5 (logica), 7 (pagina) |
| §6.2 selettore dei mesi | 5 (logica), 7 (pagina) |
| §6.3 menu della referente | 5 (logica), 6 (`AppMenu`) |
| §6.3-bis confini dei moduli | 5 |
| §6.4 `@view-transition` | 1 |
| §7 componenti condivisi | 6, più `DayRow`/`ColumnSummary` nell'8 |
| §8 le pagine | 7 (home e mesi), 8 (griglia), 9 (le altre sette) |
| §9 nessuna dipendenza nuova | vincolo globale, nessun task la viola |
| §10 le sette prove | 1 (guardia, contrasto), 2 (viewport), 3 (manifest), 4 (taglie), 5 (`romeYearMonth`, atterraggio, menu) |
| §11 ciclo in locale | 10 |
| §12 rischi | 7 (mese corrente assente), 10 (fermata Google) |
