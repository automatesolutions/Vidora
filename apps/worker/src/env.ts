import { secretsFromEnv } from "@vidora/core"

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
}
