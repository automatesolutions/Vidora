# Vidora web image (Cloud Run). Build context: repo root.
# NEXT_PUBLIC_APP_URL and ENABLE_DESIGN_SYSTEM are baked in at build time (the pages that read them are
# prerendered); everything else is read at runtime.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile --filter web...

FROM base AS build
ARG NEXT_PUBLIC_APP_URL
ARG ENABLE_DESIGN_SYSTEM=false
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    ENABLE_DESIGN_SYSTEM=$ENABLE_DESIGN_SYSTEM \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/storage packages/storage
COPY apps/web apps/web
RUN pnpm --filter web build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public apps/web/public
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
