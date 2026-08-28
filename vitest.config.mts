import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // `createTestDb` (tests/helpers/db.ts) lancia `npx prisma migrate deploy` in
    // un `beforeAll`: misurato 2,0 s a macchina scarica, ma è un sottoprocesso
    // npm e con i test sulle immagini in parallelo su otto worker sfonda il
    // limite di default di 10 s. Un tetto sul tempo di un `npx` non asserisce
    // niente sul codice in prova, misura il carico della macchina: si allinea a
    // `testTimeout`.
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
