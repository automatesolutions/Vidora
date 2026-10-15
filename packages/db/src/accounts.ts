import { decryptToken, encryptToken, newId, type TokenKey } from "@vidora/core"
import { and, eq } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { connectedAccounts, type ConnectedAccount } from "./schema"
import { inWorkspace } from "./scoped"

type Platform = ConnectedAccount["platform"]

/** Saves a YouTube/TikTok connection. Tokens are encrypted here, so plaintext never reaches the table. */
export async function upsertConnectedAccount(
  db: DbOrTx,
  keys: readonly TokenKey[],
  input: {
    workspaceId: string
    platform: Platform
    externalId: string
    displayName: string
    handle?: string | null
    avatarUrl?: string | null
    scopes: string[]
    accessToken: string
    refreshToken?: string | null
    accessExpiresAt?: Date | null
    platformMeta?: Record<string, unknown>
  }
) {
  const access = encryptToken(input.accessToken, keys)
  const refresh = input.refreshToken ? encryptToken(input.refreshToken, keys) : null
  const values = {
    displayName: input.displayName,
    handle: input.handle ?? null,
    avatarUrl: input.avatarUrl ?? null,
    scopes: input.scopes,
    accessTokenEnc: access.ciphertext,
    tokenKeyVersion: access.keyVersion,
    accessExpiresAt: input.accessExpiresAt ?? null,
    status: "active" as const,
    platformMeta: input.platformMeta ?? {},
    lastRefreshedAt: new Date(),
    // Google only sends a refresh token on consent. Keep the old one when a reconnect doesn't include it.
    ...(refresh ? { refreshTokenEnc: refresh.ciphertext } : {}),
  }
  const [row] = await db
    .insert(connectedAccounts)
    .values({ id: newId("account"), workspaceId: input.workspaceId, platform: input.platform, externalId: input.externalId, ...values })
    .onConflictDoUpdate({ target: [connectedAccounts.workspaceId, connectedAccounts.platform, connectedAccounts.externalId], set: values })
    .returning()
  return row!
}

/** The workspace's active account on a platform (the first one; one channel per platform for now). */
export async function getActiveAccount(db: DbOrTx, workspaceId: string, platform: Platform) {
  const [row] = await db
    .select()
    .from(connectedAccounts)
    .where(inWorkspace(connectedAccounts, workspaceId, eq(connectedAccounts.platform, platform), eq(connectedAccounts.status, "active")))
    .orderBy(connectedAccounts.createdAt)
    .limit(1)
  return row ?? null
}

/** Every YouTube channel connected to the workspace, oldest first. */
export async function listAccounts(db: DbOrTx, workspaceId: string) {
  return db.select().from(connectedAccounts).where(inWorkspace(connectedAccounts, workspaceId)).orderBy(connectedAccounts.createdAt)
}

/** Public fields only, for UI. Never send token columns to the browser. */
export function accountForDisplay(a: ConnectedAccount) {
  return { id: a.id, platform: a.platform, displayName: a.displayName, handle: a.handle, avatarUrl: a.avatarUrl, status: a.status }
}

export function readTokens(a: ConnectedAccount, keys: readonly TokenKey[]) {
  return {
    accessToken: decryptToken(a.accessTokenEnc, keys),
    refreshToken: a.refreshTokenEnc ? decryptToken(a.refreshTokenEnc, keys) : null,
  }
}

export async function saveRefreshedAccessToken(db: DbOrTx, keys: readonly TokenKey[], accountId: string, accessToken: string, expiresAt: Date) {
  const access = encryptToken(accessToken, keys)
  await db
    .update(connectedAccounts)
    .set({ accessTokenEnc: access.ciphertext, tokenKeyVersion: access.keyVersion, accessExpiresAt: expiresAt, lastRefreshedAt: new Date() })
    .where(eq(connectedAccounts.id, accountId))
}

export async function markAccountNeedsReauth(db: DbOrTx, accountId: string) {
  await db.update(connectedAccounts).set({ status: "needs_reauth" }).where(and(eq(connectedAccounts.id, accountId)))
}
