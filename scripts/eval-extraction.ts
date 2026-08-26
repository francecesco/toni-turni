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
  const attesi = readdirSync(FIXTURES).filter((f) => f.endsWith('.expected.json'))
  if (attesi.length === 0) {
    console.error('Nessun file *.expected.json in fixtures/: senza verità di riferimento non si misura nulla.')
    process.exit(1)
  }

  const provider = providerFromEnv()
  const fallback = fallbackProviderFromEnv()
  const knownCodes = DEFAULT_SHIFT_CODES.map((def) => def.code)

  let totaleCelle = 0
  let totaleCorrette = 0
  // Un estrazione fallita (chiave mancante, provider giù, JSON irreparabile) non è
  // un dato di accuratezza: è un guasto, e va segnalato con un codice di uscita
  // diverso da zero perché uno script che finisce "verde" con zero celle misurate
  // nasconderebbe il problema.
  let fallimenti = 0

  for (const nomeAtteso of attesi) {
    const nomeFoto = nomeAtteso.replace('.expected.json', '.jpeg')
    const expected = JSON.parse(readFileSync(join(FIXTURES, nomeAtteso), 'utf8')) as ExpectedRoster

    console.log(`\n=== ${nomeFoto} (provider: ${provider.name}) ===`)
    const immagine = await normalizeRosterPhoto(readFileSync(join(FIXTURES, nomeFoto)))
    console.log(`immagine normalizzata: ${immagine.width}x${immagine.height}, ${Math.round(immagine.bytes / 1024)} KB`)

    const inizio = Date.now()
    const esito = await extractRoster({ image: immagine.data, knownCodes, provider, fallback })
    const secondi = ((Date.now() - inizio) / 1000).toFixed(1)

    if (!esito.ok) {
      console.error(`estrazione FALLITA dopo ${esito.attempts} tentativi in ${secondi}s: ${esito.error}`)
      console.error(`output grezzo: ${esito.rawOutput?.slice(0, 500) ?? '(nessuno)'}`)
      fallimenti += 1
      continue
    }

    const report = compareExtraction(expected, esito.extraction)
    const percentuale = report.total === 0 ? 0 : (report.correct / report.total) * 100

    totaleCelle += report.total
    totaleCorrette += report.correct

    console.log(`tentativi: ${esito.attempts} | tempo: ${secondi}s | provider usato: ${esito.provider} (${esito.model})`)
    console.log(`intestazione: ${esito.extraction.ward} ${esito.extraction.month}/${esito.extraction.year} (atteso: ${expected.ward} ${expected.month}/${expected.year})`)
    console.log(`accuratezza: ${report.correct}/${report.total} celle (${percentuale.toFixed(1)}%), mancanti ${report.missing}, in eccesso ${report.spurious}`)

    console.log('per colonna:')
    for (const [colonna, dati] of Object.entries(report.byColumn).sort()) {
      const pct = dati.total === 0 ? 0 : (dati.correct / dati.total) * 100
      console.log(`  ${colonna.padEnd(12)} ${dati.correct}/${dati.total} (${pct.toFixed(0)}%)`)
    }

    if (report.wrong.length > 0) {
      console.log(`celle sbagliate (${report.wrong.length}):`)
      for (const errore of report.wrong.slice(0, 40)) {
        console.log(`  giorno ${String(errore.day).padStart(2)} ${errore.column.padEnd(12)} atteso "${errore.expected}" letto "${errore.actual}"`)
      }
      if (report.wrong.length > 40) console.log(`  ... e altre ${report.wrong.length - 40}`)
    }
  }

  if (totaleCelle > 0) {
    const complessiva = (totaleCorrette / totaleCelle) * 100
    console.log(`\n=== TOTALE: ${totaleCorrette}/${totaleCelle} celle (${complessiva.toFixed(1)}%) ===`)
  }

  if (fallimenti > 0) {
    console.error(`\n${fallimenti} estrazione/i su ${attesi.length} non riuscita/e: vedi gli errori sopra.`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
