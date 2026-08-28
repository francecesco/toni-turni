import { describe, expect, it } from 'vitest'
import { buildDesiredEvents } from '@/modules/calendar/event'
import type { AssignmentRecord } from '@/modules/calendar/types'
import type { ShiftCodeDef } from '@/modules/codes/types'
import { hoursBetween, ROME_TZ, wallClockToUtc } from '@/lib/time'

function def(code: string, extra: Partial<ShiftCodeDef> = {}): ShiftCodeDef {
  return {
    code,
    label: code,
    kind: 'work',
    startTime: '07:00',
    endTime: '14:00',
    crossesMidnight: false,
    location: null,
    color: null,
    needsReview: false,
    ...extra,
  }
}

const LEGENDA: ShiftCodeDef[] = [
  def('M', { label: 'Mattino' }),
  def('P', { label: 'Pomeriggio', startTime: '14:00', endTime: '21:00' }),
  def('M/P', { label: 'Giornata lunga', startTime: '07:00', endTime: '21:00' }),
  def('NOTTE', { label: 'Notte', startTime: '21:00', endTime: '07:00', crossesMidnight: true }),
  def('SN', { label: 'Smonto notte', kind: 'info', startTime: null, endTime: null }),
  def('RIP', { label: 'Riposo', kind: 'info', startTime: null, endTime: null }),
  def('F', { label: 'Ferie', kind: 'absence', startTime: null, endTime: null }),
  def('M1°P', { label: 'Mattino 1° piano', location: '1° Piano' }),
  def('X', { label: 'Da chiarire', kind: 'unknown', startTime: null, endTime: null }),
]

function shift(over: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    id: 'a1',
    date: '2026-08-10',
    code: 'M',
    confirmed: true,
    eventId: null,
    ...over,
  }
}

function build(shifts: AssignmentRecord[], window?: { from: string; to: string }) {
  return buildDesiredEvents({ userId: 'utente1', shifts, codes: LEGENDA, window })
}

describe('buildDesiredEvents — la notte attraversa la mezzanotte', () => {
  it('mette la fine della notte alle 07:00 del giorno successivo', () => {
    const { desired } = build([shift({ code: 'NOTTE', date: '2026-08-10' })])

    expect(desired).toHaveLength(1)
    expect(desired[0].payload.start).toEqual({
      dateTime: '2026-08-10T21:00:00',
      timeZone: ROME_TZ,
    })
    expect(desired[0].payload.end).toEqual({
      dateTime: '2026-08-11T07:00:00',
      timeZone: ROME_TZ,
    })
  })

  it('la notte del cambio ora legale di ottobre dura 11 ore reali', () => {
    // Ultima domenica di ottobre 2026: il 25 alle 03:00 si torna alle 02:00.
    const { desired } = build([shift({ code: 'NOTTE', date: '2026-10-24' })])
    const start = desired[0].payload.start
    const end = desired[0].payload.end
    if (!('dateTime' in start) || !('dateTime' in end)) throw new Error('atteso evento con orario')

    const inizio = wallClockToUtc(start.dateTime, ROME_TZ)
    const fine = wallClockToUtc(end.dateTime, ROME_TZ)
    expect(hoursBetween(inizio, fine)).toBe(11)
  })

  it('la notte del cambio ora legale di marzo dura 9 ore reali', () => {
    // Ultima domenica di marzo 2026: il 29 alle 02:00 si passa alle 03:00.
    const { desired } = build([shift({ code: 'NOTTE', date: '2026-03-28' })])
    const start = desired[0].payload.start
    const end = desired[0].payload.end
    if (!('dateTime' in start) || !('dateTime' in end)) throw new Error('atteso evento con orario')

    expect(hoursBetween(wallClockToUtc(start.dateTime, ROME_TZ), wallClockToUtc(end.dateTime, ROME_TZ))).toBe(9)
  })

  it('non usa offset fissi: l orario resta locale con il fuso dichiarato', () => {
    const { desired } = build([shift({ code: 'M', date: '2026-01-15' })])
    const start = desired[0].payload.start
    if (!('dateTime' in start)) throw new Error('atteso evento con orario')

    expect(start.dateTime).not.toMatch(/[+Z]/)
    expect(start.timeZone).toBe('Europe/Rome')
  })
})

