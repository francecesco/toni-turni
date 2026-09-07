FROM node:22-alpine AS deps
WORKDIR /app
# openssl serve ai binari di Prisma su musl
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# node_modules di sola produzione per il runner: la CLI Prisma (ora una dependency,
# non una devDependency) e le sue dipendenze transitive arrivano tutte da qui,
# pinnate dal lockfile via "npm ci --omit=dev" — mai un npm install floating.
# Un bump di patch di Prisma che cambia le sue dipendenze non richiede più di
# aggiornare a mano un elenco di COPY nel runner.
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
 && npx prisma generate

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Il seed viene compilato qui: nel runner non ci sono tsx e le sue dipendenze.
RUN npx prisma generate \
 && npm run build \
 && ./node_modules/.bin/esbuild prisma/seed.ts --bundle --platform=node --target=node22 \
      --external:@prisma/client --outfile=prisma/seed.js

FROM node:22-alpine AS runner
WORKDIR /app
# sqlite: serve solo al backup coerente (`sqlite3 /data/turni.db ".backup ..."`, vedi README);
# l app usa il client Prisma e non lo tocca.
RUN apk add --no-cache openssl sqlite
# HOSTNAME=0.0.0.0 sovrascrive l HOSTNAME che Docker imposta all id del container:
# senza, il server standalone si lega solo all IP del container e l healthcheck
# (che chiama localhost) non riceve mai risposta.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 TZ=Europe/Rome HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# migrate deploy e seed girano all avvio: servono schema, migrazioni e la CLI Prisma
# con tutte le sue dipendenze transitive, prese in blocco da prod-deps invece che
# enumerate una per una (vedi commento sopra sullo stage prod-deps).
COPY --from=builder /app/prisma ./prisma
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma/seed.js ./prisma/seed.js
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && mkdir -p /data && chown -R node:node /data

USER node
EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
