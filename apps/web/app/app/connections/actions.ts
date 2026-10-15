"use server"

import { ProviderError, tokenKeysFromEnv } from "@vidora/core"
import {
  CredentialFormatError,
  deleteHiggsfieldConnection,
  deleteProviderCredential,
  getDb,
  markCredentialChecked,
  parseHiggsfieldKey,
  saveProviderCredential,
  setProviderBalance,
} from "@vidora/db"
import { HiggsfieldProvider } from "@vidora/providers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { canEdit, getAppSession } from "@/lib/server/session"

export type FormState = { ok: boolean; message: string | null; field?: "apiKey" | "balance" }

async function editor() {
  const s = await getAppSession()
  if (!s) throw new Error("Not signed in")
  if (!canEdit(s)) return null
  return s
}

/**
 * Saves the Higgsfield key (encrypted) and checks it with Higgsfield straight away. The check reads a
 * status that can't exist, so it costs nothing.
 */
export async function saveHiggsfieldKey(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await editor()
  if (!s) return { ok: false, message: "Only owners, admins, and editors can change the API key." }
  const pasted = String(form.get("apiKey") ?? "").trim()
  if (!pasted) return { ok: false, message: "Paste your Higgsfield API key.", field: "apiKey" }

  let raw: string
  try {
    raw = parseHiggsfieldKey(pasted).credentials
  } catch (err) {
    if (err instanceof CredentialFormatError) return { ok: false, message: err.message, field: "apiKey" }
    throw err
  }

  // Check first, so a key Higgsfield rejects never replaces a working one.
  let check: { ok: true } | { ok: false; error: string } | null
  let unreachable = ""
  try {
    check = await new HiggsfieldProvider({ credentials: raw }).verifyCredentials()
  } catch (err) {
    check = null
    unreachable = err instanceof ProviderError ? err.message : "network error"
  }
  if (check && !check.ok) {
    return { ok: false, message: "Higgsfield didn't accept this key. In Higgsfield Console, open API keys, press Copy API key, and paste it here.", field: "apiKey" }
  }

  const db = getDb()
  const row = await saveProviderCredential(db, tokenKeysFromEnv(process.env.TOKEN_ENCRYPTION_KEYS), s.workspaceId, raw)
  if (check) await markCredentialChecked(db, row.id, check)
  revalidatePath("/app/connections")
  return check
    ? { ok: true, message: "Higgsfield accepted your key." }
    : // Saved but unchecked: the worker checks it again before the first run.
      { ok: false, message: `We saved your key but couldn't reach Higgsfield to check it (${unreachable}). Try again in a minute.` }
}

export async function removeHiggsfieldKey(): Promise<FormState> {
  const s = await editor()
  if (!s) return { ok: false, message: "Only owners, admins, and editors can remove the API key." }
  await deleteProviderCredential(getDb(), s.workspaceId)
  revalidatePath("/app/connections")
  return { ok: true, message: "Key removed. Campaigns can't make videos until you add one." }
}

/** Higgsfield's API doesn't report the balance, so the user enters it from the console. */
export async function saveBalance(_prev: FormState, form: FormData): Promise<FormState> {
  const s = await editor()
  if (!s) return { ok: false, message: "Only owners, admins, and editors can update the balance." }
  const value = Number(String(form.get("balance") ?? "").replace(/,/g, "").trim())
  if (!Number.isFinite(value) || value < 0 || value > 100_000_000) return { ok: false, message: "Enter your balance as a number of credits.", field: "balance" }
  await setProviderBalance(getDb(), s.workspaceId, value)
  revalidatePath("/app/connections")
  return { ok: true, message: "Balance updated." }
}

export async function disconnectHiggsfield() {
  const s = await editor()
  if (!s) return
  await deleteHiggsfieldConnection(getDb(), s.workspaceId)
  redirect("/app/connections?higgsfield=disconnected")
}
