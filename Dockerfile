FROM node:22-alpine AS deps
WORKDIR /app
# openssl serve ai binari di Prisma su musl
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

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

FROM node:22-alpine AS prisma-cli
WORKDIR /prisma-cli
RUN apk add --no-cache openssl
# La CLI di Prisma 6.19 usa @prisma/config, che porta dipendenze proprie
# (effect, c12, ...) fuori dallo scope @prisma: un'installazione isolata
# le risolve tutte senza portarsi dietro le devDependencies del progetto.
RUN npm install --omit=dev --no-save prisma@6.19.3

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
# HOSTNAME=0.0.0.0 sovrascrive l HOSTNAME che Docker imposta all id del container:
# senza, il server standalone si lega solo all IP del container e l healthcheck
# (che chiama localhost) non riceve mai risposta.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 TZ=Europe/Rome HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# migrate deploy e seed girano all avvio: servono schema, migrazioni e CLI
COPY --from=builder /app/prisma ./prisma
COPY --from=prisma-cli /prisma-cli/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma/seed.js ./prisma/seed.js
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["node", "server.js"]
