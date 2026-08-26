import { describe, expect, it } from 'vitest'
import { compactCode, matchCode } from '@/modules/codes/normalize'
import type { ShiftCodeDef } from '@/modules/codes/types'

const def = (code: string): ShiftCodeDef => ({
  code,
  label: code,
  kind: 'work',
  startTime: '07:00',
  endTime: '14:00',
  crossesMidnight: false,
  location: null,
  color: null,
  needsReview: false,
})

const defs = [def('M'), def('P'), def('M/P'), def('M RSF'), def('M1°P')]

describe('compactCode', () => {
  it('porta in maiuscolo e rimuove gli spazi', () => {
    expect(compactCode(' m rsf ')).toBe('MRSF')
  })

  it('normalizza il simbolo di grado scritto come ordinale', () => {
    expect(compactCode('m1ºp')).toBe('M1°P')
  })
})

describe('matchCode', () => {
  it('trova il codice esatto', () => {
    expect(matchCode('M', defs)?.code).toBe('M')
  })

  it('ignora spazi e maiuscole', () => {
    expect(matchCode('m 1°p', defs)?.code).toBe('M1°P')
    expect(matchCode('MRSF', defs)?.code).toBe('M RSF')
  })

  it('non confonde M/P con M', () => {
    expect(matchCode('M/P', defs)?.code).toBe('M/P')
  })

  it('restituisce null per un codice sconosciuto', () => {
    expect(matchCode('XYZ', defs)).toBeNull()
  })

  it('restituisce null per una cella vuota', () => {
    expect(matchCode('   ', defs)).toBeNull()
  })
})
