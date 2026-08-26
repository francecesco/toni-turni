/**
 * Misura l accuratezza dell estrazione contro le fixture, chiamando il provider REALE.
 * Non è un test: consuma token e non gira in CI. Uso: npm run eval
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeRosterPhoto } from '../src/modules/ingest/normalize'
import { extractRoster } from '../src/modules/extract/extract'
import { fallbackProviderFromEnv, providerFromEnv } from '../src/modules/extract/providers'
import { DEFAULT_SHIFT_CODES } from '../src/modules/codes/defaults'
import { compareExtraction, type ExpectedRoster } from './accuracy'

const FIXTURES = join(process.cwd(), 'fixtures')

async function main(): Promise<void> {
  const expectedFiles = readdirSync(FIXTURES).filter((f) => f.endsWith('.expected.json'))
  if (expectedFiles.length === 0) {
    console.error('Nessun file *.expected.json in fixtures/: senza verità di riferimento non si misura nulla.')
    process.exit(1)
  }

  const provider = providerFromEnv()
  const fallback = fallbackProviderFromEnv()
  const knownCodes = DEFAULT_SHIFT_CODES.map((def) => def.code)

  let totalCells = 0
  let totalCorrect = 0
  // Un estrazione fallita (chiave mancante, provider giù, JSON irreparabile) non è
  // un dato di accuratezza: è un guasto, e va segnalato con un codice di uscita
  // diverso da zero perché uno script che finisce "verde" con zero celle misurate
  // nasconderebbe il problema.
  const failedPhotos: string[] = []

  for (const expectedFileName of expectedFiles) {
    const photoFileName = expectedFileName.replace('.expected.json', '.jpeg')
    const expected = JSON.parse(readFileSync(join(FIXTURES, expectedFileName), 'utf8')) as ExpectedRoster

    console.log(`\n=== ${photoFileName} (provider: ${provider.name}) ===`)
    const image = await normalizeRosterPhoto(readFileSync(join(FIXTURES, photoFileName)))
    console.log(`immagine normalizzata: ${image.width}x${image.height}, ${Math.round(image.bytes / 1024)} KB`)

    const start = Date.now()
    const outcome = await extractRoster({ image: image.data, knownCodes, provider, fallback })
    const seconds = ((Date.now() - start) / 1000).toFixed(1)

    if (!outcome.ok) {
      console.error(`estrazione FALLITA dopo ${outcome.attempts} tentativi in ${seconds}s: ${outcome.error}`)
      console.error(`output grezzo: ${outcome.rawOutput?.slice(0, 500) ?? '(nessuno)'}`)
      failedPhotos.push(photoFileName)
      continue
    }

    const report = compareExtraction(expected, outcome.extraction)
    const percentage = report.total === 0 ? 0 : (report.correct / report.total) * 100

    totalCells += report.total
    totalCorrect += report.correct

    console.log(`tentativi: ${outcome.attempts} | tempo: ${seconds}s | provider usato: ${outcome.provider} (${outcome.model})`)
    console.log(`intestazione: ${outcome.extraction.ward} ${outcome.extraction.month}/${outcome.extraction.year} (atteso: ${expected.ward} ${expected.month}/${expected.year})`)
    console.log(`accuratezza: ${report.correct}/${report.total} celle (${percentage.toFixed(1)}%), mancanti ${report.missing}, in eccesso ${report.spurious}`)

    console.log('per colonna:')
    for (const [column, stats] of Object.entries(report.byColumn).sort(([a], [b]) => a.localeCompare(b))) {
      const pct = stats.total === 0 ? 0 : (stats.correct / stats.total) * 100
      console.log(`  ${column.padEnd(12)} ${stats.correct}/${stats.total} (${pct.toFixed(0)}%)`)
    }

    if (report.wrong.length > 0) {
      console.log(`celle sbagliate (${report.wrong.length}):`)
      for (const mistake of report.wrong.slice(0, 40)) {
        console.log(`  giorno ${String(mistake.day).padStart(2)} ${mistake.column.padEnd(12)} atteso "${mistake.expected}" letto "${mistake.actual}"`)
      }
      if (report.wrong.length > 40) console.log(`  ... e altre ${report.wrong.length - 40}`)
    }
  }

  // La riga finale deve dichiarare quante foto hanno davvero contribuito al numero:
  // un TOTALE senza copertura, letto da solo o fra un mese, può passare per una
  // media sulle foto quando in realtà ne riflette solo alcune (o nessuna).
  const measuredCount = expectedFiles.length - failedPhotos.length
  if (measuredCount === 0) {
    console.log(`\n=== TOTALE: nessuna foto misurata su ${expectedFiles.length} (tutte le estrazioni sono fallite) ===`)
  } else {
    const overallPercentage = (totalCorrect / totalCells) * 100
    const coverage =
      failedPhotos.length === 0
        ? `su ${measuredCount} foto`
        : `su ${measuredCount} foto misurate di ${expectedFiles.length} (fallite: ${failedPhotos.join(', ')})`
    console.log(`\n=== TOTALE: ${totalCorrect}/${totalCells} celle (${overallPercentage.toFixed(1)}%) ${coverage} ===`)
  }

  if (failedPhotos.length > 0) {
    console.error(`\n${failedPhotos.length} estrazione/i su ${expectedFiles.length} non riuscita/e: vedi gli errori sopra.`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
