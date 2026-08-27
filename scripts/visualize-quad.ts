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
 * angoli.
 *
 * Uso: npx tsx scripts/visualize-quad.ts <cartella-output> [foto...]
 * Le foto sono nomi di file dentro `fixtures/`; senza argomenti usa le due foto
 * di calibrazione (agosto e settembre 2026). La cartella di output deve stare
 * fuori dal repository: sono foto di tabelle turni, non ci vanno in git.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import { detectTableQuad } from '../src/modules/ingest/grid'
import type { Point } from '../src/lib/homography'

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
  const buffer = readFileSync(join(process.cwd(), 'fixtures', name))
  const quad = await detectTableQuad(buffer)
  console.log(name, JSON.stringify(quad))

  const meta = await sharp(buffer).metadata()
  const corners = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
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

/** La cartella di output deve esistere e stare fuori dal repository. */
function checkOutDir(outDir: string): string {
  const target = resolve(outDir)
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`la cartella di output non esiste: ${target}`)
  }
  const inside = relative(process.cwd(), target)
  if (!inside.startsWith('..')) {
    throw new Error(
      `la cartella di output sta dentro il repository (${inside || '.'}): scegline una fuori, ` +
        'queste immagini sono foto di tabelle turni e non vanno in git',
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
