/**
 * Misura l accuratezza dell estrazione contro le fixture, chiamando il provider
 * REALE. Non è un test: consuma token e non gira in CI. Uso: npm run eval
 *
 * Il percorso misurato è quello di produzione, nello stesso ordine: si normalizza la
 * foto, si rileva il riquadro e si raddrizza, si ritaglia secondo la **strategia**
 * (`AI_STRATEGY`: `whole`, la tabella intera in una chiamata, oppure `bands`, mezzo
 * mese per due colonne), si estrae, si fonde e si confronta con la trascrizione di
 * riferimento.
 *
 * Con `whole` la misura dura meno di un minuto: non c è più nessun pacing da
 * aspettare. Il pacer di prima esisteva per il tetto di 8000 token al minuto del
 * piano gratuito di Groq e valeva il 92% del tempo di una misura.
 *
 * `year`, `month` e `ward` **non** sono misurati: una banda non mostra
 * l intestazione del foglio, quindi arrivano dal chiamante (qui dalla fixture) come
 * arriveranno dall utente in produzione. La misura è sulle celle.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SHIFT_CODES } from '../src/modules/codes/defaults'
import { cropRosterBands, cropRosterWhole } from '../src/modules/ingest/crop'
import { normalizeRosterPhoto } from '../src/modules/ingest/normalize'
import {
  createRetryAfterPacer,
  extractRosterByBands,
  type BandPacer,
} from '../src/modules/extract/extract-bands'
import { extractionStrategyFromEnv } from '../src/modules/extract/strategy'
import { fallbackProviderFromEnv, providerFromEnv } from '../src/modules/extract/providers'
import type { VisionProvider } from '../src/modules/extract/providers'
import { compareExtraction, validateExpectedRoster, type ExpectedRoster } from './accuracy'

const FIXTURES = join(process.cwd(), 'fixtures')

/**
 * Chiave d ambiente richiesta da ciascun provider, per fallire **subito**.
 *
 * Senza questa guardia una chiave mancante si scoprirebbe una banda alla volta, con
 * lo stesso messaggio ripetuto una volta per banda invece di uno chiaro.
 */
const CHIAVE_RICHIESTA: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

/**
 * `tsx` non carica `.env` da sé, al contrario di `next`: senza questo la chiave non
 * arriverebbe mai al provider e la misura fallirebbe su tutte le bande.
 *
 * `loadEnvFile` **non sovrascrive** le variabili già presenti nell ambiente, nemmeno
 * quelle impostate a stringa vuota: `GEMINI_API_KEY= npm run eval` continua quindi a
 * valere "chiave assente", che è esattamente la verifica che deve restare possibile.
 */
function caricaEnvLocale(): void {
  try {
    process.loadEnvFile(join(process.cwd(), '.env'))
  } catch {
    // nessun .env: le variabili arrivano dall ambiente, ed è legittimo
  }
}

/** Una chiamata al provider, con quello che ha pesato. */
interface ChiamataAlModello {
  status: number
  ms: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

/** Registro della foto in corso: azzerato all inizio di ogni fixture. */
let registro: ChiamataAlModello[] = []

/**
 * Intercetta le chiamate HTTP ai provider per leggerne il consumo di token.
 *
 * I token non passano dall interfaccia `VisionProvider` — e non è questo lo script
 * che deve allargarla — ma sono il vincolo del piano gratuito, quindi vanno misurati:
 * il costo in input per banda con cui è tarato il pacer è una **stima**, e solo il
 * dato vero dice se è giusta.
 */
function osservaChiamateAlModello(): void {
  const fetchOriginale = globalThis.fetch

  const osservato: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!/generativelanguage\.googleapis\.com|api\.anthropic\.com/.test(url)) {
      return fetchOriginale(input, init)
    }

    const inizio = Date.now()
    const risposta = await fetchOriginale(input, init)
    const ms = Date.now() - inizio

    let inputTokens: number | null = null
    let outputTokens: number | null = null
    let totalTokens: number | null = null

