import { PrismaClient } from '@prisma/client'

// In sviluppo Next ricarica i moduli a ogni modifica: senza cache globale
// si aprirebbe una connessione nuova a ogni hot reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
