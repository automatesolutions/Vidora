import { upsertModels, type Db } from "@vidora/db"
import { fetchHiggsfieldCatalog } from "@vidora/providers"
import { log } from "./log"

// Refreshes model_registry from Higgsfield's docs (daily in the worker, or `pnpm models:refresh`).
export async function refreshModels(db: Db) {
  const errors: string[] = []
  const entries = await fetchHiggsfieldCatalog({ onError: (url, err) => errors.push(`${url}: ${String(err)}`) })
  // A broken docs build shouldn't wipe or shrink the registry: keep what we have when too little came back.
  if (entries.length < 10) throw new Error(`Model catalog looked incomplete (${entries.length} entries); registry left unchanged.`)
  await upsertModels(db, entries)
  log.info("model registry refreshed", { models: entries.length, errors: errors.length })
  return { models: entries.length, errors }
}

// `pnpm models:refresh`
if (process.argv[1]?.replace(/\\/g, "/").endsWith("/models-refresh.ts")) {
  const { createDb } = await import("@vidora/db")
  const db = createDb(process.env.DATABASE_URL, { max: 1 })
  try {
    const r = await refreshModels(db)
    console.log(`Saved ${r.models} models.${r.errors.length ? ` Skipped ${r.errors.length} pages:\n${r.errors.join("\n")}` : ""}`)
  } finally {
    await db.close()
  }
}
