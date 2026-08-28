import { describe, expect, it } from 'vitest'
import type { BandSpec } from '@/modules/ingest/layout'
import {
  mergeBandExtractions,
  parseBandExtraction,
  type BandExtraction,
} from '@/modules/extract/band-schema'

const HEADER = { year: 2026, month: 8, ward: '3°PIANO' }

/** Una banda finta: contano solo `columns` (indici) e l intervallo di giorni. */
function spec(columns: number[], dayFrom: number, dayTo: number): BandSpec {
  return {
    columns,
    dayFrom,
    dayTo,
    days: { left: 0, width: 0.1 },
    crop: { left: 0.1, top: 0, width: 0.2, height: 0.5 },
    header: null,
  }
}

function cell(
  day: number,
  column: string,
  code: string,
  confidence = 0.9,
  handCorrected = false,
) {
  return { day, column, code, confidence, handCorrected }
}

function band(columns: string[], cells: BandExtraction['cells']): BandExtraction {
  return { columns, cells }
}

describe('parseBandExtraction', () => {
  it('accetta una banda senza year, month e ward, che una banda non mostra', () => {
    const result = parseBandExtraction(
      JSON.stringify({
        columns: ['RENATA', 'MERY'],
        cells: [cell(1, 'RENATA', 'M'), cell(1, 'MERY', '')],
      }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.columns).toEqual(['RENATA', 'MERY'])
      expect(result.value.cells).toHaveLength(2)
    }
  })

  it('isola il JSON da recinti markdown e frasi di cortesia', () => {
    const result = parseBandExtraction(
      'Ecco il risultato:\n```json\n{"columns":["RENATA"],"cells":[]}\n```\nSpero sia utile.',
    )

    expect(result.ok).toBe(true)
  })

  it('rifiuta una banda senza columns', () => {
    const result = parseBandExtraction(JSON.stringify({ cells: [] }))
    expect(result.ok).toBe(false)
  })

  it('rifiuta una banda senza cells', () => {
    const result = parseBandExtraction(JSON.stringify({ columns: ['RENATA'] }))
    expect(result.ok).toBe(false)
  })

  it('rifiuta una confidenza fuori dall intervallo 0..1', () => {
    const result = parseBandExtraction(
      JSON.stringify({ columns: ['RENATA'], cells: [cell(1, 'RENATA', 'M', 1.4)] }),
    )
    expect(result.ok).toBe(false)
  })

  it('ignora i campi in più, invece di rifiutare la banda', () => {
    const result = parseBandExtraction(
      JSON.stringify({ year: 2026, month: 8, columns: ['RENATA'], cells: [] }),
    )
    expect(result.ok).toBe(true)
  })

  it('rifiuta un testo che non contiene JSON', () => {
    expect(parseBandExtraction('non ce la faccio').ok).toBe(false)
  })

  it('non ammette un codice sconosciuto come motivo di rifiuto', () => {
    const result = parseBandExtraction(
      JSON.stringify({ columns: ['RENATA'], cells: [cell(1, 'RENATA', 'RSF?')] }),
    )
    expect(result.ok).toBe(true)
  })
})

