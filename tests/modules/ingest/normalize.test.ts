import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { normalizeRosterPhoto } from '@/modules/ingest/normalize'

const FIXTURE = join(process.cwd(), 'fixtures', 'roster-2026-08-3piano.jpeg')

describe('normalizeRosterPhoto', () => {
  it('restituisce un JPEG', async () => {
    const result = await normalizeRosterPhoto(readFileSync(FIXTURE))
    // magic bytes di un JPEG
    expect(result.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(await sharp(result.data).metadata()).toMatchObject({ format: 'jpeg' })
  })

  it('non supera il lato massimo richiesto', async () => {
    const result = await normalizeRosterPhoto(readFileSync(FIXTURE), { maxEdge: 800 })
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(800)
  })

  it('riporta dimensioni e peso coerenti con l immagine prodotta', async () => {
    const result = await normalizeRosterPhoto(readFileSync(FIXTURE), { maxEdge: 600 })
    const meta = await sharp(result.data).metadata()
    expect(result.width).toBe(meta.width)
    expect(result.height).toBe(meta.height)
    expect(result.bytes).toBe(result.data.byteLength)
  })

  it('non ingrandisce un immagine più piccola del lato massimo', async () => {
    const small = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer()

    const result = await normalizeRosterPhoto(small, { maxEdge: 2000 })

    expect(result.width).toBe(200)
    expect(result.height).toBe(100)
  })

  it('applica l orientamento EXIF invece di ignorarlo', async () => {
    // orientation 6 = ruotata di 90°: la normalizzazione deve scambiare i lati
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#ffffff' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    const result = await normalizeRosterPhoto(rotated, { maxEdge: 2000 })

    expect(result.width).toBe(100)
    expect(result.height).toBe(200)
  })

  it('riduce il peso di una foto da smartphone', async () => {
    const original = readFileSync(FIXTURE)
    const result = await normalizeRosterPhoto(original, { maxEdge: 1200, quality: 80 })
    expect(result.bytes).toBeLessThan(original.byteLength)
  })

  it('rifiuta un buffer che non è un immagine', async () => {
    await expect(normalizeRosterPhoto(Buffer.from('non sono una foto'))).rejects.toThrow(
      /immagine/i,
    )
  })
})
