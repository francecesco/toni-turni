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

function griglia(
  cells: ReviewCell[],
  assignments: Parameters<typeof buildColumnGrid>[0]['assignments'] = [],
  changes: Parameters<typeof buildColumnGrid>[0]['changes'] = [],
  sheetFullyRead?: boolean,
) {
  return buildColumnGrid({
    year: 2026,
    month: 8,
    columnLabel: 'CRISTINA',
    cells,
    codes: legenda,
    assignments,
    changes,
    sheetFullyRead,
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

  it('dichiara quando l ultimo invio di un turno non e riuscito', () => {
    const righe = griglia(
      [cella(1)],
      [{ day: 1, code: 'M', confirmedAt: new Date(), syncState: 'failed' }],
    )

    expect(righe[0].syncFailed).toBe(true)
    expect(righe[0].synced).toBe(false)
  })

  it('un turno riconfermato dopo l invio non risulta piu sul calendario: va rimandato', () => {
    // La riconferma riporta syncState a "confirmed" (vedi confirm.ts): l evento su
    // Google c e ancora, ma puo non corrispondere piu. Dire «gia sul calendario»
    // qui sarebbe una bugia rassicurante.
    const righe = griglia(
      [cella(1)],
      [{ day: 1, code: 'M', confirmedAt: new Date(), syncState: 'confirmed' }],
    )

    expect(righe[0].synced).toBe(false)
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
      synced: 0,
      syncFailed: 0,
      attention: 3,
      unknownCodes: 1,
      confirmable: 3,
      changed: 0,
      emptyDays: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
    })
  })

  it('conta quanti turni confermati sono sul calendario e quanti invii sono falliti', () => {
    const righe = griglia(
      [cella(1), cella(2), cella(3)],
      [
        { day: 1, code: 'M', confirmedAt: new Date(), syncState: 'synced' },
        { day: 2, code: 'M', confirmedAt: new Date(), syncState: 'confirmed' },
        { day: 3, code: 'M', confirmedAt: new Date(), syncState: 'failed' },
      ],
    )

    const riassunto = gridSummary(righe)
    expect(riassunto.confirmed).toBe(3)
    expect(riassunto.synced).toBe(1)
    expect(riassunto.syncFailed).toBe(1)
  })

  it('elenca per giorno i buchi della colonna: è così che un turno mancante si vede', () => {
    const righe = griglia([cella(1), cella(3)])

    // Il buco si dichiara per giorni della propria colonna, non per indice di banda.
    expect(gridSummary(righe).emptyDays.slice(0, 3)).toEqual([2, 4, 5])
  })
})

// Nota: `griglia` fissa la colonna a 'CRISTINA' (vedi l helper qui sopra), quindi il
// cambio di riferimento usa la stessa colonna — non 'RENATA' come nella bozza del
// task, che altrimenti non avrebbe mai trovato corrispondenza col filtro per colonna.
const cambio = (day: number, kind: 'changed' | 'added' | 'removed', before: string | null, after: string | null) => ({
  columnLabel: 'CRISTINA',
  columnKey: 'CRISTINA',
  day,
  kind,
  before,
  after,
})

