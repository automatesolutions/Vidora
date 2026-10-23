import type { TokenKey } from "@vidora/core"
import { CredentialFormatError, getProviderCredential, markCredentialChecked, parseHiggsfieldKey, readProviderSecret, saveProviderCredential, type Db } from "@vidora/db"
import { HiggsfieldProvider } from "@vidora/providers"
import { log } from "./log"

// The engine's Higgsfield API key comes from the server environment (HF_CREDENTIALS, key-id:key-secret,
// in .env.local or Secret Manager), so nobody has to paste it into the app. At startup the worker
// saves it, encrypted, as the platform workspace's API key and checks it with Higgsfield (free).
// The value is never logged.

export type EngineKeyResult = "saved" | "unchanged" | "invalid" | "skipped"

/** The engine key from the environment: HF_CREDENTIALS (the SDK's name), else HIGGSFIELD_API_KEY. */
export function engineKeyFromEnv() {
  return process.env.HF_CREDENTIALS?.trim() || process.env.HIGGSFIELD_API_KEY?.trim() || undefined
}

export async function syncEngineKey(db: Db, keys: readonly TokenKey[], platformWorkspaceId: string | null, raw = engineKeyFromEnv()): Promise<EngineKeyResult> {
  if (!raw?.trim()) return "skipped"
  if (!platformWorkspaceId) {
    log.warn("HF_CREDENTIALS is set but PLATFORM_WORKSPACE_ID isn't, so the API key isn't used. Set PLATFORM_WORKSPACE_ID to the operator workspace.")
    return "skipped"
  }
  let credentials: string
  try {
    credentials = parseHiggsfieldKey(raw).credentials
  } catch (err) {
    if (err instanceof CredentialFormatError) {
      log.error("HF_CREDENTIALS isn't a Higgsfield API key in key-id:key-secret format.")
      return "invalid"
    }
    throw err
  }

  const existing = await getProviderCredential(db, platformWorkspaceId)
  if (existing && existing.status === "valid" && readProviderSecret(existing, keys) === credentials) return "unchanged"

  const row = await saveProviderCredential(db, keys, platformWorkspaceId, credentials)
  const check = await new HiggsfieldProvider({ credentials })
    .verifyCredentials()
    .catch((err: unknown) => ({ ok: false as const, error: `Couldn't reach Higgsfield to check the key (${err instanceof Error ? err.name : "error"}).` }))
  await markCredentialChecked(db, row.id, check)
  if (!check.ok) {
    log.error("Higgsfield didn't accept the API key in HF_CREDENTIALS.", { reason: check.error })
    return "invalid"
  }
  log.info("engine API key ready")
  return "saved"
}
