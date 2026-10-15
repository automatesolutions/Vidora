import { capabilitiesFromSchema, type ModelInputSchema } from "@vidora/core"
import { and, asc, eq, sql } from "drizzle-orm"
import type { DbOrTx } from "./client"
import { modelRegistry, type CostSample } from "./schema"

// Model registry: one row per Higgsfield endpoint, refreshed from the docs (see @vidora/providers).

export type RegistryEntry = {
  id: string
  provider?: "higgsfield" | "higgsfield_mcp"
  family: string
  displayName: string
  workflow: string
  outputKind: string
  inputSchema: ModelInputSchema
  docsUrl: string
}

/** Inserts or updates entries. Keeps cost samples and the enabled flag across refreshes. */
export async function upsertModels(db: DbOrTx, entries: RegistryEntry[], now = new Date()) {
  for (const e of entries) {
    const caps = capabilitiesFromSchema(e.inputSchema)
    const values = {
      provider: e.provider ?? ("higgsfield" as const),
      family: e.family,
      displayName: e.displayName,
      workflow: e.workflow,
      outputKind: e.outputKind,
      inputSchema: e.inputSchema,
      durations: caps.durations,
      aspectRatios: caps.aspectRatios,
      resolutions: caps.resolutions,
      supportsSeed: caps.supportsSeed,
      needsImage: caps.needsImage,
      verticalFromText: caps.verticalFromText,
      docsUrl: e.docsUrl,
      refreshedAt: now,
    }
    await db
      .insert(modelRegistry)
      .values({ id: e.id, ...values })
      .onConflictDoUpdate({ target: modelRegistry.id, set: values })
  }
}

export async function listModels(db: DbOrTx, filter: { workflow?: string; outputKind?: string } = {}) {
  const where = and(
    eq(modelRegistry.enabled, true),
    filter.workflow ? eq(modelRegistry.workflow, filter.workflow) : undefined,
    filter.outputKind ? eq(modelRegistry.outputKind, filter.outputKind) : undefined
  )
  return db.select().from(modelRegistry).where(where).orderBy(asc(modelRegistry.family), asc(modelRegistry.id))
}

export async function getModel(db: DbOrTx, id: string) {
  const [row] = await db.select().from(modelRegistry).where(eq(modelRegistry.id, id))
  return row ?? null
}

export const costKey = (durationSec: number | string | undefined, resolution: string | undefined) => `${durationSec ?? "-"}|${resolution ?? "-"}`

/** Caches an estimate from Higgsfield's /estimate endpoint on the model row. */
export async function saveCostSample(db: DbOrTx, modelId: string, key: string, sample: CostSample) {
  await db
    .update(modelRegistry)
    .set({ costSamples: sql`${modelRegistry.costSamples} || ${JSON.stringify({ [key]: sample })}::jsonb` })
    .where(eq(modelRegistry.id, modelId))
}
