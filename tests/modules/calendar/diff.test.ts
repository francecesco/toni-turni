import { describe, expect, it } from 'vitest'
import { planSync } from '@/modules/calendar/diff'
import type { DesiredEvent, ExistingEvent } from '@/modules/calendar/types'
import { ROME_TZ } from '@/lib/time'

const WINDOW = { from: '2026-08-01', to: '2026-08-31' }

function desiderato(over: Partial<DesiredEvent> = {}): DesiredEvent {
  const date = over.date ?? '2026-08-10'
  const shiftKey = over.shiftKey ?? `utente1:${date}`
  return {
    shiftKey,
    date,
    code: 'M',
    assignmentId: 'a1',
    payload: {
      summary: 'Mattino (M)',
      description: 'Turno dalla tabella del reparto, sincronizzato da Toni Turni.',
      transparency: 'opaque',
      start: { dateTime: `${date}T07:00:00`, timeZone: ROME_TZ },
      end: { dateTime: `${date}T14:00:00`, timeZone: ROME_TZ },
      extendedProperties: { private: { shiftKey, code: 'M' } },
    },
    ...over,
  }
}

/** L evento come Google lo restituirebbe dopo che l abbiamo creato noi. */
function comeSuGoogle(d: DesiredEvent, id = 'ev1', over: Partial<ExistingEvent> = {}): ExistingEvent {
  const start = 'dateTime' in d.payload.start
    ? { dateTime: `${d.payload.start.dateTime}+02:00`, timeZone: ROME_TZ }
    : { date: d.payload.start.date }
  const end = 'dateTime' in d.payload.end
    ? { dateTime: `${d.payload.end.dateTime}+02:00`, timeZone: ROME_TZ }
    : { date: d.payload.end.date }

  return {
    id,
    status: 'confirmed',
    summary: d.payload.summary,
    description: d.payload.description,
    location: d.payload.location ?? null,
    transparency: d.payload.transparency,
    start,
    end,
    extendedProperties: { private: { ...d.payload.extendedProperties.private } },
    ...over,
  }
}

function piano(input: {
  desired?: DesiredEvent[]
  existing?: ExistingEvent[]
  protectedKeys?: string[]
}) {
  return planSync({
    userId: 'utente1',
    window: WINDOW,
    desired: input.desired ?? [],
    skipped: [],
    protectedKeys: input.protectedKeys ?? [],
    existing: input.existing ?? [],
  })
}

describe('planSync — idempotenza', () => {
  it('un turno identico non produce nessuna chiamata di modifica', () => {
    const d = desiderato()
    const plan = piano({ desired: [d], existing: [comeSuGoogle(d)] })

    expect(plan.steps).toEqual([
      { action: 'keep', shiftKey: d.shiftKey, date: d.date, assignmentId: 'a1', eventId: 'ev1' },
    ])
  })

  it('la notte del cambio ora legale resta identica al secondo giro', () => {
    // Fine ottobre: inizio con offset +02:00, fine con +01:00. Confrontando le
    // stringhe si vedrebbe una differenza inesistente e si aggiornerebbe ogni volta.
    const d = desiderato({
      date: '2026-10-24',
      shiftKey: 'utente1:2026-10-24',
      code: 'NOTTE',
      payload: {
        summary: 'Notte',
        description: 'Turno dalla tabella del reparto, sincronizzato da Toni Turni.',
        transparency: 'opaque',
        start: { dateTime: '2026-10-24T21:00:00', timeZone: ROME_TZ },
        end: { dateTime: '2026-10-25T07:00:00', timeZone: ROME_TZ },
        extendedProperties: { private: { shiftKey: 'utente1:2026-10-24', code: 'NOTTE' } },
      },
    })

    const plan = planSync({
      userId: 'utente1',
      window: { from: '2026-10-01', to: '2026-10-31' },
      desired: [d],
      skipped: [],
      protectedKeys: [],
      existing: [
        {
          id: 'ev1',
          summary: 'Notte',
          description: 'Turno dalla tabella del reparto, sincronizzato da Toni Turni.',
          transparency: 'opaque',
          start: { dateTime: '2026-10-24T21:00:00+02:00', timeZone: ROME_TZ },
          end: { dateTime: '2026-10-25T07:00:00+01:00', timeZone: ROME_TZ },
          extendedProperties: { private: { shiftKey: 'utente1:2026-10-24', code: 'NOTTE' } },
        },
      ],
    })

    expect(plan.steps.map((s) => s.action)).toEqual(['keep'])
  })

  it('lo stesso orario espresso in un altro fuso non è una differenza', () => {
    const d = desiderato()
    const plan = piano({
      desired: [d],
      existing: [
        comeSuGoogle(d, 'ev1', {
          start: { dateTime: '2026-08-10T05:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-08-10T12:00:00Z', timeZone: 'UTC' },
        }),
      ],
    })

    expect(plan.steps.map((s) => s.action)).toEqual(['keep'])
  })

  it('un evento tutto il giorno identico non viene aggiornato', () => {
    const d = desiderato({
      code: 'RIP',
      payload: {
        summary: 'Riposo (RIP)',
        description: 'Turno dalla tabella del reparto, sincronizzato da Toni Turni.',
        transparency: 'transparent',
        start: { date: '2026-08-10' },
        end: { date: '2026-08-11' },
        extendedProperties: { private: { shiftKey: 'utente1:2026-08-10', code: 'RIP' } },
      },
    })

    const plan = piano({ desired: [d], existing: [comeSuGoogle(d)] })
    expect(plan.steps.map((s) => s.action)).toEqual(['keep'])
  })
})

