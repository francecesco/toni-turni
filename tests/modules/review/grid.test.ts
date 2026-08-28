import { describe, expect, it } from 'vitest'
import { buildColumnGrid, gridSummary, type ReviewCell } from '@/modules/review/grid'
import type { ShiftCodeDef } from '@/modules/codes/types'

const legenda: ShiftCodeDef[] = [
  {
    code: 'M',
    label: 'Mattino',
    kind: 'work',
    startTime: '07:00',
    endTime: '14:00',
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: false,
  },
  {
    code: 'NOTTE',
    label: 'Notte',
    kind: 'work',
    startTime: '21:00',
    endTime: '07:00',
    crossesMidnight: true,
    location: null,
    color: null,
    needsReview: false,
  },
  {
    code: 'RP',
    label: 'Riposo programmato',
    kind: 'info',
    startTime: null,
    endTime: null,
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: false,
  },
  {
    code: 'M+',
    label: 'Mattino prolungato',
    kind: 'work',
    startTime: '07:00',
    endTime: '14:00',
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: true,
  },
]

function cella(day: number, overrides: Partial<ReviewCell> = {}): ReviewCell {
  return {
    day,
    columnLabel: 'CRISTINA',
    rawCode: 'M',
    code: 'M',
    confidence: 0.99,
    handCorrected: false,
    conflicted: false,
    conflictWith: null,
    ...overrides,
  }
}

function griglia(cells: ReviewCell[], assignments: Parameters<typeof buildColumnGrid>[0]['assignments'] = []) {
  return buildColumnGrid({
    year: 2026,
    month: 8,
    columnLabel: 'CRISTINA',
    cells,
    codes: legenda,
    assignments,
  })
}

describe('buildColumnGrid — una riga per ogni giorno del mese, anche vuota', () => {
  it('produce 31 righe per agosto, con i giorni senza cella dichiarati vuoti', () => {
    const righe = griglia([cella(1)])

    expect(righe).toHaveLength(31)
    expect(righe[0].rawCode).toBe('M')
    expect(righe[1].rawCode).toBeNull()
    expect(righe[1].empty).toBe(true)
  })

  it('produce 28 righe per febbraio 2026, non 31', () => {
    const righe = buildColumnGrid({
      year: 2026,
      month: 2,
      columnLabel: 'CRISTINA',
      cells: [],
      codes: legenda,
      assignments: [],
    })

    expect(righe).toHaveLength(28)
  })

  it('la data ISO e il giorno della settimana non passano dal fuso locale', () => {
    const righe = griglia([])

    expect(righe[0].isoDate).toBe('2026-08-01')
    // 1 agosto 2026 è un sabato.
    expect(righe[0].weekday).toBe('sab')
    expect(righe[30].isoDate).toBe('2026-08-31')
  })

  it('tiene solo le celle della colonna richiesta', () => {
    const righe = griglia([cella(1), cella(2, { columnLabel: 'SARA' })])

    expect(righe[0].rawCode).toBe('M')
    expect(righe[1].rawCode).toBeNull()
  })
})

describe('buildColumnGrid — il codice risolto contro la legenda', () => {
  it('porta etichetta, tipo e orario del codice', () => {
    const righe = griglia([cella(1)])

    expect(righe[0].codeLabel).toBe('Mattino')
    expect(righe[0].kind).toBe('work')
    expect(righe[0].time).toBe('07:00–14:00')
  })

  it('dichiara che la notte finisce il giorno dopo', () => {
    const righe = griglia([cella(3, { rawCode: 'NOTTE', code: 'NOTTE' })])

    expect(righe[2].time).toBe('21:00–07:00 (+1 giorno)')
    expect(righe[2].crossesMidnight).toBe(true)
  })

  it('un codice tutto il giorno non inventa un orario', () => {
    const righe = griglia([cella(4, { rawCode: 'RP', code: 'RP' })])

    expect(righe[3].time).toBe('tutto il giorno')
  })

  it('un codice sconosciuto resta sconosciuto e non gli viene inventato un orario', () => {
    const righe = griglia([cella(5, { rawCode: 'RSF?', code: null })])

    expect(righe[4].unknownCode).toBe(true)
    expect(righe[4].time).toBeNull()
    expect(righe[4].codeLabel).toBeNull()
    expect(righe[4].confirmable).toBe(false)
  })

  it('un codice della legenda ancora da confermare è segnalato', () => {
    const righe = griglia([cella(6, { rawCode: 'M+', code: 'M+' })])

    expect(righe[5].needsReview).toBe(true)
    expect(righe[5].attention).toBe(true)
  })
})

