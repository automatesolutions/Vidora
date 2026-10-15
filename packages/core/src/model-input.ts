// Builds a provider request body from a model's own JSON schema (stored in `model_registry`), so each
// model gets exactly the fields it documents. Nothing here assumes one schema for every model.

export type JsonSchemaProp = {
  type?: string | string[]
  enum?: (string | number)[]
  default?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
  format?: string
  items?: unknown
}
export type ModelInputSchema = { type?: "object"; required?: string[]; properties: Record<string, JsonSchemaProp> }

/** What a campaign run asks for, independent of the model. */
export type GenerationIntent = {
  prompt: string
  negativePrompt?: string
  durationSec: number
  aspectRatio: "9:16" | "16:9" | "1:1"
  resolution?: "480p" | "720p" | "1080p"
  seed?: number
  imageUrl?: string // image-to-video
  /** Our Shorts carry their own voiceover and music, so native model audio is off by default. */
  nativeAudio?: boolean
}

export class ModelInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ModelInputError"
  }
}

const RESOLUTION_ORDER = ["480p", "540p", "720p", "768p", "1080p", "1440p", "2160p", "4k"]

/** Capabilities read from the schema; stored on the registry row for filtering and cost estimates. */
export function capabilitiesFromSchema(schema: ModelInputSchema) {
  const p = schema.properties ?? {}
  const durations = durationOptions(p.duration)
  return {
    durations,
    aspectRatios: (p.aspect_ratio?.enum ?? []).map(String),
    resolutions: (p.resolution?.enum ?? []).map(String),
    supportsSeed: "seed" in p,
    supportsNegativePrompt: "negative_prompt" in p,
    needsImage: (schema.required ?? []).includes("image_url"),
    acceptsImage: "image_url" in p,
    // Vertical from a prompt alone needs an aspect_ratio setting; image models take the input image's shape.
    verticalFromText: (p.aspect_ratio?.enum ?? []).map(String).includes("9:16"),
    promptMaxChars: p.prompt?.maxLength ?? null,
  }
}

function durationOptions(prop: JsonSchemaProp | undefined): number[] {
  if (!prop) return []
  if (prop.enum) return prop.enum.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  if (prop.minimum !== undefined && prop.maximum !== undefined) {
    const out: number[] = []
    for (let s = Math.ceil(prop.minimum); s <= prop.maximum; s++) out.push(s)
    return out
  }
  return typeof prop.default === "number" ? [prop.default] : []
}

/** The allowed duration closest to what was asked, preferring longer (a scene can be trimmed, not stretched). */
export function pickDuration(prop: JsonSchemaProp | undefined, wantSec: number): number | string | undefined {
  if (!prop) return undefined
  const options = durationOptions(prop)
  if (options.length === 0) return undefined
  const atLeast = options.find((d) => d >= wantSec)
  const chosen = atLeast ?? options[options.length - 1]!
  // Some models type duration as a string enum ("5", "10").
  const stringy = prop.type === "string" || (prop.enum && typeof prop.enum[0] === "string")
  return stringy ? String(chosen) : chosen
}

function pickResolution(prop: JsonSchemaProp | undefined, want: string | undefined) {
  const options = (prop?.enum ?? []).map(String)
  if (options.length === 0) return undefined
  if (want && options.includes(want)) return want
  // Otherwise the highest that doesn't exceed 1080p (we export 1080x1920), else the default.
  const ok = options.filter((r) => RESOLUTION_ORDER.indexOf(r) !== -1 && RESOLUTION_ORDER.indexOf(r) <= RESOLUTION_ORDER.indexOf("1080p"))
  return ok.sort((a, b) => RESOLUTION_ORDER.indexOf(b) - RESOLUTION_ORDER.indexOf(a))[0] ?? (prop?.default as string | undefined)
}

/**
 * Request body for one model. Throws ModelInputError when the model can't do what the intent needs
 * (no vertical output, needs an image we don't have, a required field we can't fill).
 */
export function buildModelInput(schema: ModelInputSchema, intent: GenerationIntent): Record<string, unknown> {
  const p = schema.properties ?? {}
  const body: Record<string, unknown> = {}

  if (p.prompt) body.prompt = p.prompt.maxLength ? intent.prompt.slice(0, p.prompt.maxLength) : intent.prompt
  if (p.negative_prompt && intent.negativePrompt) body.negative_prompt = intent.negativePrompt

  const duration = pickDuration(p.duration, intent.durationSec)
  if (duration !== undefined) body.duration = duration

  if (p.aspect_ratio) {
    const options = (p.aspect_ratio.enum ?? []).map(String)
    if (options.length && !options.includes(intent.aspectRatio)) {
      throw new ModelInputError(`This model can't make ${intent.aspectRatio} video (it supports ${options.join(", ")}).`)
    }
    body.aspect_ratio = intent.aspectRatio
  } else if (!intent.imageUrl && intent.aspectRatio !== "16:9" && !(schema.required ?? []).includes("image_url")) {
    // (A model that requires an image reports the missing image below instead.)
    // No aspect ratio setting and no input image to take the shape from: the output is landscape.
    throw new ModelInputError(`This model can't be set to ${intent.aspectRatio} without an input image.`)
  }

  const resolution = pickResolution(p.resolution, intent.resolution)
  if (resolution) body.resolution = resolution

  if (p.seed && intent.seed !== undefined) {
    const min = p.seed.minimum ?? 0
    const max = p.seed.maximum ?? 2_147_483_647
    body.seed = min + (Math.abs(Math.trunc(intent.seed)) % (max - min + 1))
  }

  if (intent.imageUrl) {
    if (!p.image_url) throw new ModelInputError("This model doesn't take an input image.")
    body.image_url = intent.imageUrl
  }

  // Native audio off unless asked for: the Short gets its own voiceover and music.
  if (p.sound?.enum?.includes("off")) body.sound = intent.nativeAudio ? "on" : "off"
  if (p.generate_audio && (p.generate_audio.type === "boolean" || p.generate_audio.default !== undefined)) body.generate_audio = !!intent.nativeAudio

  for (const field of schema.required ?? []) {
    if (body[field] === undefined) throw new ModelInputError(`This model needs "${field}", which this campaign doesn't provide.`)
  }
  return body
}
