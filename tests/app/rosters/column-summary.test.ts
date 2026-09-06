import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ColumnSummary } from '@/app/rosters/[id]/review/column-summary'
import { syncButtonCopy } from '@/app/rosters/[id]/review/sync-button'
import type { GridSummary } from '@/modules/review/grid'

function riassunto(over: Partial<GridSummary> = {}): GridSummary {
  return {
    days: 30,
    shifts: 20,
    confirmed: 20,
    synced: 20,
    syncFailed: 0,
    attention: 0,
    unknownCodes: 0,
    confirmable: 20,
    changed: 0,
    emptyDays: [],
    ...over,
  }
}

function rendi(summary: GridSummary): string {
  return renderToStaticMarkup(
    createElement(ColumnSummary, {
      columnLabel: 'CRISTINA',
      summary,
      canConfirm: true,
      extracting: false,
      unreadTouchingColumn: false,
      unknownBands: false,
    }),
  )
}

describe('ColumnSummary — quanto e gia sul calendario', () => {
  it('con tutti i confermati inviati mostra «sul calendario»', () => {
    const html = rendi(riassunto())
    expect(html).toContain('sul calendario')
    expect(html).not.toContain('da mandare')
  })

  it('con invii mancanti dice quanti sono da mandare', () => {
    const html = rendi(riassunto({ synced: 17 }))
    expect(html).toContain('3 da mandare')
  })

  it('con un invio fallito lo dice per primo', () => {
    const html = rendi(riassunto({ synced: 19, syncFailed: 1 }))
    expect(html).toContain('1 invio non riuscito')
  })

  it('senza conferme non parla di calendario', () => {
    const html = rendi(riassunto({ confirmed: 0, synced: 0 }))
    expect(html).not.toContain('sul calendario')
    expect(html).not.toContain('da mandare')
  })
})

describe('syncButtonCopy — il bottone dice se sta mandando o aggiornando', () => {
  it('al primo invio manda i turni confermati', () => {
    expect(syncButtonCopy({ shifts: 20, synced: 0, pending: false }).label).toMatch(/Manda.*20 turni/)
  })

  it('quando tutto e gia sul calendario propone un aggiornamento, non un nuovo invio', () => {
    const copia = syncButtonCopy({ shifts: 20, synced: 20, pending: false })
    expect(copia.label).toMatch(/aggiorna/i)
    expect(copia.note).toMatch(/gi[aà] sul calendario/i)
    expect(copia.note).toMatch(/non duplica|senza duplicare/i)
  })

  it('con invii parziali dice quanti mancano', () => {
    const copia = syncButtonCopy({ shifts: 20, synced: 17, pending: false })
    expect(copia.label).toMatch(/3/)
    expect(copia.note).toMatch(/17/)
  })

  it('mentre lavora lo dice, qualunque sia lo stato', () => {
    expect(syncButtonCopy({ shifts: 20, synced: 20, pending: true }).label).toMatch(/Sto scrivendo/)
  })
})
