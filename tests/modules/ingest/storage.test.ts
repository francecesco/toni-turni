import { existsSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir: string
let storage: typeof import('@/modules/ingest/storage')

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'turni-uploads-'))
  process.env.UPLOAD_DIR = dir
  vi.resetModules()
  storage = await import('@/modules/ingest/storage')
})

afterEach(() => {
  delete process.env.UPLOAD_DIR
})

describe('saveRosterImage / readRosterImage', () => {
  it('scrive il file e lo rilegge identico', async () => {
    const data = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02])

    const path = await storage.saveRosterImage('abc123', data)

    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path)).toEqual(data)
    expect(await storage.readRosterImage('abc123')).toEqual(data)
  })

  it('crea la cartella se non esiste ancora', async () => {
    process.env.UPLOAD_DIR = join(dir, 'annidata', 'ancora')
    vi.resetModules()
    const fresh = await import('@/modules/ingest/storage')

    const path = await fresh.saveRosterImage('xyz', Buffer.from([1]))

    expect(existsSync(path)).toBe(true)
  })

  it('usa un nome derivato dall id, dentro la cartella configurata', () => {
    expect(storage.rosterImagePath('abc123')).toBe(join(dir, 'abc123.jpg'))
  })

  it('rifiuta un id che tenta di uscire dalla cartella', async () => {
    await expect(storage.saveRosterImage('../fuori', Buffer.from([1]))).rejects.toThrow(
      /identificativo/i,
    )
    expect(() => storage.rosterImagePath('a/b')).toThrow(/identificativo/i)
  })

  it('solleva un errore leggibile se l immagine non esiste', async () => {
    await expect(storage.readRosterImage('mancante')).rejects.toThrow(/non trovata/i)
  })
})

describe('deleteRosterImage', () => {
  it('cancella il file', async () => {
    const path = await storage.saveRosterImage('da-cancellare', Buffer.from([1]))
    await storage.deleteRosterImage('da-cancellare')
    expect(existsSync(path)).toBe(false)
  })

  it('non protesta se il file non c è già più', async () => {
    await expect(storage.deleteRosterImage('mai-esistito')).resolves.toBeUndefined()
  })
})

describe('pruneOldImages', () => {
  it('cancella solo le immagini più vecchie della retention', async () => {
    const vecchia = await storage.saveRosterImage('vecchia', Buffer.from([1]))
    const recente = await storage.saveRosterImage('recente', Buffer.from([1]))

    const cento = new Date('2026-01-01T00:00:00Z')
    const centoGiorniPrima = new Date(cento.getTime() - 100 * 86_400_000)
    utimesSync(vecchia, centoGiorniPrima, centoGiorniPrima)
    utimesSync(recente, cento, cento)

    const cancellate = await storage.pruneOldImages(90, cento)

    expect(cancellate).toEqual(['vecchia.jpg'])
    expect(existsSync(vecchia)).toBe(false)
    expect(existsSync(recente)).toBe(true)
  })

  it('non fa nulla se la cartella non esiste', async () => {
    process.env.UPLOAD_DIR = join(dir, 'inesistente')
    vi.resetModules()
    const fresh = await import('@/modules/ingest/storage')

    await expect(fresh.pruneOldImages(90, new Date())).resolves.toEqual([])
  })
})
