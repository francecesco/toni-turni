import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, checkOutDir } from '../../scripts/visualize-quad'

/**
 * Lo strumento di ispezione visiva salva foto di tabelle turni: sono dati
 * personali di terzi e non devono finire in git. Il controllo va fatto contro la
 * radice del repository, non contro la cartella di lavoro corrente — altrimenti
 * `cd src && npx tsx ../scripts/visualize-quad.ts ..` scrive nella radice del
 * repository e il controllo non se ne accorge.
 */
describe('checkOutDir', () => {
  it('conosce la radice del repository, non la cartella di lavoro', () => {
    // la radice è quella dello script, quindi resta la stessa da qualunque
    // cartella si lanci il comando
    expect(REPO_ROOT).toBe(join(import.meta.dirname, '..', '..'))
  })

  it('rifiuta una cartella dentro il repository', () => {
    expect(() => checkOutDir(join(REPO_ROOT, 'src'))).toThrow(/dentro il repository/i)
    expect(() => checkOutDir(REPO_ROOT)).toThrow(/dentro il repository/i)
  })

  it('confronta con la radice ricevuta, non con la cartella di lavoro', () => {
    // è il difetto vero: con `process.cwd()` al posto della radice, una cartella
    // che sta dentro il repository sembra fuori appena il comando parte da una
    // sottocartella. Qui la radice dichiarata è altrove, quindi la radice del
    // repository deve risultare accettabile: se la funzione guardasse `cwd`
    // (che è la radice del repository quando girano i test) la rifiuterebbe.
    expect(checkOutDir(REPO_ROOT, tmpdir())).toBe(REPO_ROOT)
  })

  it('rifiuta una cartella che non esiste, prima di fare qualunque lavoro', () => {
    expect(() => checkOutDir(join(tmpdir(), 'non-esiste-toni-turni-xyz'))).toThrow(/non esiste/i)
  })

  it('accetta una cartella esistente fuori dal repository', () => {
    expect(checkOutDir(tmpdir())).toBe(tmpdir())
  })
})
