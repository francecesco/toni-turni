/**
 * Strumento di ispezione visiva per `detectTableQuad` (`@/modules/ingest/grid`):
 * disegna il quadrilatero trovato sopra la foto e salva il risultato in una
 * cartella a scelta, per un controllo a occhio.
 *
 * Il rilevamento della griglia e il pezzo piu fragile della Fase 2A-bis: un
 * riquadro sbagliato non produce un errore, produce ritagli spostati (turni
 * attribuiti al giorno o alla persona sbagliata). I test bloccano le regressioni
 * misurabili in coordinate, ma solo l'occhio umano vede se il riquadro contiene
 * davvero l'intera tabella (intestazioni comprese) su una foto nuova. Da
 * rilanciare ogni volta che si tocca `grid.ts` o si aggiunge una foto di
 * calibrazione.
 *
 * Uso: npx tsx scripts/visualize-quad.ts <cartella-output> [foto...]
 * Le foto sono nomi di file dentro `fixtures/`; senza argomenti usa le due foto
 * di calibrazione (agosto e settembre 2026).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { detectTableQuad } from '../src/modules/ingest/grid'

const DEFAULT_FIXTURES = ['roster-2026-08-3piano.jpeg', 'roster-2026-09-3piano.jpeg']

async function run(name: string, outDir: string): Promise<void> {
  const buffer = readFileSync(join(process.cwd(), 'fixtures', name))
  const quad = await detectTableQuad(buffer)
  console.log(name, JSON.stringify(quad))

  const meta = await sharp(buffer).metadata()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">
    <polygon points="${quad.topLeft.x},${quad.topLeft.y} ${quad.topRight.x},${quad.topRight.y} ${quad.bottomRight.x},${quad.bottomRight.y} ${quad.bottomLeft.x},${quad.bottomLeft.y}"
      fill="none" stroke="red" stroke-width="6" />
    <circle cx="${quad.topLeft.x}" cy="${quad.topLeft.y}" r="12" fill="lime" />
    <circle cx="${quad.topRight.x}" cy="${quad.topRight.y}" r="12" fill="blue" />
    <circle cx="${quad.bottomRight.x}" cy="${quad.bottomRight.y}" r="12" fill="yellow" />
    <circle cx="${quad.bottomLeft.x}" cy="${quad.bottomLeft.y}" r="12" fill="magenta" />
  </svg>`
  const overlay = Buffer.from(svg)
  const out = await sharp(buffer)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg()
    .toBuffer()

  const outPath = join(outDir, `quad-${name}`)
  writeFileSync(outPath, out)
  console.log('written', outPath, meta.width, meta.height)
}

async function main(): Promise<void> {
  const [outDir, ...fixtures] = process.argv.slice(2)
  if (!outDir) throw new Error('uso: npx tsx scripts/visualize-quad.ts <cartella-output> [foto...]')

  for (const name of fixtures.length ? fixtures : DEFAULT_FIXTURES) {
    await run(name, outDir)
  }
}

main()