describe('mergeBandExtractions', () => {
  it('unisce le celle di due bande disgiunte', () => {
    const { extraction, conflicts } = mergeBandExtractions(
      [
        { spec: spec([1, 2], 1, 16), extraction: band(['RENATA', 'MERY'], [cell(1, 'RENATA', 'M')]) },
        { spec: spec([3, 4], 1, 16), extraction: band(['ALEX', 'CRISTINA'], [cell(2, 'ALEX', 'P')]) },
      ],
      HEADER,
    )

    expect(conflicts).toBe(0)
    expect(extraction.cells).toHaveLength(2)
    expect(extraction.columns).toEqual(['RENATA', 'MERY', 'ALEX', 'CRISTINA'])
  })

  it('prende year, month e ward dal chiamante, non dal modello', () => {
    const { extraction } = mergeBandExtractions(
      [{ spec: spec([1], 1, 16), extraction: band(['RENATA'], []) }],
      { year: 2026, month: 9, ward: '4°PIANO' },
    )

    expect(extraction.year).toBe(2026)
    expect(extraction.month).toBe(9)
    expect(extraction.ward).toBe('4°PIANO')
  })

  it('nella sovrapposizione fra le due metà del mese vince la confidenza più alta', () => {
    const { extraction, conflicts } = mergeBandExtractions(
      [
        {
          spec: spec([1], 1, 16),
          extraction: band(['RENATA'], [cell(16, 'RENATA', 'M', 0.4)]),
        },
        {
          spec: spec([1], 16, 31),
          extraction: band(['RENATA'], [cell(16, 'RENATA', 'P', 0.8)]),
        },
      ],
      HEADER,
    )

    expect(extraction.cells).toHaveLength(1)
    expect(extraction.cells[0].code).toBe('P')
    // codici diversi sulla stessa cella: è un conflitto, anche se risolto
    expect(conflicts).toBe(1)
  })

  it('a parità di confidenza vince la prima banda', () => {
    const { extraction } = mergeBandExtractions(
      [
        { spec: spec([1], 1, 16), extraction: band(['RENATA'], [cell(16, 'RENATA', 'M', 0.7)]) },
        { spec: spec([1], 16, 31), extraction: band(['RENATA'], [cell(16, 'RENATA', 'P', 0.7)]) },
      ],
      HEADER,
    )

    expect(extraction.cells[0].code).toBe('M')
  })

  it('la stessa cella letta uguale da due bande non è un conflitto', () => {
    const { extraction, conflicts } = mergeBandExtractions(
      [
        { spec: spec([1], 1, 16), extraction: band(['RENATA'], [cell(16, 'RENATA', 'M', 0.5)]) },
        { spec: spec([1], 16, 31), extraction: band(['RENATA'], [cell(16, 'RENATA', 'M', 0.9)]) },
      ],
      HEADER,
    )

    expect(conflicts).toBe(0)
    expect(extraction.cells).toHaveLength(1)
    expect(extraction.cells[0].confidence).toBe(0.9)
  })

  it('scarta una cella con giorno fuori dall intervallo della banda e la conta come conflitto', () => {
    const { extraction, conflicts } = mergeBandExtractions(
      [
        {
          spec: spec([1], 1, 16),
          extraction: band(['RENATA'], [cell(1, 'RENATA', 'M'), cell(20, 'RENATA', 'NOTTE')]),
        },
      ],
      HEADER,
    )

    expect(extraction.cells).toHaveLength(1)
    expect(extraction.cells[0].day).toBe(1)
    expect(conflicts).toBe(1)
  })

  it('chiava le celle sul nome letto nell intestazione, non sull indice della colonna', () => {
    // Due bande con gli stessi indici geometrici ma nomi diversi: se la fusione
    // usasse spec.columns le celle si sovrascriverebbero a vicenda.
    const { extraction, conflicts } = mergeBandExtractions(
      [
        { spec: spec([1, 2], 1, 16), extraction: band(['RENATA'], [cell(1, 'RENATA', 'M')]) },
        { spec: spec([1, 2], 1, 16), extraction: band(['MERY'], [cell(1, 'MERY', 'P')]) },
      ],
      HEADER,
    )

    expect(conflicts).toBe(0)
    expect(extraction.columns).toEqual(['RENATA', 'MERY'])
    expect(extraction.cells.map((c) => `${c.day}:${c.column}:${c.code}`)).toEqual([
      '1:RENATA:M',
      '1:MERY:P',
    ])
  })

  it('columns è l unione ordinata dei nomi letti, senza duplicati', () => {
    const { extraction } = mergeBandExtractions(
      [
        { spec: spec([1, 2], 1, 16), extraction: band(['RENATA', 'MERY'], []) },
        { spec: spec([1, 2], 16, 31), extraction: band(['RENATA', 'MERY'], []) },
        { spec: spec([3], 1, 16), extraction: band(['ALEX'], []) },
      ],
      HEADER,
    )

    expect(extraction.columns).toEqual(['RENATA', 'MERY', 'ALEX'])
  })

  it('considera la stessa colonna anche se scritta con spazi o maiuscole diverse', () => {
    const { extraction, conflicts } = mergeBandExtractions(
      [
        { spec: spec([1], 1, 16), extraction: band(['ANNA LIA'], [cell(1, 'ANNA LIA', 'M')]) },
        { spec: spec([1], 16, 31), extraction: band(['Anna  Lia'], [cell(20, 'Anna  Lia', 'P')]) },
      ],
      HEADER,
    )

    expect(conflicts).toBe(0)
    expect(extraction.columns).toEqual(['ANNA LIA'])
    // il nome salvato è quello letto la prima volta, così la cella cita una
    // colonna dichiarata e la tabella non ha due colonne per la stessa persona
    expect(extraction.cells.map((c) => c.column)).toEqual(['ANNA LIA', 'ANNA LIA'])
  })

  it('scarta per nome le colonne di aiuto e di totale, senza contarle come conflitti', () => {
    const { extraction, conflicts } = mergeBandExtractions(
      [
        {
          spec: spec([9, 10], 1, 16),
          extraction: band(
            ['AIUTO MATT.', 'AIUTO POM.', 'TOT M', 'TOT P', 'RENATA'],
            [
              cell(1, 'AIUTO MATT.', '3'),
              cell(1, 'AIUTO POM.', '2'),
              cell(1, 'TOT M', '5'),
              cell(1, 'TOT P', '4'),
              cell(1, 'RENATA', 'M'),
            ],
          ),
        },
      ],
      HEADER,
    )

    expect(conflicts).toBe(0)
    expect(extraction.columns).toEqual(['RENATA'])
    expect(extraction.cells).toHaveLength(1)
  })

  it('scarta le colonne di servizio anche senza il punto finale o con altre maiuscole', () => {
    const { extraction } = mergeBandExtractions(
      [
        {
          spec: spec([9], 1, 16),
          extraction: band(['Aiuto matt', 'tot m'], [cell(1, 'Aiuto matt', '3')]),
        },
      ],
      HEADER,
    )

    expect(extraction.columns).toEqual([])
    expect(extraction.cells).toEqual([])
  })

  it('tiene una cella che cita una colonna non dichiarata, invece di perdere la banda', () => {
    const { extraction } = mergeBandExtractions(
      [{ spec: spec([1], 1, 16), extraction: band(['RENATA'], [cell(1, 'MERY', 'M')]) }],
      HEADER,
    )

    // ogni cella cita una colonna dichiarata: è l invariante che lo schema
    // dell estrazione completa pretende
    expect(extraction.columns).toContain('MERY')
    expect(extraction.cells).toHaveLength(1)
  })

  it('produce un estrazione che passa lo schema dell estrazione completa', async () => {
    const { extractionSchema } = await import('@/modules/extract/schema')
    const { extraction } = mergeBandExtractions(
      [
        {
          spec: spec([1, 2], 1, 16),
          extraction: band(
            ['RENATA', 'MERY'],
            [cell(1, 'RENATA', 'M'), cell(1, 'MERY', ''), cell(2, 'RENATA', 'NOTTE', 0.3, true)],
          ),
        },
        {
          spec: spec([1, 2], 16, 31),
          extraction: band(['RENATA', 'MERY'], [cell(31, 'MERY', 'P')]),
        },
      ],
      HEADER,
    )

    const parsed = extractionSchema.safeParse(extraction)
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('senza bande restituisce un estrazione vuota, non un errore', () => {
    const { extraction, conflicts } = mergeBandExtractions([], HEADER)
    expect(extraction.cells).toEqual([])
    expect(extraction.columns).toEqual([])
    expect(conflicts).toBe(0)
  })

  it('conserva confidenza e handCorrected della cella vincente', () => {
    const { extraction } = mergeBandExtractions(
      [
        {
          spec: spec([1], 1, 16),
          extraction: band(['RENATA'], [cell(3, 'RENATA', 'M', 0.31, true)]),
        },
      ],
      HEADER,
    )

    expect(extraction.cells[0].confidence).toBeCloseTo(0.31)
    expect(extraction.cells[0].handCorrected).toBe(true)
  })
})
