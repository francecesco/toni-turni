import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const TEMPLATE_DIR = join(process.cwd(), 'node_modules', '.cache', 'turni-test-db')

/**
 * Impronta dello schema: nomi delle migrazioni più il contenuto di `schema.prisma`.
 * Serve a invalidare il modello quando lo schema cambia, senza rimigrare a ogni test.
 */
function schemaFingerprint(): string {
  const migrations = readdirSync(join(process.cwd(), 'prisma', 'migrations'))
    .filter((name) => !name.startsWith('.'))
    .sort()
    .join('|')
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')
  return createHash('sha256').update(`${migrations}\n${schema}`).digest('hex').slice(0, 16)
}

/**
 * Database modello, migrato una volta per impronta dello schema e poi copiato.
 *
 * Perché non migrare a ogni test: `npx prisma migrate deploy` è un sottoprocesso
 * npm da ~2 s a macchina scarica, e nove file di test lo lanciavano ciascuno per
 * conto proprio. In parallelo con i test sulle immagini gli hook sfondavano anche
 * un tetto di 30 s — un guasto che non dice niente sul codice in prova e dipende
 * solo dal carico della macchina. Copiare un file SQLite costa un millisecondo.
 *
 * La costruzione è atomica: si migra in un file temporaneo e si rinomina, così due
 * worker che partono insieme non si leggono un modello a metà (il perdente della
 * corsa produce un modello equivalente, quindi non serve un lock).
 *
 * Lo staging sta **dentro `TEMPLATE_DIR`**, non in `os.tmpdir()`: `renameSync` fra
 * due filesystem diversi non è atomico e su Linux non è nemmeno permesso
 * (`EXDEV`), e su una macchina con `/tmp` su tmpfs — Docker, CI — cadrebbe tutta
 * la suite che tocca il database. Nella stessa directory il rename è una
 * operazione sola sullo stesso filesystem, che è ciò che lo rende atomico.
 */
function templatePath(): string {
  const path = join(TEMPLATE_DIR, `${schemaFingerprint()}.db`)
  if (existsSync(path)) return path

  mkdirSync(TEMPLATE_DIR, { recursive: true })
  const building = mkdtempSync(join(TEMPLATE_DIR, 'building-'))
  const staged = join(building, 'test.db')

  try {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: `file:${staged}` },
      stdio: 'pipe',
    })
    renameSync(staged, path)
  } finally {
    rmSync(building, { recursive: true, force: true })
  }

  return path
}

/** Crea un database SQLite temporaneo con lo schema migrato. */
export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'turni-test-'))
  const file = join(dir, 'test.db')
  const url = `file:${file}`

  copyFileSync(templatePath(), file)

  const prisma = new PrismaClient({ datasources: { db: { url } } })

  return {
    prisma,
    url,
    async cleanup() {
      await prisma.$disconnect()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
