import "server-only"
import { tokenKeysFromEnv } from "@vidora/core"
import { getSetting, readHiggsfieldTokens, saveRefreshedHiggsfieldTokens, setSetting, type DbOrTx, type ProviderCredential } from "@vidora/db"
import { accessTokenSource, HiggsfieldMcpProvider, registerApp } from "@vidora/providers"
import { appUrl } from "@/lib/server/youtube"

// "Connect Higgsfield": the app's OAuth client with Higgsfield's sign-in server. Registered once per
// redirect URL (dynamic client registration) and remembered in app_settings.

export const HF_CONNECT_COOKIE = "autoshorts_hf_connect"
export const HF_CALLBACK_PATH = "/api/connect/higgsfield/callback"

export function higgsfieldRedirectUri() {
  return `${appUrl()}${HF_CALLBACK_PATH}`
}

export async function higgsfieldClientId(db: DbOrTx): Promise<string> {
  const redirectUri = higgsfieldRedirectUri()
  const key = `higgsfield_oauth_client:${redirectUri}`
  const saved = await getSetting<{ clientId: string }>(db, key)
  if (saved?.clientId) return saved.clientId
  const { clientId } = await registerApp(redirectUri, "AutoShorts Studio")
  await setSetting(db, key, { clientId })
  return clientId
}

/** Live plan balance for a connected account; refreshes and saves the tokens when needed. */
export async function higgsfieldPlanStatus(db: DbOrTx, credential: ProviderCredential) {
  const keys = tokenKeysFromEnv(process.env.TOKEN_ENCRYPTION_KEYS)
  const provider = new HiggsfieldMcpProvider({
    accessToken: accessTokenSource(readHiggsfieldTokens(credential, keys), (t) => saveRefreshedHiggsfieldTokens(db, keys, credential.id, t)),
  })
  try {
    return { ok: true as const, ...(await provider.balance()) }
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Couldn't reach Higgsfield." }
  }
}