describe('buildColumnGrid — cosa evidenziamo, e cosa no', () => {
  it('evidenzia le celle corrette a penna', () => {
    const righe = griglia([cella(1, { handCorrected: true })])

    expect(righe[0].attention).toBe(true)
    expect(righe[0].attentionReasons).toContain('correzione a penna')
  })

  it('evidenzia i conflitti fra due bande', () => {
    const righe = griglia([cella(1, { conflicted: true, conflictWith: 'P' })])

    expect(righe[0].attention).toBe(true)
    expect(righe[0].attentionReasons).toContain('letture discordanti: M o P')
  })

  it('NON evidenzia una cella per la confidenza bassa: la confidenza non distingue nulla', () => {
    // La misura reale: nessuna cella su 519 sotto 0,8 e entrambe le celle sbagliate
    // dichiarate con confidenza alta. Il rilevamento delle correzioni a penna invece
    // ha richiamo 100%. Evidenziare la confidenza sposterebbe l attenzione dove
    // l errore non è.
    const righe = griglia([cella(1, { confidence: 0.12 })])

    expect(righe[0].attention).toBe(false)
    expect(righe[0].attentionReasons).toEqual([])
    // Resta però leggibile: la confidenza si propaga fino alla UI, non si scarta.
    expect(righe[0].confidence).toBeCloseTo(0.12)
  })
})

describe('buildColumnGrid — lo stato della conferma', () => {
  it('una cella confermata con lo stesso codice risulta confermata e non da rileggere', () => {
    const righe = griglia([cella(1)], [{ day: 1, code: 'M', confirmedAt: new Date(), syncState: 'confirmed' }])

    expect(righe[0].confirmed).toBe(true)
    expect(righe[0].changedSinceConfirm).toBe(false)
    expect(righe[0].attention).toBe(false)
  })

  it('una cella confermata con un codice diverso da quello ora letto va riconfermata', () => {
    const righe = griglia(
      [cella(1, { rawCode: 'NOTTE', code: 'NOTTE' })],
      [{ day: 1, code: 'M', confirmedAt: new Date(), syncState: 'confirmed' }],
    )

    expect(righe[0].confirmed).toBe(true)
    expect(righe[0].changedSinceConfirm).toBe(true)
    expect(righe[0].attention).toBe(true)
    expect(righe[0].attentionReasons).toContain('cambiato dopo la conferma: era M')
  })

  it("un'assegnazione senza confirmedAt non conta come conferma", () => {
    const righe = griglia([cella(1)], [{ day: 1, code: 'M', confirmedAt: null, syncState: 'draft' }])

    expect(righe[0].confirmed).toBe(false)
  })

  it('dichiara quando un turno confermato è già finito sul calendario', () => {
    const righe = griglia(
      [cella(1)],
      [{ day: 1, code: 'M', confirmedAt: new Date(), syncState: 'synced' }],
    )

    expect(righe[0].synced).toBe(true)
  })
})

