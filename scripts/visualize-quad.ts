/**
 * Strumento di ispezione visiva per `detectTableQuad` (`@/modules/ingest`):
 * disegna il quadrilatero trovato sopra la foto e salva il risultato in una
 * cartella a scelta, per un controllo a occhio.
 *
 * Il rilevamento della griglia è il pezzo più fragile della Fase 2A-bis: un
 * riquadro sbagliato non produce un errore, produce ritagli spostati (turni
 * attribuiti al giorno o alla persona sbagliata). I test bloccano le regressioni
 * misurabili in coordinate, ma solo l'occhio umano vede se il riquadro contiene
 * davvero l'intera tabella (intestazioni comprese) su una foto nuova. Da
 * rilanciare ogni volta che si toccano i file `grid*` o si aggiunge una foto di
 * calibrazione.
 *
 * Il tratto è sottile di proposito: l'errore che questo strumento deve rendere
 * visibile vale un passo di riga, cioè una trentina di pixel, e un tratto spesso
 * lo coprirebbe. Ai lati sono aggiunti dei trattini al 25/50/75%, per giudicare
 * se il lato è *parallelo* ai filetti stampati e non solo se ci passa vicino agli
 * angoli. I confini di colonna rilevati sono tratteggiati in ciano: sono
 * l'informazione su cui il Task 3 taglierà le bande.
 *
 * Uso: npx tsx scripts/visualize-quad.ts <cartella-output> [foto...]
 * Le foto sono nomi di file dentro `fixtures/`; senza argomenti usa le due foto
 * di calibrazione (agosto e settembre 2026). La cartella di output deve stare
 * fuori dal repository: sono foto di tabelle turni, non ci vanno in git.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { detectTableQuad } from '../src/modules/ingest/grid'
import { applyHomography, invertHomography, solveHomography, type Point } from '../src/lib/homography'

const DEFAULT_FIXTURES = ['roster-2026-08-3piano.jpeg', 'roster-2026-09-3piano.jpeg']

/** Trattino perpendicolare al lato, per giudicare il parallelismo con i filetti. */
function tick(a: Point, b: Point, t: number, length: number): string {
  const x = a.x + (b.x - a.x) * t
  const y = a.y + (b.y - a.y) * t
  const dx = b.x - a.x
  const dy = b.y - a.y
  const norm = Math.hypot(dx, dy) || 1
  const nx = (-dy / norm) * length
  const ny = (dx / norm) * length
  return `<line x1="${x - nx}" y1="${y - ny}" x2="${x + nx}" y2="${y + ny}" stroke="red" stroke-width="1" />`
}

async function run(name: string, outDir: string): Promise<void> {
  const buffer = readFileSync(join(REPO_ROOT, 'fixtures', name))
  const quad = await detectTableQuad(buffer)
  console.log(name, JSON.stringify(quad))

  const meta = await sharp(buffer).metadata()
  const corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]

  // I confini di colonna rilevati, riportati nella foto: sono in coordinate del
  // riquadro raddrizzato, quindi si tornano indietro con l'omografia inversa.
  // Servono a giudicare a occhio se il Task 3 può tagliare le bande su questi
  // confini invece che su frazioni fisse del riquadro.
  const dalRiquadro = invertHomography(
    solveHomography(
      [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    ),
  )
  const colonne = quad.columns
    .map((u) => {
      const alto = applyHomography(dalRiquadro, { x: u, y: 0 })
      const basso = applyHomography(dalRiquadro, { x: u, y: 1 })
      return `<line x1="${alto.x}" y1="${alto.y}" x2="${basso.x}" y2="${basso.y}" stroke="cyan" stroke-width="1" stroke-dasharray="6 6" />`
    })
    .join('\n    ')

  const ticks = [
    [quad.topLeft, quad.topRight],
    [quad.bottomLeft, quad.bottomRight],
    [quad.topLeft, quad.bottomLeft],
    [quad.topRight, quad.bottomRight],
  ]
    .flatMap(([a, b]) => [0.25, 0.5, 0.75].map((t) => tick(a, b, t, 12)))
    .join('\n    ')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">
    <polygon points="${corners.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="red" stroke-width="1" />
    ${colonne}
    ${ticks}
    <circle cx="${quad.topLeft.x}" cy="${quad.topLeft.y}" r="3" fill="lime" />
    <circle cx="${quad.topRight.x}" cy="${quad.topRight.y}" r="3" fill="blue" />
    <circle cx="${quad.bottomRight.x}" cy="${quad.bottomRight.y}" r="3" fill="yellow" />
    <circle cx="${quad.bottomLeft.x}" cy="${quad.bottomLeft.y}" r="3" fill="magenta" />
  </svg>`

  const out = await sharp(buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg()
    .toBuffer()

  const outPath = join(outDir, `quad-${name}`)
  writeFileSync(outPath, out)
  console.log('scritto', outPath, meta.width, meta.height)
}

/**
 * La radice del repository, dedotta dalla posizione di questo file. Non è
 * `process.cwd()`: la cartella di lavoro dipende da dove si lancia il comando,
 * e con `cd src && npx tsx ../scripts/visualize-quad.ts ..` la radice del
 * repository sembrerebbe stare fuori dal repository.
 */
export const REPO_ROOT = join(import.meta.dirname, '..')

/** La cartella di output deve esistere e stare fuori dal repository. */
export function checkOutDir(outDir: string, root: string = REPO_ROOT): string {
  const target = resolve(outDir)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`la cartella di output non esiste: ${target}`)
  }
  const inside = relative(root, target)
  if (!inside.startsWith('..')) {
    // il percorso relativo da solo è criptico: da `src` con output `..` vale
    // `.`, e il messaggio diceva «sta dentro il repository (.)». Serve il
    // percorso assoluto, che è quello che chi legge deve cambiare.
    const dove = inside === '' ? 'ne è la radice' : `sta in ${inside}`
    throw new Error(
      `la cartella di output ${target} è dentro il repository ${root} (${dove}): scegline una ` +
        'fuori, queste immagini sono foto di tabelle turni e non vanno in git',
    )
  }
  return target
}

async function main(): Promise<void> {
  const [outDir, ...fixtures] = process.argv.slice(2)
  if (!outDir) throw new Error('uso: npx tsx scripts/visualize-quad.ts <cartella-output> [foto...]')
  const target = checkOutDir(outDir)

  for (const name of fixtures.length ? fixtures : DEFAULT_FIXTURES) {
    await run(name, target)
  }
}

// solo quando lo script viene eseguito da riga di comando: importarlo per
// provare `checkOutDir` non deve far partire il rilevamento su due foto
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
