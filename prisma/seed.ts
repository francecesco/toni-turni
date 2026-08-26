import { PrismaClient } from '@prisma/client'
import { DEFAULT_SHIFT_CODES } from '../src/modules/codes/defaults'

/**
 * Inserisce i codici mancanti e lascia intatti quelli già presenti:
 * gli orari corretti a mano dalla referente non vengono mai sovrascritti.
 *
 * Nota: `createMany({ skipDuplicates: true })` non è supportato su SQLite
 * (limite del provider, non della versione di Prisma), perciò verifichiamo
 * l esistenza di ogni codice prima di crearlo.
 */
export async function seedShiftCodes(prisma: PrismaClient): Promise<number> {
  let created = 0
  for (const def of DEFAULT_SHIFT_CODES) {
    const existing = await prisma.shiftCode.findUnique({ where: { code: def.code } })
    if (existing) continue

    await prisma.shiftCode.create({
      data: {
        code: def.code,
        label: def.label,
        kind: def.kind,
        startTime: def.startTime,
        endTime: def.endTime,
        crossesMidnight: def.crossesMidnight,
        location: def.location,
        color: def.color,
        needsReview: def.needsReview,
      },
    })
    created += 1
  }
  return created
}

// seed.js e' l'output compilato da esbuild eseguito nell immagine Docker
// (vedi Dockerfile): il controllo deve riconoscere entrambe le estensioni.
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  const prisma = new PrismaClient()
  seedShiftCodes(prisma)
    .then((created) => console.log(`Codici turno inseriti: ${created}`))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
