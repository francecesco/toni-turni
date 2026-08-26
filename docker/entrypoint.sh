#!/bin/sh
set -e

# node_modules/.bin non viene copiato nell immagine: invochiamo gli entry point diretti.
echo "Applico le migrazioni..."
node ./node_modules/prisma/build/index.js migrate deploy

echo "Carico i codici turno mancanti..."
node prisma/seed.js

exec "$@"
