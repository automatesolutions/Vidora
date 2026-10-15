import { decryptToken, encryptToken, newId, type TokenKey } from "@vidora/core"
import { eq } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { appSettings, providerCredentials, type ProviderCredential } from "./schema"
import { inWorkspace } from "./scoped"

// "Connect Higgsfield" (sign in with a Higgsfield account; generations use the plan's credits).
// Stored in provider_credentials with provider = "higgsfield_mcp". The OAuth tokens are one JSON
// value, AES-256-GCM encrypted like every other secret. Never sent to the browser.

export type StoredHiggsfieldTokens = { clientId: string; accessToken: string; refreshToken: string | null; expiresAt: number | null }

export async function saveHiggsfieldConnection(
  db: DbOrTx,
  keys: readonly TokenKey[],
  workspaceId: string,
  tokens: StoredHiggsfieldTokens,
  account: { plan: string | null; credits: number | null }
) {
  const enc = encryptToken(JSON.stringify(tokens), keys)
  const values = {
    secretEnc: enc.ciphertext,
    tokenKeyVersion: enc.keyVersion,
    keyHint: account.plan ?? "account",
    accountPlan: account.plan,
    status: "valid" as const,
    lastVerifiedAt: new Date(),
    lastError: null,
    // Plan balances are read live from Higgsfield, so this is just the last value we saw.
    balanceCredits: account.credits,
    balanceUpdatedAt: account.credits === null ? null : new Date(),
  }
  const [row] = await db
    .insert(providerCredentials)
    .values({ id: newId("credential"), workspaceId, provider: "higgsfield_mcp", ...values })
    .onConflictDoUpdate({ target: [providerCredentials.workspaceId, providerCredentials.provider], set: values })
    .returning()
  return row!
}

export async function getHiggsfieldConnection(db: DbOrTx, workspaceId: string) {
  const [row] = await db
    .select()
    .from(providerCredentials)
    .where(inWorkspace(providerCredentials, workspaceId, eq(providerCredentials.provider, "higgsfield_mcp")))
  return row ?? null
}

export function readHiggsfieldTokens(c: ProviderCredential, keys: readonly TokenKey[]): StoredHiggsfieldTokens {
  return JSON.parse(decryptToken(c.secretEnc, keys)) as StoredHiggsfieldTokens
}

/** Saves refreshed tokens so the next worker step (or restart) uses them. */
export async function saveRefreshedHiggsfieldTokens(db: DbOrTx, keys: readonly TokenKey[], credentialId: string, tokens: StoredHiggsfieldTokens) {
  const enc = encryptToken(JSON.stringify(tokens), keys)
  await db
    .update(providerCredentials)
    .set({ secretEnc: enc.ciphertext, tokenKeyVersion: enc.keyVersion, status: "valid", lastVerifiedAt: new Date(), lastError: null })
    .where(eq(providerCredentials.id, credentialId))
}

export async function deleteHiggsfieldConnection(db: DbOrTx, workspaceId: string) {
  await db.delete(providerCredentials).where(inWorkspace(providerCredentials, workspaceId, eq(providerCredentials.provider, "higgsfield_mcp")))
}

// ── App settings ──────────────────────────────────────────────────────────────

export async function getSetting<T extends Record<string, unknown>>(db: DbOrTx, key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key))
  return (row?.value as T | undefined) ?? null
}

export async function setSetting(db: DbOrTx, key: string, value: Record<string, unknown>) {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } })
}
