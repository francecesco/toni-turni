import { describe, expect, it } from 'vitest'
import { describeOutcome } from '@/modules/calendar/report'
import type { SyncOutcome } from '@/modules/calendar/types'

function esito(over: Partial<SyncOutcome> = {}): SyncOutcome {
  return {
    ok: true,
    calendarId: 'cal1',
    created: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    skipped: [],
    failures: [],
    foreignEvents: 0,
    outOfWindowEvents: 0,
    protectedEvents: 0,
    ...over,
  }
}

describe('describeOutcome', () => {
  it('riassume i conteggi in una riga leggibile', () => {
    const testo = describeOutcome(esito({ created: 12, updated: 2, deleted: 1, unchanged: 15 }))
    expect(testo.split('\n')[0]).toBe('Creati 12, aggiornati 2, cancellati 1, invariati 15.')
  })

  it('elenca i turni saltati raggruppati per motivo, con i giorni', () => {
    const testo = describeOutcome(
      esito({
        skipped: [
          { date: '2026-08-03', code: 'M', reason: 'non_confermato' },
          { date: '2026-08-04', code: 'P', reason: 'non_confermato' },
          { date: '2026-08-12', code: 'ZZZ', reason: 'codice_sconosciuto' },
        ],
      }),
    )

    expect(testo).toContain(
      'Saltati 3 turni: 2 non confermati (03/08, 04/08), 1 con codice sconosciuto (12/08).',
    )
  })

  it('dice quanti eventi non nostri sono stati lasciati intatti', () => {
    const testo = describeOutcome(esito({ foreignEvents: 5 }))
    expect(testo).toContain('Eventi non creati dall app, lasciati intatti: 5.')
  })

  it('dice quanti eventi sono stati conservati perché il turno è da chiarire', () => {
    const testo = describeOutcome(esito({ protectedEvents: 2 }))
    expect(testo).toContain('Eventi conservati perché il turno del giorno è da chiarire: 2.')
  })

  it('non nomina ciò che non è accaduto', () => {
    const testo = describeOutcome(esito({ created: 1 }))
    expect(testo).not.toContain('Saltati')
    expect(testo).not.toContain('lasciati intatti')
    expect(testo).not.toContain('Non riusciti')
  })

  it('elenca le operazioni non riuscite', () => {
    const testo = describeOutcome(
      esito({
        ok: false,
        failures: [{ shiftKey: 'utente1:2026-08-05', action: 'create', message: 'quota superata' }],
      }),
    )

    expect(testo).toContain('Non riusciti 1: 05/08 create — quota superata.')
  })

  it('quando il sync non è partito lo dice e basta', () => {
    const testo = describeOutcome(esito({ ok: false, error: 'token da rinnovare' }))
    expect(testo).toBe('Sync non eseguito: token da rinnovare.')
  })
})
