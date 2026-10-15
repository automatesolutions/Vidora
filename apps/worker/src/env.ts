import { tokenKeysFromEnv } from "@vidora/core"

function required(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (see .env.example)`)
  return v
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6380",
  APP_URL: required("APP_URL").replace(/\/$/, ""),
  /**
   * Public HTTPS base URL Higgsfield can reach for webhooks (e.g. the deployed app, or a tunnel in dev).
   * Without one, polling alone finishes jobs; it's just slower to notice.
   */
  WEBHOOK_BASE_URL: (process.env.WEBHOOK_BASE_URL ?? process.env.APP_URL ?? "").replace(/\/$/, ""),
  WEBHOOK_SECRET: process.env.HIGGSFIELD_WEBHOOK_SECRET ?? "",
  /** How many generation steps run at once. Higgsfield's own concurrency limit is per account (often 4). */
  GENERATION_CONCURRENCY: Number(process.env.GENERATION_CONCURRENCY ?? 4),
  SWEEP_INTERVAL_MS: Number(process.env.SWEEP_INTERVAL_MS ?? 3000),
}

export const tokenKeys = () => tokenKeysFromEnv(required("TOKEN_ENCRYPTION_KEYS"))

/** Google OAuth settings for YouTube uploads. Read lazily: generation works without them. */
export function youtubeEnv() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  return {
    google: id && secret ? { clientId: id, clientSecret: secret } : null,
    audited: process.env.YOUTUBE_AUDITED === "true",
  }
}
