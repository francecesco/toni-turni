import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // I test che toccano il database creano uno SQLite temporaneo con
    // `npx prisma migrate deploy` dentro un hook: con più file in parallelo il
    // limite predefinito di 10s scade e i test falliscono senza colpa del codice.
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
