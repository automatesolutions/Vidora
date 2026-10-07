# Vidora worker image (compose `prod` profile). Build context: repo root.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @vidora/worker... --filter vidora

FROM base AS run
ENV NODE_ENV=production
COPY --from=deps /app ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/worker apps/worker
USER node
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/index.ts"]