describe('buildDesiredEvents — forme dell evento', () => {
  it('M/P è una giornata lunga: un solo evento 07:00 → 21:00', () => {
    const { desired } = build([shift({ code: 'M/P' })])

    expect(desired).toHaveLength(1)
    expect(desired[0].payload.start).toEqual({ dateTime: '2026-08-10T07:00:00', timeZone: ROME_TZ })
    expect(desired[0].payload.end).toEqual({ dateTime: '2026-08-10T21:00:00', timeZone: ROME_TZ })
  })

  it('SN, RIP e F sono eventi tutto il giorno, con fine esclusiva al giorno dopo', () => {
    const { desired } = build([
      shift({ id: 'a1', code: 'SN', date: '2026-08-10' }),
      shift({ id: 'a2', code: 'RIP', date: '2026-08-11' }),
      shift({ id: 'a3', code: 'F', date: '2026-08-12' }),
    ])

    expect(desired.map((d) => d.payload.start)).toEqual([
      { date: '2026-08-10' },
      { date: '2026-08-11' },
      { date: '2026-08-12' },
    ])
    expect(desired.map((d) => d.payload.end)).toEqual([
      { date: '2026-08-11' },
      { date: '2026-08-12' },
      { date: '2026-08-13' },
    ])
  })

  it('i turni di lavoro occupano il tempo, gli informativi e le assenze no', () => {
    const { desired } = build([
      shift({ id: 'a1', code: 'M', date: '2026-08-10' }),
      shift({ id: 'a2', code: 'RIP', date: '2026-08-11' }),
      shift({ id: 'a3', code: 'F', date: '2026-08-12' }),
    ])

    expect(desired.map((d) => d.payload.transparency)).toEqual([
      'opaque',
      'transparent',
      'transparent',
    ])
  })

  it('il titolo mostra etichetta e codice, senza ripetersi quando coincidono', () => {
    const { desired } = build([
      shift({ id: 'a1', code: 'M', date: '2026-08-10' }),
      shift({ id: 'a2', code: 'NOTTE', date: '2026-08-11' }),
    ])

    expect(desired[0].payload.summary).toBe('Mattino (M)')
    expect(desired[1].payload.summary).toBe('Notte')
  })

  it('riporta il luogo quando la legenda lo indica', () => {
    const { desired } = build([shift({ code: 'M1°P' })])
    expect(desired[0].payload.location).toBe('1° Piano')
  })

  it('marca ogni evento con shiftKey e codice nelle proprietà private', () => {
    const { desired } = build([shift({ code: 'M', date: '2026-08-10' })])

    expect(desired[0].shiftKey).toBe('utente1:2026-08-10')
    expect(desired[0].payload.extendedProperties.private).toEqual({
      shiftKey: 'utente1:2026-08-10',
      code: 'M',
    })
  })

  it('riconosce il codice anche scritto in minuscolo o con spazi', () => {
    const { desired } = build([shift({ code: ' m/p ' })])
    expect(desired[0].payload.extendedProperties.private.code).toBe('M/P')
  })

  it('ordina per data, così il piano di sync è deterministico', () => {
    const { desired } = build([
      shift({ id: 'a1', date: '2026-08-12' }),
      shift({ id: 'a2', date: '2026-08-02' }),
    ])
    expect(desired.map((d) => d.date)).toEqual(['2026-08-02', '2026-08-12'])
  })
})

describe('buildDesiredEvents — che cosa non si sincronizza', () => {
  it('un turno non confermato non produce eventi', () => {
    const { desired, skipped } = build([shift({ confirmed: false })])

    expect(desired).toEqual([])
    expect(skipped).toEqual([{ date: '2026-08-10', code: 'M', reason: 'non_confermato' }])
  })

  it('un codice che la legenda non conosce viene saltato senza bloccare gli altri', () => {
    const { desired, skipped } = build([
      shift({ id: 'a1', code: 'ZZZ', date: '2026-08-10' }),
      shift({ id: 'a2', code: 'M', date: '2026-08-11' }),
    ])

    expect(desired.map((d) => d.date)).toEqual(['2026-08-11'])
    expect(skipped).toEqual([{ date: '2026-08-10', code: 'ZZZ', reason: 'codice_sconosciuto' }])
  })

  it('un codice presente in legenda ma di tipo unknown viene saltato', () => {
    const { desired, skipped } = build([shift({ code: 'X' })])

    expect(desired).toEqual([])
    expect(skipped[0].reason).toBe('codice_sconosciuto')
  })

  it('protegge le chiavi dei turni saltati: non vanno cancellate dal calendario', () => {
    const { protectedKeys } = build([
      shift({ id: 'a1', code: 'M', date: '2026-08-10', confirmed: false }),
      shift({ id: 'a2', code: 'ZZZ', date: '2026-08-11' }),
      shift({ id: 'a3', code: 'M', date: '2026-08-12' }),
    ])

    expect(protectedKeys.sort()).toEqual(['utente1:2026-08-10', 'utente1:2026-08-11'])
  })

  it('salta una data inesistente invece di costruire un evento sbagliato', () => {
    const { desired, skipped } = build([shift({ date: '2026-09-31' })])

    expect(desired).toEqual([])
    expect(skipped).toEqual([{ date: '2026-09-31', code: 'M', reason: 'data_non_valida' }])
  })

  it('salta le date fuori dalla finestra sincronizzata', () => {
    const { desired, skipped } = build(
      [
        shift({ id: 'a1', date: '2026-07-31' }),
        shift({ id: 'a2', date: '2026-08-10' }),
        shift({ id: 'a3', date: '2026-09-01' }),
      ],
      { from: '2026-08-01', to: '2026-08-31' },
    )

    expect(desired.map((d) => d.date)).toEqual(['2026-08-10'])
    expect(skipped.map((s) => s.reason)).toEqual(['fuori_intervallo', 'fuori_intervallo'])
  })

  it('a parità di giorno tiene il primo turno e salta il duplicato', () => {
    const { desired, skipped } = build([
      shift({ id: 'a1', code: 'M', date: '2026-08-10' }),
      shift({ id: 'a2', code: 'P', date: '2026-08-10' }),
    ])

    expect(desired).toHaveLength(1)
    expect(desired[0].assignmentId).toBe('a1')
    expect(skipped).toEqual([{ date: '2026-08-10', code: 'P', reason: 'giorno_duplicato' }])
  })

  it('un codice vuoto non è un turno: viene saltato', () => {
    const { desired, skipped } = build([shift({ code: '  ' })])

    expect(desired).toEqual([])
    expect(skipped[0].reason).toBe('codice_sconosciuto')
  })
})
