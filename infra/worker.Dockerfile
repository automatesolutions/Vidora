# AutoShorts worker image (compose `prod` profile). Build context: repo root.
FROM node:22-alpine AS base
# FFmpeg assembles each Short (scenes + voiceover + music + captions). Chromium renders app-style
# niche websites (single-page apps) that web fetch can't read (src/page-render.ts).
RUN apk add --no-cache ffmpeg font-noto chromium
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/storage/package.json packages/storage/
COPY packages/providers/package.json packages/providers/
COPY packages/director/package.json packages/director/
RUN pnpm install --frozen-lockfile --filter @vidora/worker... --filter vidora

FROM base AS run
ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    CHROMIUM_PATH=/usr/bin/chromium
COPY --from=deps /app ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/storage packages/storage
COPY packages/providers packages/providers
COPY packages/director packages/director
COPY apps/worker apps/worker
USER node
WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx", "src/index.ts"]
