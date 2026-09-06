import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChangesBox, describeChange } from '@/app/rosters/[id]/review/changes-box'
import type { VersionChange } from '@/modules/review/diff'

const cambio = (day: number, kind: VersionChange['kind'], before: string | null, after: string | null): VersionChange => ({
  columnLabel: 'CRISTINA',
  columnKey: 'CRISTINA',
  day,
  kind,
  before,
  after,
})

describe('describeChange', () => {
  it('descrive i tre tipi in una parola o due', () => {
    expect(describeChange(cambio(5, 'changed', 'M', 'P'))).toBe('5 (M → P)')
    expect(describeChange(cambio(12, 'added', null, 'M'))).toBe('12 nuovo (M)')
    expect(describeChange(cambio(20, 'removed', 'M', null))).toBe('20 tolto (era M)')
  })
})

describe('ChangesBox', () => {
  it('con diff vuoto non disegna niente: un avviso sempre presente insegna a ignorarlo', () => {
    expect(renderToStaticMarkup(createElement(ChangesBox, { changes: [] }))).toBe('')
  })

  it('dice quanti giorni sono cambiati e quali', () => {
    const html = renderToStaticMarkup(
      createElement(ChangesBox, {
        changes: [cambio(5, 'changed', 'M', 'P'), cambio(12, 'added', null, 'M'), cambio(20, 'removed', 'M', null)],
      }),
    )
    expect(html).toContain('3 giorni')
    expect(html).toContain('5 (M → P)')
    expect(html).toContain('12 nuovo (M)')
    expect(html).toContain('20 tolto (era M)')
  })

  it('al singolare dice «1 giorno»', () => {
    const html = renderToStaticMarkup(createElement(ChangesBox, { changes: [cambio(5, 'changed', 'M', 'P')] }))
    expect(html).toContain('1 giorno')
    expect(html).not.toContain('1 giorni')
  })
})
