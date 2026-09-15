# Production image for a small private deployment.
FROM node:22-alpine AS base
WORKDIR /app
# openssl is load-bearing, not incidental: without it Prisma cannot detect the
# libssl version, warns, guesses openssl-1.1.x, and then decides the engine it
# has does not match and tries to download a replacement at run time.
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# A build-time URL is needed for `prisma generate`; the real one is injected at run time.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate && npx next build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# The Prisma CLI, engines and schema, so this image can migrate.
# Next's standalone output ships no node_modules/.bin, so there is no `prisma`
# on PATH: the CLI is invoked by path as `node node_modules/prisma/build/index.js`.
# `npx prisma` here fails with "sh: prisma: not found".
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