describe('planSync — creazioni, aggiornamenti, cancellazioni', () => {
  it('crea l evento che manca', () => {
    const d = desiderato()
    const plan = piano({ desired: [d] })

    expect(plan.steps).toEqual([
      { action: 'create', shiftKey: d.shiftKey, date: d.date, assignmentId: 'a1', payload: d.payload },
    ])
  })

  it('aggiorna quando il codice del turno è cambiato', () => {
    const d = desiderato()
    const vecchio = comeSuGoogle(d, 'ev1', {
      summary: 'Pomeriggio (P)',
      start: { dateTime: '2026-08-10T14:00:00+02:00', timeZone: ROME_TZ },
      end: { dateTime: '2026-08-10T21:00:00+02:00', timeZone: ROME_TZ },
      extendedProperties: { private: { shiftKey: d.shiftKey, code: 'P' } },
    })

    const plan = piano({ desired: [d], existing: [vecchio] })
    expect(plan.steps).toEqual([
      {
        action: 'update',
        shiftKey: d.shiftKey,
        date: d.date,
        assignmentId: 'a1',
        eventId: 'ev1',
        payload: d.payload,
      },
    ])
  })

  it('aggiorna quando cambia solo l ora di fine', () => {
    const d = desiderato()
    const plan = piano({
      desired: [d],
      existing: [
        comeSuGoogle(d, 'ev1', { end: { dateTime: '2026-08-10T13:00:00+02:00', timeZone: ROME_TZ } }),
      ],
    })
    expect(plan.steps.map((s) => s.action)).toEqual(['update'])
  })

  it('aggiorna quando cambia il titolo, il luogo, la descrizione o la trasparenza', () => {
    const d = desiderato()
    const differenze: Partial<ExistingEvent>[] = [
      { summary: 'Altro' },
      { location: 'RSF' },
      { description: 'modificata a mano' },
      { transparency: 'transparent' },
    ]

    for (const differenza of differenze) {
      const plan = piano({ desired: [d], existing: [comeSuGoogle(d, 'ev1', differenza)] })
      expect(plan.steps.map((s) => s.action)).toEqual(['update'])
    }
  })

  it('aggiorna quando un turno con orario è diventato tutto il giorno', () => {
    const d = desiderato({
      payload: {
        summary: 'Riposo (RIP)',
        description: 'Turno dalla tabella del reparto, sincronizzato da Toni Turni.',
        transparency: 'transparent',
        start: { date: '2026-08-10' },
        end: { date: '2026-08-11' },
        extendedProperties: { private: { shiftKey: 'utente1:2026-08-10', code: 'RIP' } },
      },
    })
    const conOrario = comeSuGoogle(desiderato(), 'ev1')

    const plan = piano({ desired: [d], existing: [conOrario] })
    expect(plan.steps.map((s) => s.action)).toEqual(['update'])
  })

  it('cancella l evento di un turno che non c è più', () => {
    const orfano = comeSuGoogle(desiderato({ date: '2026-08-12' }), 'ev9')
    const plan = piano({ desired: [], existing: [orfano] })

    expect(plan.steps).toEqual([
      {
        action: 'delete',
        shiftKey: 'utente1:2026-08-12',
        date: '2026-08-12',
        eventId: 'ev9',
        reason: 'turno_rimosso',
      },
    ])
  })

  it('un evento annullato conta come assente: si ricrea', () => {
    const d = desiderato()
    const plan = piano({ desired: [d], existing: [comeSuGoogle(d, 'ev1', { status: 'cancelled' })] })

    expect(plan.steps.map((s) => s.action)).toEqual(['create'])
  })

  it('con due eventi per lo stesso giorno tiene il primo e cancella il duplicato', () => {
    const d = desiderato()
    const plan = piano({ desired: [d], existing: [comeSuGoogle(d, 'evB'), comeSuGoogle(d, 'evA')] })

    expect(plan.steps).toEqual([
      { action: 'keep', shiftKey: d.shiftKey, date: d.date, assignmentId: 'a1', eventId: 'evA' },
      {
        action: 'delete',
        shiftKey: d.shiftKey,
        date: d.date,
        eventId: 'evB',
        reason: 'evento_duplicato',
      },
    ])
  })

  it('ordina i passi per data e mette le cancellazioni in coda', () => {
    const primo = desiderato({ date: '2026-08-02', shiftKey: 'utente1:2026-08-02', assignmentId: 'a2' })
    const secondo = desiderato({ date: '2026-08-20', shiftKey: 'utente1:2026-08-20', assignmentId: 'a3' })
    const orfano = comeSuGoogle(desiderato({ date: '2026-08-05' }), 'ev5')

    const plan = piano({ desired: [secondo, primo], existing: [orfano] })

    expect(plan.steps.map((s) => [s.action, s.date])).toEqual([
      ['create', '2026-08-02'],
      ['create', '2026-08-20'],
      ['delete', '2026-08-05'],
    ])
  })
})

