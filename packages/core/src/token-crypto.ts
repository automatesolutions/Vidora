import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

// AES-256-GCM for OAuth tokens in connected_accounts (docs/PLAN.md §9).
// Ciphertext format: `v<keyVersion>.<iv>.<tag>.<data>` (base64url parts). The version picks the key,
// so old rows still decrypt after a rotation.
//
// TOKEN_ENCRYPTION_KEYS: comma-separated `<version>:<64 hex chars>`, newest first. Example:
//   TOKEN_ENCRYPTION_KEYS=2:ab12…,1:cd34…   (encrypts with 2, decrypts 2 and 1)

export type TokenKey = { version: number; key: Buffer }

export function tokenKeysFromEnv(value: string | undefined): TokenKey[] {
  const keys = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [v, hex] = entry.split(":")
      const version = Number(v)
      if (!Number.isInteger(version) || version < 1 || !/^[0-9a-f]{64}$/i.test(hex ?? "")) {
        throw new Error("TOKEN_ENCRYPTION_KEYS entries look like 1:<64 hex chars>")
      }
      return { version, key: Buffer.from(hex!, "hex") }
    })
  if (keys.length === 0) throw new Error("TOKEN_ENCRYPTION_KEYS is not set (see .env.example)")
  return keys
}

export function encryptToken(plain: string, keys: readonly TokenKey[]): { ciphertext: string; keyVersion: number } {
  const current = keys[0]
  if (!current) throw new Error("No token encryption key")
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", current.key, iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: `v${current.version}.${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`,
    keyVersion: current.version,
  }
}

export function decryptToken(ciphertext: string, keys: readonly TokenKey[]): string {
  const [v, iv, tag, data] = ciphertext.split(".")
  const version = Number(v?.slice(1))
  const key = keys.find((k) => k.version === version)
  if (!key || !iv || !tag || data === undefined) throw new Error("Can't decrypt token: unknown key or bad format")
  const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}

// ── Sealed values (OAuth state) ──────────────────────────────────────────────
// Signed, not encrypted: `<base64url json>.<hmac>`. Holds no secrets except the PKCE verifier,
// which lives in an httpOnly cookie and is useless without the authorization code.

export function seal(payload: Record<string, unknown>, secret: string, ttlSec: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSec })).toString("base64url")
  const mac = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${mac}`
}

export function unseal<T extends Record<string, unknown>>(token: string, secret: string, now = Date.now()): T | null {
  const [body, mac] = token.split(".")
  if (!body || !mac) return null
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"))
  const given = Buffer.from(mac)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number }
    if (typeof data.exp !== "number" || data.exp < Math.floor(now / 1000)) return null
    return data
  } catch {
    return null
  }
}
