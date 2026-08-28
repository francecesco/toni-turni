import { describe, expect, it } from 'vitest'
import { columnCoverage, describeUnreadBands } from '@/modules/review/holes'

const aliases = [
  { label: 'CRISTINA', userId: 'u-cri', ignored: false },
  { label: 'TOT M', userId: null, ignored: true },
]

function cella(day: number, columnLabel: string, bandIndex: number | null) {
  return { day, columnLabel, bandIndex }
}

describe('columnCoverage — il buco si dichiara per colonna e per giorni, non per banda', () => {
  it('elenca per ogni colonna i giorni letti e quelli mancanti', () => {
    const copertura = columnCoverage({
      year: 2026,
      month: 2, // 28 giorni
      cells: Array.from({ length: 26 }, (_, i) => cella(i + 1, 'CRISTINA', 0)),
      aliases,
    })

    expect(copertura).toHaveLength(1)
    expect(copertura[0]).toMatchObject({
      columnLabel: 'CRISTINA',
      daysRead: 26,
      missingDays: [27, 28],
      ignored: false,
      bandIndexes: [0],
    })
  })

  it('una colonna letta per intero non ha giorni mancanti', () => {
    const copertura = columnCoverage({
      year: 2026,
      month: 4, // 30 giorni
      cells: Array.from({ length: 30 }, (_, i) => cella(i + 1, 'CRISTINA', 1)),
      aliases,
    })

    expect(copertura[0].missingDays).toEqual([])
  })

  it('marca come di servizio le colonne ignorate, così un buco lì non spaventa nessuno', () => {
    const copertura = columnCoverage({
      year: 2026,
      month: 8,
      cells: [cella(1, 'TOT M', 3), cella(1, 'AIUTO POM.', 4)],
      aliases,
    })

    const perLabel = new Map(copertura.map((c) => [c.columnLabel, c]))
    // TOT M è ignorata esplicitamente dalla referente.
    expect(perLabel.get('TOT M')?.ignored).toBe(true)
    // AIUTO POM. non è ancora stata associata, ma si riconosce dal nome.
    expect(perLabel.get('AIUTO POM.')?.ignored).toBe(true)
  })

  it('ordina le colonne per nome e tiene traccia di quali bande le hanno prodotte', () => {
    const copertura = columnCoverage({
      year: 2026,
      month: 8,
      cells: [cella(1, 'SARA DP.', 2), cella(1, 'CRISTINA', 0), cella(2, 'CRISTINA', 1)],
      aliases,
    })

    expect(copertura.map((c) => c.columnLabel)).toEqual(['CRISTINA', 'SARA DP.'])
    expect(copertura[0].bandIndexes).toEqual([0, 1])
  })

  it('non inventa colonne quando non è stata letta nessuna cella', () => {
    expect(columnCoverage({ year: 2026, month: 8, cells: [], aliases })).toEqual([])
  })
})

describe('describeUnreadBands — una banda non letta si racconta con i nomi che si conoscono', () => {
  const bande = [
    { index: 0, status: 'done', error: null },
    { index: 1, status: 'failed', error: 'JSON non valido' },
    { index: 2, status: 'done', error: null },
    { index: 3, status: 'pending', error: null },
  ]
  const celle = [
    cella(1, 'CRISTINA', 0),
    cella(1, 'MERY', 2),
    cella(2, 'MERY', 2),
  ]

  it('non dichiara nulla per le bande lette', () => {
    const report = describeUnreadBands({ bands: bande, cells: celle, aliases })

    expect(report.map((r) => r.index)).toEqual([1, 3])
  })

  it('quando i nomi non si conoscono lo dice onestamente, indicando fra quali colonne sta il buco', () => {
    const report = describeUnreadBands({ bands: bande, cells: celle, aliases })

    const prima = report.find((r) => r.index === 1)
    expect(prima?.knownColumns).toEqual([])
    expect(prima?.description).toBe(
      'un gruppo di colonne fra CRISTINA e MERY non è stato letto',
    )
  })

  it('una banda in coda, senza colonne lette a destra, si racconta come "dopo l ultima nota"', () => {
    const report = describeUnreadBands({ bands: bande, cells: celle, aliases })

    const ultima = report.find((r) => r.index === 3)
    expect(ultima?.description).toBe('un gruppo di colonne dopo MERY non è stato letto')
  })

  it('una banda in testa si racconta come "prima della prima nota"', () => {
    const report = describeUnreadBands({
      bands: [
        { index: 0, status: 'failed', error: 'illeggibile' },
        { index: 1, status: 'done', error: null },
      ],
      cells: [cella(1, 'CRISTINA', 1)],
      aliases,
    })

    expect(report[0].description).toBe('un gruppo di colonne prima di CRISTINA non è stato letto')
  })

  it('se non è stata letta nemmeno una colonna non finge di sapere dove sia il buco', () => {
    const report = describeUnreadBands({
      bands: [{ index: 0, status: 'failed', error: 'illeggibile' }],
      cells: [],
      aliases,
    })

    expect(report[0].description).toBe('nessuna colonna di questa parte della tabella è stata letta')
    expect(report[0].serviceOnly).toBe(false)
  })

  it('conserva il motivo del fallimento, per la referente', () => {
    const report = describeUnreadBands({ bands: bande, cells: celle, aliases })

    expect(report.find((r) => r.index === 1)?.error).toBe('JSON non valido')
    expect(report.find((r) => r.index === 3)?.status).toBe('pending')
  })

  it('quando le colonne della banda si conoscono e sono tutte di servizio, non è un buco nei turni di nessuno', () => {
    const report = describeUnreadBands({
      bands: [
        { index: 0, status: 'done', error: null },
        { index: 1, status: 'failed', error: 'illeggibile' },
      ],
      // La banda 1 aveva già prodotto delle celle in un giro precedente: sappiamo
      // che contiene solo colonne di servizio.
      cells: [cella(1, 'CRISTINA', 0), cella(1, 'TOT M', 1), cella(1, 'TOT P', 1)],
      aliases,
    })

    const buco = report.find((r) => r.index === 1)
    expect(buco?.knownColumns).toEqual(['TOT M', 'TOT P'])
    expect(buco?.serviceOnly).toBe(true)
    expect(buco?.description).toBe(
      'le colonne di servizio TOT M, TOT P non sono state lette: non sono turni di nessuno',
    )
  })

  it('una banda di cui si conoscono le colonne di persona le nomina', () => {
    const report = describeUnreadBands({
      bands: [{ index: 0, status: 'failed', error: 'illeggibile' }],
      cells: [cella(1, 'CRISTINA', 0)],
      aliases,
    })

    expect(report[0].description).toBe('le colonne CRISTINA non sono state lette')
    expect(report[0].serviceOnly).toBe(false)
  })
})
