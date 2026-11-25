# Multi-stage production build for LaunchPadre
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html launchpadre-theme.css metadata.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV LAUNCHPADRE_WORKSPACE_DB=/data/workspace-runtime.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save tsx

COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY src/customerAuth.ts src/customerBilling.ts src/customerCheckpoints.ts src/customerZenodo.ts src/gitWorkspace.ts src/plans.ts ./src/
COPY backend_python ./backend_python

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--import", "tsx", "server.ts"]
