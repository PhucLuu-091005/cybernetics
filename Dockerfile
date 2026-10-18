FROM node:24-alpine AS dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm build
# The migration step runs outside the Next bundle, so it needs drizzle-orm itself; pg already ships in the standalone output.
RUN mkdir -p /migrator && cp -RL node_modules/drizzle-orm /migrator/drizzle-orm && find /migrator -name '*.map' -delete -o -name '*.d.ts' -delete -o -name '*.d.cts' -delete
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /migrator/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder --chown=app:app /app/src/server/db/migrations ./src/server/db/migrations
COPY --from=builder --chown=app:app /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=app:app /app/scripts/healthcheck.mjs ./scripts/healthcheck.mjs
USER app
# Cloud Run sets PORT (8080 by default) and Next's standalone server.js listens on it; Cloud Run ignores HEALTHCHECK and probes /api/health itself.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["node", "scripts/healthcheck.mjs"]
# Hosts may inject their own HOSTNAME; the server must still listen on every interface.
CMD ["sh", "-c", "node scripts/migrate.mjs && HOSTNAME=0.0.0.0 exec node server.js"]