    if (risposta.ok) {
      try {
        // `clone()`: il corpo deve restare leggibile dal provider
        const corpo = (await risposta.clone().json()) as {
          usage?: { input_tokens?: number; output_tokens?: number }
          usageMetadata?: {
            promptTokenCount?: number
            candidatesTokenCount?: number
            thoughtsTokenCount?: number
            totalTokenCount?: number
          }
        }
        const usage = corpo.usage
        const gemini = corpo.usageMetadata
        inputTokens = gemini?.promptTokenCount ?? usage?.input_tokens ?? null
        // I token di ragionamento sono token di uscita fatturati e contano nel
        // tetto di `maxOutputTokens`: tenerli fuori farebbe sembrare la risposta
        // molto piu leggera di quanto e, e sono la ragione per cui il tetto e largo.
        const ragionamento = gemini?.thoughtsTokenCount ?? 0
        outputTokens =
          gemini?.candidatesTokenCount !== undefined
            ? gemini.candidatesTokenCount + ragionamento
            : (usage?.output_tokens ?? null)
        totalTokens =
          gemini?.totalTokenCount ??
          (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null)
      } catch {
        // corpo non decodificabile: i token restano ignoti, la misura prosegue
      }
    }

    registro.push({ status: risposta.status, ms, inputTokens, outputTokens, totalTokens })
    return risposta
  }

  globalThis.fetch = osservato
}

