import { describe, expect, it } from 'vitest'
import { parseShiftCodeForm } from '@/modules/codes/form'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

describe('parseShiftCodeForm', () => {
  it('accetta un turno con orari validi', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00', endTime: '14:00' }),
    )
    expect(result).toEqual({
      ok: true,
      value: {
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
    })
  })

  it('deduce crossesMidnight quando la fine precede l inizio', () => {
    const result = parseShiftCodeForm(
      form({ code: 'NOTTE', label: 'Notte', kind: 'work', startTime: '21:00', endTime: '07:00' }),
    )
    expect(result.ok && result.value.crossesMidnight).toBe(true)
  })

  it('accetta un turno tutto il giorno senza orari', () => {
    const result = parseShiftCodeForm(form({ code: 'RP', label: 'Riposo', kind: 'info' }))
    expect(result.ok && result.value.startTime).toBeNull()
  })

  it('rifiuta un codice vuoto', () => {
    const result = parseShiftCodeForm(form({ code: '  ', label: 'X', kind: 'work' }))
    expect(result).toEqual({ ok: false, errors: ['Il codice è obbligatorio'] })
  })

  it('rifiuta un orario malformato', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M', label: 'Mattino', kind: 'work', startTime: '7', endTime: '14:00' }),
    )
    expect(result.ok).toBe(false)
  })

  it('rifiuta un turno di lavoro con un solo orario', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M', label: 'Mattino', kind: 'work', startTime: '07:00' }),
    )
    expect(result).toEqual({
      ok: false,
      errors: ['Indica entrambi gli orari, o nessuno per un evento tutto il giorno'],
    })
  })

  it('rifiuta un tipo non previsto', () => {
    const result = parseShiftCodeForm(form({ code: 'M', label: 'Mattino', kind: 'inventato' }))
    expect(result.ok).toBe(false)
  })

  it('azzera needsReview quando la referente salva il codice', () => {
    const result = parseShiftCodeForm(
      form({ code: 'M+', label: 'Mattino lungo', kind: 'work', startTime: '07:00', endTime: '15:00' }),
    )
    expect(result.ok && result.value.needsReview).toBe(false)
  })
})
