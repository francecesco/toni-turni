import { describe, expect, it } from 'vitest'
import { DEFAULT_SHIFT_CODES } from '@/modules/codes/defaults'
import { matchCode } from '@/modules/codes/normalize'
import { toCalendarSlot } from '@/modules/codes/slot'
import { ROME_TZ } from '@/lib/time'

function slotFor(code: string, isoDate: string) {
  const def = matchCode(code, DEFAULT_SHIFT_CODES)
  if (!def) throw new Error(`codice non trovato nei default: ${code}`)
  return toCalendarSlot(def, isoDate)
}

describe('toCalendarSlot', () => {
  it('il mattino è 07:00-14:00 nello stesso giorno', () => {
    expect(slotFor('M', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T07:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-03T14:00:00', timeZone: ROME_TZ },
    })
  })

  it('il pomeriggio è 14:00-21:00', () => {
    expect(slotFor('P', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T14:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-03T21:00:00', timeZone: ROME_TZ },
    })
  })

  it('la giornata lunga M/P è un unico evento 07:00-21:00', () => {
    expect(slotFor('M/P', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T07:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-03T21:00:00', timeZone: ROME_TZ },
    })
  })

  it('la notte finisce il giorno dopo', () => {
    expect(slotFor('NOTTE', '2026-08-03')).toEqual({
      type: 'timed',
      start: { dateTime: '2026-08-03T21:00:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-04T07:00:00', timeZone: ROME_TZ },
    })
  })

  it('la notte dell ultimo giorno del mese finisce nel mese dopo', () => {
    const slot = slotFor('NOTTE', '2026-08-31')
    if (slot.type !== 'timed') throw new Error('atteso uno slot timed')
    expect(slot.end).toEqual({
      dateTime: '2026-09-01T07:00:00',
      timeZone: ROME_TZ,
    })
  })

  it('riposo e smonto notte sono eventi tutto il giorno', () => {
    for (const code of ['RP', 'RIP', 'SN']) {
      expect(slotFor(code, '2026-08-03')).toEqual({
        type: 'allDay',
        start: { date: '2026-08-03' },
        end: { date: '2026-08-04' },
      })
    }
  })

  it('ferie e assenza sono eventi tutto il giorno', () => {
    for (const code of ['F', 'ASS']) {
      expect(slotFor(code, '2026-08-03').type).toBe('allDay')
    }
  })

  it('un codice di tipo unknown non produce nessun evento', () => {
    expect(
      toCalendarSlot(
        {
          code: '???',
          label: 'Da definire',
          kind: 'unknown',
          startTime: null,
          endTime: null,
          crossesMidnight: false,
          location: null,
          color: null,
          needsReview: true,
        },
        '2026-08-03',
      ),
    ).toEqual({ type: 'none' })
  })

  it('i turni sugli altri piani mantengono gli orari e riportano la sede', () => {
    const def = matchCode('M1°P', DEFAULT_SHIFT_CODES)
    expect(def?.location).toBe('1° Piano')
    expect(slotFor('M1°P', '2026-08-03').type).toBe('timed')
  })
})

describe('DEFAULT_SHIFT_CODES', () => {
  it('copre tutti i codici visti nelle tabelle di esempio', () => {
    const expected = [
      'M', 'P', 'M/P', 'NOTTE', 'SN', 'RP', 'RIP', 'F', 'ASS',
      'M+', 'P+', 'M RSF', 'P RSF',
      'M1°P', 'M2°P', 'M4°P', 'P1°P', 'P2°P', 'P4°P',
    ]
    for (const code of expected) {
      expect(matchCode(code, DEFAULT_SHIFT_CODES), `manca il codice ${code}`).not.toBeNull()
    }
  })

  it('marca needsReview i codici il cui significato non è confermato', () => {
    for (const code of ['M+', 'P+', 'M RSF', 'P RSF']) {
      expect(matchCode(code, DEFAULT_SHIFT_CODES)?.needsReview, code).toBe(true)
    }
  })

  it('non marca needsReview i codici certi', () => {
    for (const code of ['M', 'P', 'NOTTE', 'RP', 'F']) {
      expect(matchCode(code, DEFAULT_SHIFT_CODES)?.needsReview, code).toBe(false)
    }
  })
})
