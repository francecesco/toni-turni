import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // createTestDb esegue `npx prisma migrate deploy` in un processo figlio: con molti
    // file di test in parallelo il default di 10s non basta su macchine lente.
    hookTimeout: 120_000,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