describe('planSync — quello che non si tocca mai', () => {
  it('non tocca un evento senza extendedProperties', () => {
    const plan = piano({ existing: [{ id: 'personale', summary: 'Dentista' }] })

    expect(plan.steps).toEqual([])
    expect(plan.foreignEvents).toBe(1)
  })

  it('non tocca un evento con proprietà private ma senza shiftKey', () => {
    const plan = piano({
      existing: [
        { id: 'personale', summary: 'Dentista', extendedProperties: { private: { altro: 'x' } } },
      ],
    })

    expect(plan.steps).toEqual([])
    expect(plan.foreignEvents).toBe(1)
  })

  it('non tocca un evento con una shiftKey malformata', () => {
    const plan = piano({
      existing: [
        { id: 'strano', extendedProperties: { private: { shiftKey: 'utente1' } } },
        { id: 'strano2', extendedProperties: { private: { shiftKey: 'utente1:10-08-2026' } } },
      ],
    })

    expect(plan.steps).toEqual([])
    expect(plan.foreignEvents).toBe(2)
  })

  it('non tocca l evento di un altro utente', () => {
    const plan = piano({
      existing: [{ id: 'altrui', extendedProperties: { private: { shiftKey: 'utente2:2026-08-10' } } }],
    })

    expect(plan.steps).toEqual([])
    expect(plan.foreignEvents).toBe(1)
  })

  it('non tocca un nostro evento fuori dal mese sincronizzato', () => {
    // La lista di Google include gli eventi che sconfinano nella finestra:
    // una notte del 31 luglio o un tutto-il-giorno del 31 agosto del mese dopo.
    const plan = piano({
      existing: [
        comeSuGoogle(desiderato({ date: '2026-07-31' }), 'evLuglio'),
        comeSuGoogle(desiderato({ date: '2026-09-01' }), 'evSettembre'),
      ],
    })

    expect(plan.steps).toEqual([])
    expect(plan.outOfWindowEvents).toBe(2)
  })

  it('non cancella l evento di un giorno saltato: la chiave è protetta', () => {
    const orfano = comeSuGoogle(desiderato({ date: '2026-08-12' }), 'ev9')
    const plan = piano({
      desired: [],
      existing: [orfano],
      protectedKeys: ['utente1:2026-08-12'],
    })

    expect(plan.steps).toEqual([])
    expect(plan.protectedEvents).toBe(1)
  })

  it('riporta i turni saltati nel piano, con il loro motivo', () => {
    const plan = planSync({
      userId: 'utente1',
      window: WINDOW,
      desired: [],
      skipped: [{ date: '2026-08-03', code: 'ZZZ', reason: 'codice_sconosciuto' }],
      protectedKeys: [],
      existing: [],
    })

    expect(plan.skipped).toEqual([{ date: '2026-08-03', code: 'ZZZ', reason: 'codice_sconosciuto' }])
  })
})