describe('buildColumnGrid — cosa è cambiato rispetto alla foto precedente', () => {
  it('senza diff nessuna riga è cambiata e il riassunto conta zero', () => {
    const righe = griglia([cella(1)])
    expect(righe[0].changed).toBeNull()
    expect(righe[0].previousCode).toBeNull()
    expect(gridSummary(righe).changed).toBe(0)
  })

  it('una riga del diff porta il tipo di cambiamento e il codice di prima', () => {
    const righe = griglia([cella(5, { rawCode: 'P', code: 'P' })], [], [cambio(5, 'changed', 'M', 'P')])
    expect(righe[4].changed).toBe('changed')
    expect(righe[4].previousCode).toBe('M')
    expect(righe[4].attention).toBe(true)
    expect(righe[4].attentionReasons).toContain('cambiato rispetto alla foto precedente: era M')
    expect(gridSummary(righe).changed).toBe(1)
  })

  it('un giorno nuovo lo dice', () => {
    const righe = griglia([cella(12)], [], [cambio(12, 'added', null, 'M')])
    expect(righe[11].changed).toBe('added')
    expect(righe[11].attentionReasons).toContain('nuovo rispetto alla foto precedente')
  })

  it('un giorno tolto con un assegnazione ancora viva è orfano: il foglio nuovo non ha più il turno', () => {
    const righe = griglia(
      [],
      [{ day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' }],
      [cambio(20, 'removed', 'M', null)],
    )
    expect(righe[19].empty).toBe(true)
    expect(righe[19].orphanAssignment).toBe(true)
    expect(righe[19].changed).toBe('removed')
    expect(righe[19].attentionReasons).toContain('il foglio nuovo non ha più questo turno')
  })

  it('un assegnazione su una riga vuota è orfana anche senza diff (prima versione, cella svuotata)', () => {
    const righe = griglia([], [{ day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' }])
    expect(righe[19].orphanAssignment).toBe(true)
  })

  it('ignora i cambiamenti di altre colonne', () => {
    const righe = griglia([cella(5)], [], [{ ...cambio(5, 'changed', 'M', 'P'), columnLabel: 'MERY', columnKey: 'MERY' }])
    expect(righe[4].changed).toBeNull()
  })
})

describe('buildColumnGrid — un giorno non letto non è un turno tolto dal foglio', () => {
  it('con la foto letta per intero e il diff che dice «tolto» un orfano è certo', () => {
    const righe = griglia(
      [],
      [{ day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' }],
      [cambio(20, 'removed', 'M', null)],
    )
    expect(righe[19].orphanAssignment).toBe(true)
    expect(righe[19].orphanCertain).toBe(true)
    expect(righe[19].attentionReasons).toContain('il foglio nuovo non ha più questo turno')
  })

  it('con una lettura parziale (sheetFullyRead: false) lo stesso orfano non è certo', () => {
    const righe = griglia(
      [],
      [{ day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' }],
      [cambio(20, 'removed', 'M', null)],
      false,
    )
    expect(righe[19].orphanAssignment).toBe(true)
    expect(righe[19].orphanCertain).toBe(false)
    expect(righe[19].attentionReasons).not.toContain('il foglio nuovo non ha più questo turno')
    expect(righe[19].attentionReasons).toContain('il turno confermato non risulta più letto: resta com’è')
  })

  it('senza diff (prima versione) un orfano non è certo: non c è un «foglio nuovo» da confrontare', () => {
    // Una cella svuotata a mano sulla prima versione lascia l assegnazione su una
    // riga vuota, ma nessuna foto precedente dice che il turno c era: dichiarare
    // «il foglio nuovo non ha più questo turno» sarebbe una notizia inventata.
    const righe = griglia([], [{ day: 20, code: 'M', confirmedAt: new Date(), syncState: 'synced' }])
    expect(righe[19].orphanAssignment).toBe(true)
    expect(righe[19].orphanCertain).toBe(false)
    expect(righe[19].attentionReasons).toContain('il turno confermato non risulta più letto: resta com’è')
  })

  it('una bozza su una riga vuota non è un orfana: il sync la protegge già', () => {
    // Senza `confirmedAt` non c è niente sul calendario da togliere, e offrire
    // «Togli dal calendario» su una bozza chiederebbe di rimediare a un guasto che
    // non c è (regola invariante 1: il sync non scrive senza conferma).
    const righe = griglia(
      [],
      [{ day: 20, code: 'M', confirmedAt: null, syncState: 'draft' }],
      [cambio(20, 'removed', 'M', null)],
    )
    expect(righe[19].empty).toBe(true)
    expect(righe[19].orphanAssignment).toBe(false)
    expect(righe[19].orphanCertain).toBe(false)
  })
})