/** Giorni del mese: `month` è 1-based, e il giorno 0 del mese dopo è l ultimo di questo. */
function giorniDelMese(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function mediana(valori: number[]): number | null {
  if (valori.length === 0) return null
  const ordinati = [...valori].sort((a, b) => a - b)
  const meta = Math.floor(ordinati.length / 2)
  return ordinati.length % 2 === 1 ? ordinati[meta] : Math.round((ordinati[meta - 1] + ordinati[meta]) / 2)
}

function estremi(valori: number[]): string {
  if (valori.length === 0) return 'n/d'
  return `min ${Math.min(...valori)}, mediana ${mediana(valori)}, max ${Math.max(...valori)}`
}

function percentuale(correct: number, total: number): string {
  return total === 0 ? 'n/d' : `${((correct / total) * 100).toFixed(1)}%`
}

/** Somma dei token di un gruppo di chiamate, `null` se nessuna li ha dichiarati. */
function sommaToken(chiamate: ChiamataAlModello[], campo: 'inputTokens' | 'outputTokens' | 'totalTokens'): number | null {
  const dichiarati = chiamate.map((c) => c[campo]).filter((v): v is number => v !== null)
  return dichiarati.length === 0 ? null : dichiarati.reduce((a, b) => a + b, 0)
}

/**
 * Accuratezza sulle sole celle di una metà del mese, riusando `compareExtraction` su
 * un sottoinsieme del riferimento. Una banda è un gruppo di colonne per una metà del
 * mese: incrociata con la ripartizione per colonna, questa è l accuratezza per banda.
 */
function meta(expected: ExpectedRoster, da: number, a: number): ExpectedRoster {
  return { ...expected, cells: expected.cells.filter((c) => c.day >= da && c.day <= a) }
}

function verificaChiavi(provider: VisionProvider, fallback: VisionProvider | null): void {
  for (const candidato of [provider, fallback]) {
    if (candidato === null) continue
    const chiave = CHIAVE_RICHIESTA[candidato.name]
    if (chiave === undefined) continue
    if ((process.env[chiave] ?? '').trim() !== '') continue

    console.error(
      `Manca la variabile d'ambiente ${chiave}, richiesta dal provider "${candidato.name}".`,
    )
    console.error(
      'Questa misura chiama il provider reale: senza chiave ogni immagine fallirebbe una per una,',
    )
    console.error('con lo stesso messaggio ripetuto invece di questo.')
    console.error("Metti la chiave in .env (non nel repository) oppure esportala nell'ambiente.")
    process.exit(1)
  }
}

async function main(): Promise<void> {
  caricaEnvLocale()
  osservaChiamateAlModello()

  const expectedFiles = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.expected.json'))
    .sort()
  if (expectedFiles.length === 0) {
    console.error('Nessun file *.expected.json in fixtures/: senza verità di riferimento non si misura nulla.')
    process.exit(1)
  }

  const provider = providerFromEnv()
  const fallback = fallbackProviderFromEnv()
  verificaChiavi(provider, fallback)

  const knownCodes = DEFAULT_SHIFT_CODES.map((def) => def.code)

  const strategy = extractionStrategyFromEnv()

  // Il pacer attende solo davanti a un rate limit: non c e piu nessun tetto di
  // token al minuto da rispettare, e distanziare per prudenza costerebbe minuti a
  // vuoto a ogni misura.
  const pacer = createRetryAfterPacer()

  console.log(
    `provider: ${provider.name}${fallback ? ` (riserva: ${fallback.name})` : ' (nessuna riserva)'}`,
  )
  console.log(
    `strategia: ${strategy}${
      strategy === 'whole'
        ? ' — la tabella intera in una chiamata sola'
        : ' — mezzo mese per due colonne, il percorso misurato al 99,8%'
    }`,
  )

  let totalCells = 0
  let totalCorrect = 0
  let totalBands = 0
  let totalFailedBands = 0
  let totalPartialBands = 0
  let totalTokens = 0
  const inputPerBanda: number[] = []
  // Un estrazione fallita (chiave mancante, provider giù, JSON irreparabile) non è
  // un dato di accuratezza: è un guasto, e va segnalato con un codice di uscita
  // diverso da zero perché uno script che finisce "verde" con zero celle misurate
  // nasconderebbe il problema.
  const failedPhotos: string[] = []
  // Foto su cui la metrica handCorrected non è misurabile: la fixture non
  // dichiara la chiave, quindi il dato che si legge vale su un campione più
  // piccolo di quello che la riga finale sembra coprire.
  const handCorrectedNonMisurabile: string[] = []
  // Se anche una sola fixture misurata non è verificata, il TOTALE finale non può
  // sembrare un dato definitivo.
  let riferimentoNonVerificato = false

  const inizioMisura = Date.now()

  for (const expectedFileName of expectedFiles) {
    const photoFileName = expectedFileName.replace('.expected.json', '.jpeg')
    const rawFixture = JSON.parse(readFileSync(join(FIXTURES, expectedFileName), 'utf8')) as unknown

    const validated = validateExpectedRoster(rawFixture)
    if (!validated.ok) {
      console.error(`${expectedFileName}: fixture non valida — ${validated.error}`)
      failedPhotos.push(photoFileName)
      continue
    }
    const expected = validated.value

    console.log(`\n=== ${photoFileName} (provider: ${provider.name}) ===`)
    if (expected.verified === false) {
      riferimentoNonVerificato = true
      console.log('*** ATTENZIONE: riferimento NON verificato da una persona che conosce il reparto ***')
      if (expected._avvertenza) console.log(`    ${expected._avvertenza}`)
    }

    const image = await normalizeRosterPhoto(readFileSync(join(FIXTURES, photoFileName)))
    console.log(`immagine normalizzata: ${image.width}x${image.height}, ${Math.round(image.bytes / 1024)} KB`)

    const daysInMonth = giorniDelMese(expected.year, expected.month)
    const inizioTaglio = Date.now()
    let bands
    try {
      bands =
        strategy === 'whole'
          ? [await cropRosterWhole(image.data, { daysInMonth })]
          : await cropRosterBands(image.data, { daysInMonth })
    } catch (error) {
      // Tabella non rilevata o confini inservibili: non c è niente da mandare al
      // modello, e un ritaglio a caso produrrebbe turni sbagliati.
      console.error(`taglio in bande FALLITO: ${error instanceof Error ? error.message : String(error)}`)
      failedPhotos.push(photoFileName)
      continue
    }
    console.log(
      `taglio: ${bands.length} ${bands.length === 1 ? 'immagine' : 'bande'} in ` +
        `${((Date.now() - inizioTaglio) / 1000).toFixed(1)}s ` +
        `(${daysInMonth} giorni, ${bands[0].spec.columns.length} colonne, ` +
        `${bands[0].width}x${bands[0].height} px = ${(bands[0].height / (bands[0].spec.dayTo - bands[0].spec.dayFrom + 3)).toFixed(0)} px per riga)`,
    )

    registro = []
    const inizioBanda: number[] = [0]
    let atteseDaRateLimit = 0
    let msDiAttesa = 0

    // Il pacer reale, con in più la marcatura dei confini fra le bande: `pace(index)`
    // senza `retryAfter` viene chiamato **prima** della banda `index`, quindi dice
    // dove finiscono le chiamate della banda precedente. Le chiamate con
    // `retryAfter` sono attese per rate limit dentro una banda, non confini.
    const pace: BandPacer = async (index, retryAfterSeconds) => {
      if (retryAfterSeconds === undefined) inizioBanda[index] = registro.length
      else atteseDaRateLimit += 1
      const t0 = Date.now()
      await pacer(index, retryAfterSeconds)
      msDiAttesa += Date.now() - t0
    }

    const start = Date.now()
    const outcome = await extractRosterByBands({
      bands,
      knownCodes,
      header: { year: expected.year, month: expected.month, ward: expected.ward },
      provider,
      fallback,
      pace,
    })
    const secondi = (Date.now() - start) / 1000

    const fallite = new Set(outcome.failures.filter((f) => f.cells === undefined).map((f) => f.spec))
    const aMeta = new Set(outcome.failures.filter((f) => f.cells !== undefined).map((f) => f.spec))
    totalBands += bands.length
    totalFailedBands += fallite.size
    totalPartialBands += aMeta.size

    console.log(
      `estrazione: ${secondi.toFixed(0)}s totali, di cui ${(msDiAttesa / 1000).toFixed(0)}s di attesa di pacing | ` +
        `${outcome.attempts} chiamate | provider usato: ${outcome.provider}`,
    )

    console.log('bande:')
    for (let i = 0; i < bands.length; i += 1) {
      const banda = bands[i]
      const chiamate = registro.slice(inizioBanda[i] ?? 0, inizioBanda[i + 1] ?? registro.length)
      const input = sommaToken(chiamate, 'inputTokens')
      const output = sommaToken(chiamate, 'outputTokens')
      const totale = sommaToken(chiamate, 'totalTokens')
      const ms = chiamate.reduce((a, c) => a + c.ms, 0)
      const codici = chiamate.map((c) => c.status).join(',') || 'nessuna risposta'
      const esito = fallite.has(banda.spec) ? 'FALLITA' : aMeta.has(banda.spec) ? 'A META' : 'ok'

      if (input !== null) inputPerBanda.push(input)
      if (totale !== null) totalTokens += totale

      console.log(
        `  ${String(i).padStart(2)} giorni ${String(banda.spec.dayFrom).padStart(2)}-${String(banda.spec.dayTo).padStart(2)} ` +
          `col=[${banda.spec.columns.join(',')}] ${banda.width}x${banda.height} ` +
          `${esito.padEnd(7)} ${chiamate.length} chiamate (${codici}) ` +
          `token in ${input ?? '?'} / out ${output ?? '?'} / tot ${totale ?? '?'} ` +
          `in ${(ms / 1000).toFixed(1)}s`,
      )
    }

    if (outcome.failures.length > 0) {
      // Due specie di buco, dallo stesso meccanismo: la banda che non ha risposto e
      // la banda che ha risposto **corta**. La seconda è il modo in cui questo
      // modello sbagliava in Fase 2A, quindi va distinta a schermo.
      const aMeta = outcome.failures.filter((f) => f.cells !== undefined).length
      console.log(
        `bande con buchi dichiarati (${outcome.failures.length}, di cui ${aMeta} lette a metà) — ` +
          'sono buchi dichiarati, non celle assenti:',
      )
      for (const failure of outcome.failures) {
        console.log(
          `  giorni ${failure.spec.dayFrom}-${failure.spec.dayTo} col=[${failure.spec.columns.join(',')}]: ${failure.error}`,
        )
      }
    } else {
      console.log('bande con buchi dichiarati: nessuna')
    }

    console.log(`conflitti di fusione: ${outcome.conflicts}`)
    if (atteseDaRateLimit > 0) console.log(`attese supplementari per rate limit: ${atteseDaRateLimit}`)
    const rifiutate = registro.filter((c) => c.status === 429).length
    if (rifiutate > 0) console.log(`risposte 429 ricevute: ${rifiutate}`)

    const report = compareExtraction(expected, outcome.extraction)
    const primaMeta = Math.ceil(daysInMonth / 2)
    const reportPrima = compareExtraction(meta(expected, 1, primaMeta), outcome.extraction)
    const reportSeconda = compareExtraction(meta(expected, primaMeta + 1, daysInMonth), outcome.extraction)

    totalCells += report.total
    totalCorrect += report.correct

    console.log(
      `celle prodotte dal modello (dopo la fusione): ${outcome.extraction.cells.length}, su ${report.total} attese`,
    )
    console.log(`colonne lette: ${outcome.extraction.columns.join(', ')}`)
    console.log(
      `accuratezza: ${report.correct}/${report.total} celle (${percentuale(report.correct, report.total)}), ` +
        `mancanti ${report.missing}, sbagliate ${report.wrong.length}, in eccesso ${report.spurious}`,
    )
    if (expected.verified === false) {
      console.log('    ^ ATTENZIONE: percentuale calcolata contro un riferimento NON verificato')
    }

    console.log(`per colonna (totale | giorni 1-${primaMeta} | giorni ${primaMeta + 1}-${daysInMonth}):`)
    for (const [column, stats] of Object.entries(report.byColumn).sort(([a], [b]) => a.localeCompare(b))) {
      const prima = reportPrima.byColumn[column] ?? { total: 0, correct: 0 }
      const seconda = reportSeconda.byColumn[column] ?? { total: 0, correct: 0 }
      const cella = (s: { total: number; correct: number }) =>
        `${String(s.correct).padStart(2)}/${String(s.total).padEnd(2)} (${percentuale(s.correct, s.total).padStart(6)})`
      console.log(`  ${column.padEnd(12)} ${cella(stats)} | ${cella(prima)} | ${cella(seconda)}`)
    }
    console.log(
      `  ${'TOTALE'.padEnd(12)} ${report.correct}/${report.total} | ` +
        `${reportPrima.correct}/${reportPrima.total} (${percentuale(reportPrima.correct, reportPrima.total)}) | ` +
        `${reportSeconda.correct}/${reportSeconda.total} (${percentuale(reportSeconda.correct, reportSeconda.total)})`,
    )

    const pct = (value: number | null) => (value === null ? 'n/d' : `${(value * 100).toFixed(0)}%`)

    if (report.handCorrectedAccuracy) {
      const { truePositives, falsePositives, falseNegatives, precision, recall } = report.handCorrectedAccuracy
      console.log(
        `correzioni a mano riconosciute: precisione ${pct(precision)}, recall ${pct(recall)} ` +
          `(veri positivi ${truePositives}, falsi positivi ${falsePositives}, falsi negativi ${falseNegatives})`,
      )
    }

    // La misura **larga**: le celle che una persona deve rileggere sono le
    // riscritture a mano piu le annotazioni d orario a penna, che il prompt chiede
    // esplicitamente di marcare. Contarle come falsi positivi misurerebbe il
    // contrario di quello che si e chiesto — ma la misura stretta resta sopra,
    // perche e la sua recall che non deve scendere.
    if (report.toReviewAccuracy) {
      const { truePositives, falsePositives, falseNegatives, precision, recall } = report.toReviewAccuracy
      console.log(
        `celle da rileggere (correzioni + annotazioni): precisione ${pct(precision)}, recall ${pct(recall)} ` +
          `(veri positivi ${truePositives}, falsi positivi ${falsePositives}, falsi negativi ${falseNegatives})`,
      )
      const inspiegate = report.unexplainedHandCorrected ?? []
      if (inspiegate.length > 0) {
        console.log(
          `    marcate senza che la fixture le elenchi (${inspiegate.length}): ` +
            inspiegate.map((c) => `${c.day} ${c.column}`).join(', '),
        )
      }
    }

    if (!report.handCorrectedAccuracy) {
      // Un limite dichiarato invece di un limite invisibile: senza la chiave
      // `handCorrected` nella fixture, `compareExtraction` salta il blocco e
      // metà delle celle prodotte non viene mai controllata per falsi positivi.
      // La Fase 3 si progetta su questo segnale, quindi la percentuale che si
      // legge sull altra foto è un limite superiore ottimista, non una media.
      console.log(
        'correzioni a mano riconosciute: NON MISURABILE su questa foto — la fixture non dichiara',
      )
      console.log(
        '    "handCorrected", quindi non si sa quante celle marcate dal modello siano falsi positivi.',
      )
      console.log(
        '    Da fare: qualcuno che conosce il reparto elenca le correzioni a penna di questa foto.',
      )
      handCorrectedNonMisurabile.push(photoFileName)
    }

    console.log('per fascia di confidenza:')
    for (const [fascia, stats] of Object.entries(report.byConfidenceBucket)) {
      console.log(`  ${fascia.padEnd(8)} ${stats.correct}/${stats.total} (${percentuale(stats.correct, stats.total)})`)
    }

    if (report.wrong.length > 0) {
      console.log(`celle sbagliate (${report.wrong.length}):`)
      for (const mistake of report.wrong) {
        console.log(
          `  giorno ${String(mistake.day).padStart(2)} ${mistake.column.padEnd(12)} atteso "${mistake.expected}" letto "${mistake.actual}"`,
        )
      }
    }

    if (expected._daVerificare) {
      console.log(`punto meno certo della trascrizione: ${expected._daVerificare}`)
    }

    if (outcome.extraction.cells.length === 0) {
      console.error('nessuna cella prodotta: l estrazione di questa foto è un guasto, non un dato')
      failedPhotos.push(photoFileName)
    }
  }

  // La riga finale deve dichiarare quante foto hanno davvero contribuito al numero:
  // un TOTALE senza copertura, letto da solo o fra un mese, può passare per una
  // media sulle foto quando in realtà ne riflette solo alcune (o nessuna).
  const measuredCount = expectedFiles.length - failedPhotos.length
  if (measuredCount === 0) {
    console.log(`\n=== TOTALE: nessuna foto misurata su ${expectedFiles.length} (tutte le estrazioni sono fallite) ===`)
  } else {
    const coverage =
      failedPhotos.length === 0
        ? `su ${measuredCount} foto`
        : `su ${measuredCount} foto misurate di ${expectedFiles.length} (fallite: ${failedPhotos.join(', ')})`
    console.log(
      `\n=== TOTALE: ${totalCorrect}/${totalCells} celle (${percentuale(totalCorrect, totalCells)}) ${coverage} ===`,
    )
    if (riferimentoNonVerificato) {
      console.log('*** ATTENZIONE: la percentuale sopra include almeno una fixture NON verificata da una persona che conosce il reparto ***')
    }
  }

  console.log(
    `immagini mandate al modello: ${totalBands} in tutto, ${totalFailedBands} non lette, ` +
      `${totalPartialBands} lette a metà | ` +
      `tempo totale ${((Date.now() - inizioMisura) / 1000 / 60).toFixed(1)} minuti | ` +
      `token consumati ${totalTokens}`,
  )
  if (handCorrectedNonMisurabile.length > 0) {
    console.log(
      `*** handCorrected misurato su ${expectedFiles.length - handCorrectedNonMisurabile.length} foto su ${expectedFiles.length}: ` +
        `non dichiarato in ${handCorrectedNonMisurabile.join(', ')} ***`,
    )
  }
  console.log(`token di input per chiamata: ${estremi(inputPerBanda)}`)

  if (failedPhotos.length > 0) {
    console.error(`\n${failedPhotos.length} estrazione/i su ${expectedFiles.length} non riuscita/e: vedi gli errori sopra.`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
