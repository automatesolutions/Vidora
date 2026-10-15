import { randomBytes } from "node:crypto"

// Prefixed, time-sortable IDs (ULID layout: 48-bit ms time + 80 random bits, Crockford base32).
// Example: gen_01J9ZQ3K8V7W2M4N6P8R0T2V4X
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export const ID_PREFIX = {
  workspace: "ws",
  member: "mem",
  account: "acct", // YouTube connection
  credential: "cred", // provider API key (Higgsfield)
  campaign: "cmp",
  schedule: "sch",
  run: "run",
  runEvent: "rev",
  generation: "gen",
  video: "vid",
  fingerprint: "vfp",
  asset: "ast",
  upload: "upl",
  uploadLog: "ulog",
  spend: "spd",
  snapshot: "snap",
  notification: "ntf",
  brandKit: "bk",
  // Better Auth models (see packages/db/src/auth-adapter.ts)
  user: "usr",
  session: "ses",
  authAccount: "acc",
  verification: "ver",
  invitation: "inv",
  authOther: "ba", // any other Better Auth model a plugin adds
} as const

export type IdKind = keyof typeof ID_PREFIX

function encodeTime(ms: number) {
  let out = ""
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[ms % 32] + out
    ms = Math.floor(ms / 32)
  }
  return out
}

function encodeRandom() {
  const bytes = randomBytes(10)
  let bits = 0n
  for (const b of bytes) bits = (bits << 8n) | BigInt(b)
  let out = ""
  for (let i = 0; i < 16; i++) {
    out = ALPHABET[Number(bits & 31n)] + out
    bits >>= 5n
  }
  return out
}

export function newId(kind: IdKind, now = Date.now()) {
  return `${ID_PREFIX[kind]}_${encodeTime(now)}${encodeRandom()}`
}
