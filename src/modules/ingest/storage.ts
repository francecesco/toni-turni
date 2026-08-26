import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { optionalEnv } from '@/lib/env'

// Gli id sono cuid: lettere e cifre. Tutto il resto è rifiutato, così un id
// malevolo non può far scrivere fuori dalla cartella delle foto.
const SAFE_ID = /^[A-Za-z0-9_-]+$/

export function uploadDir(): string {
  return optionalEnv('UPLOAD_DIR', './data/uploads')
}

function assertSafeId(rosterId: string): void {
  if (!SAFE_ID.test(rosterId)) {
    throw new Error(`Identificativo della tabella non valido: ${rosterId}`)
  }
}

export function rosterImagePath(rosterId: string): string {
  assertSafeId(rosterId)
  return join(uploadDir(), `${rosterId}.jpg`)
}

export async function saveRosterImage(rosterId: string, data: Buffer): Promise<string> {
  const path = rosterImagePath(rosterId)
  await mkdir(uploadDir(), { recursive: true })
  await writeFile(path, data)
  return path
}

export async function readRosterImage(rosterId: string): Promise<Buffer> {
  const path = rosterImagePath(rosterId)
  try {
    return await readFile(path)
  } catch (cause) {
    throw new Error(`Immagine della tabella non trovata: ${rosterId}`, { cause })
  }
}

export async function deleteRosterImage(rosterId: string): Promise<void> {
  try {
    await unlink(rosterImagePath(rosterId))
  } catch (error) {
    // Già cancellata: per il chiamante il risultato è lo stesso.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Cancella le immagini più vecchie della retention e restituisce i nomi rimossi. */
export async function pruneOldImages(retentionDays: number, now: Date): Promise<string[]> {
  const dir = uploadDir()
  const soglia = now.getTime() - retentionDays * 86_400_000

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const rimosse: string[] = []
  for (const entry of entries) {
    const info = await stat(join(dir, entry))
    if (info.mtimeMs < soglia) {
      await unlink(join(dir, entry))
      rimosse.push(entry)
    }
  }
  return rimosse
}