describe('buildColumnGrid — la correzione a mano, distinta dalla lettura dell AI', () => {
  it('il codice corretto a mano vince su quello letto, e la lettura resta visibile', () => {
    const righe = griglia([
      cella(8, { rawCode: 'H', code: null, correctedCode: 'M', correctedAt: new Date() }),
    ])

    expect(righe[7].code).toBe('M')
    expect(righe[7].codeLabel).toBe('Mattino')
    expect(righe[7].time).toBe('07:00–14:00')
    expect(righe[7].manuallyCorrected).toBe(true)
    expect(righe[7].correctedCode).toBe('M')
    // La provenienza non si perde: chi guarda deve sapere cosa è stato corretto.
    expect(righe[7].rawCode).toBe('H')
    expect(righe[7].confirmable).toBe(true)
  })

  it('una cella corretta a mano non è più "da rileggere": una persona l ha già letta', () => {
    const righe = griglia([
      cella(8, {
        rawCode: 'H',
        code: null,
        handCorrected: true,
        conflicted: true,
        conflictWith: 'P',
        correctedCode: 'M',
        correctedAt: new Date(),
      }),
    ])

    expect(righe[7].attention).toBe(false)
    expect(righe[7].attentionReasons).toEqual([])
    expect(righe[7].unknownCode).toBe(false)
    // `handCorrected` resta: è un dato letto dalla foto, non un giudizio.
    expect(righe[7].handCorrected).toBe(true)
  })

  it('una cella svuotata a mano non è un turno, e non è nemmeno un buco', () => {
    const righe = griglia([cella(8, { correctedCode: null, correctedAt: new Date() })])

    expect(righe[7].empty).toBe(true)
    expect(righe[7].code).toBeNull()
    expect(righe[7].confirmable).toBe(false)
    expect(righe[7].manuallyCorrected).toBe(true)
    // Dichiarata vuota da una persona: l allarme "giorno non letto" suonerebbe a vuoto.
    expect(righe[7].declaredEmpty).toBe(true)
    expect(gridSummary(righe).emptyDays).not.toContain(8)
  })

  it('un giorno che il modello non ha letto, corretto a mano, diventa un turno', () => {
    const righe = griglia([
      cella(15, { rawCode: '', code: null, confidence: 0, correctedCode: 'RP', correctedAt: new Date() }),
    ])

    expect(righe[14].empty).toBe(false)
    expect(righe[14].code).toBe('RP')
    expect(righe[14].confirmable).toBe(true)
    // Nessuna lettura del modello da mostrare: non gliene si attribuisce una.
    expect(righe[14].rawCode).toBeNull()
    expect(gridSummary(righe).emptyDays).not.toContain(15)
  })

  it('una cella corretta a mano e poi confermata con un altro codice va riconfermata', () => {
    const righe = griglia(
      [cella(9, { rawCode: 'M', code: 'M', correctedCode: 'P', correctedAt: new Date() })],
      [{ day: 9, code: 'M', confirmedAt: new Date(), syncState: 'synced' }],
    )

    expect(righe[8].changedSinceConfirm).toBe(true)
    expect(righe[8].attentionReasons.some((m) => m.includes('era M'))).toBe(true)
  })

  it('senza correzione i campi della correzione restano spenti', () => {
    const righe = griglia([cella(1)])

    expect(righe[0].manuallyCorrected).toBe(false)
    expect(righe[0].correctedCode).toBeNull()
    expect(righe[0].declaredEmpty).toBe(false)
  })
})

describe('gridSummary — il riassunto in testa alla griglia', () => {
  it('conta turni, conferme, celle da rileggere e codici sconosciuti', () => {
    const righe = griglia(
      [
        cella(1),
        cella(2, { handCorrected: true }),
        cella(3, { rawCode: '???', code: null }),
        cella(4, { conflicted: true, conflictWith: 'P' }),
      ],
      [{ day: 1, code: 'M', confirmedAt: new Date(), syncState: 'confirmed' }],
    )

    expect(gridSummary(righe)).toEqual({
      days: 31,
      shifts: 4,
      confirmed: 1,
      attention: 3,
      unknownCodes: 1,
      confirmable: 3,
      emptyDays: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
    })
  })

  it('elenca per giorno i buchi della colonna: è così che un turno mancante si vede', () => {
    const righe = griglia([cella(1), cella(3)])

    // Il buco si dichiara per giorni della propria colonna, non per indice di banda.
    expect(gridSummary(righe).emptyDays.slice(0, 3)).toEqual([2, 4, 5])
  })
})
