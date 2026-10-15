import { decryptToken, encryptToken, newId, type TokenKey } from "@vidora/core"
import { eq } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { providerCredentials, type ProviderCredential } from "./schema"
import { inWorkspace } from "./scoped"

// The user's Higgsfield API key. Stored encrypted; decrypted only in the worker and in server actions
// that call Higgsfield. The browser only ever sees `credentialForDisplay`.

export class CredentialFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CredentialFormatError"
  }
}

/**
 * The value Higgsfield Console's "Copy API key" gives you. The docs describe it as
 * "KEY_ID:KEY_SECRET"; a single token is accepted too, and the check with Higgsfield decides.
 * Returns the exact string that goes after `Authorization: Key `.
 */
export function parseHiggsfieldKey(raw: string): { credentials: string; hint: string } {
  const value = raw.trim().replace(/^Key\s+/i, "")
  if (!value || /\s/.test(value)) throw new CredentialFormatError("Paste the API key exactly as Higgsfield Console copies it, with no spaces.")
  if (/^[^\s@:]+@[^\s@:]+\.[a-z]{2,}$/i.test(value)) throw new CredentialFormatError("That's an email address. Paste the API key from Higgsfield Console instead.")
  const [id, secret] = value.split(":", 2)
  if (value.includes(":") && (!id || !secret)) throw new CredentialFormatError("The key looks cut off. Copy it again from Higgsfield Console.")
  if (value.length < 16) throw new CredentialFormatError("The key looks too short. Copy it again from Higgsfield Console.")
  return { credentials: value, hint: value.slice(-4) }
}

export async function saveProviderCredential(db: DbOrTx, keys: readonly TokenKey[], workspaceId: string, raw: string) {
  const { credentials, hint } = parseHiggsfieldKey(raw)
  const enc = encryptToken(credentials, keys)
  const values = {
    secretEnc: enc.ciphertext,
    tokenKeyVersion: enc.keyVersion,
    keyHint: hint,
    status: "unverified" as const,
    lastError: null,
    lastVerifiedAt: null,
  }
  const [row] = await db
    .insert(providerCredentials)
    .values({ id: newId("credential"), workspaceId, provider: "higgsfield", ...values })
    .onConflictDoUpdate({ target: [providerCredentials.workspaceId, providerCredentials.provider], set: values })
    .returning()
  return row!
}

export async function getProviderCredential(db: DbOrTx, workspaceId: string) {
  const [row] = await db
    .select()
    .from(providerCredentials)
    .where(inWorkspace(providerCredentials, workspaceId, eq(providerCredentials.provider, "higgsfield")))
  return row ?? null
}

export async function getProviderCredentialById(db: DbOrTx, id: string) {
  const [row] = await db.select().from(providerCredentials).where(eq(providerCredentials.id, id))
  return row ?? null
}

/** The value for `Authorization: Key …`. Server-side only. */
export function readProviderSecret(c: ProviderCredential, keys: readonly TokenKey[]): string {
  return decryptToken(c.secretEnc, keys)
}

export async function markCredentialChecked(db: DbOrTx, id: string, result: { ok: true } | { ok: false; error: string }) {
  await db
    .update(providerCredentials)
    .set(result.ok ? { status: "valid", lastVerifiedAt: new Date(), lastError: null } : { status: "invalid", lastError: result.error })
    .where(eq(providerCredentials.id, id))
}

/** The user tells us their current Higgsfield balance (the API has no balance endpoint). */
export async function setProviderBalance(db: DbOrTx, workspaceId: string, balanceCredits: number) {
  await db
    .update(providerCredentials)
    .set({ balanceCredits, balanceUpdatedAt: new Date() })
    .where(inWorkspace(providerCredentials, workspaceId, eq(providerCredentials.provider, "higgsfield")))
}

export async function deleteProviderCredential(db: DbOrTx, workspaceId: string) {
  await db.delete(providerCredentials).where(inWorkspace(providerCredentials, workspaceId, eq(providerCredentials.provider, "higgsfield")))
}

/** Safe for the browser: no ciphertext. */
export function credentialForDisplay(c: ProviderCredential) {
  return {
    id: c.id,
    provider: c.provider,
    keyHint: c.keyHint,
    status: c.status,
    lastVerifiedAt: c.lastVerifiedAt,
    lastError: c.lastError,
    balanceCredits: c.balanceCredits,
    balanceUpdatedAt: c.balanceUpdatedAt,
  }
}
