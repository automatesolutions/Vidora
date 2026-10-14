import { secretsFromEnv, tokenKeysFromEnv } from "@vidora/core"

function required(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (see .env.example)`)
  return v
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  APP_URL: required("APP_URL").replace(/\/$/, ""),
  N8N_WEBHOOK_URL: required("N8N_WEBHOOK_URL"),
  VIDORA_TO_N8N_SECRETS: secretsFromEnv(required("VIDORA_TO_N8N_SECRET")),
  DISPATCH_INTERVAL_MS: Number(process.env.DISPATCH_INTERVAL_MS ?? 2000),
  PUBLISH_INTERVAL_MS: Number(process.env.PUBLISH_INTERVAL_MS ?? 15000),
}

/** Publishing settings. Read lazily so the smoke test doesn't need them. */
export function publishEnv() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  return {
    tokenKeys: tokenKeysFromEnv(required("TOKEN_ENCRYPTION_KEYS")),
    google: id && secret ? { clientId: id, clientSecret: secret } : null,
    audited: process.env.YOUTUBE_AUDITED === "true",
  }
}
