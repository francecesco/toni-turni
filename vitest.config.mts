import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // `createTestDb` (tests/helpers/db.ts) migra lo schema **una volta sola** in un
    // database modello e poi lo copia, quindi un hook non paga più un sottoprocesso
    // npm per file. Il tetto resta allineato a `testTimeout` come margine per le
    // macchine lente: un limite di tempo su un `npx` non asserisce niente sul codice
    // in prova, misura il carico della macchina.
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
