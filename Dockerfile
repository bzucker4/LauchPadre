FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STATE_DB_PATH=/app/data/workspace.db GIT_REPOSITORIES_ROOT=/repositories
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data /repositories && chown -R node:node /app/data /repositories
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/src ./src
COPY --from=build /app/backend_python ./backend_python
USER node
EXPOSE 3000
CMD ["npm", "start"]
