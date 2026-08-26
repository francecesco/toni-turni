import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

/** Crea un database SQLite temporaneo con lo schema migrato. */
export function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'turni-test-'))
  const url = `file:${join(dir, 'test.db')}`

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

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
