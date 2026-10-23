import {
  APIError,
  AuthenticationError,
  BadInputError,
  config,
  CredentialsMissedError,
  higgsfield,
  NotEnoughCreditsError,
  TimeoutError,
  ValidationError,
  type V2Response,
} from "@higgsfield/client/v2"

// Seedance 2.5 text-to-video through the official Higgsfield SDK (server-side only).
//   pnpm seedance:example
// Reads HF_CREDENTIALS ("key-id:key-secret") from .env.local at runtime. The value is never printed,
// logged, or sent anywhere but Higgsfield's API.
// Exits 0 only when Higgsfield returns a finished video URL; any other outcome exits 1.

const MODEL = "bytedance/seedance-2.5/text-to-video"

const credentials = process.env.HF_CREDENTIALS?.trim()
if (!credentials || !/^[^:\s]+:[^:\s]+$/.test(credentials)) {
  console.error("HF_CREDENTIALS is missing or isn't in key-id:key-secret format. Add it to .env.local (it's ignored by Git).")
  process.exit(1)
}

// Video takes longer than the SDK's default 5-minute polling limit. The SDK only stops polling on
// completed, failed, or nsfw, so a canceled request ends in a TimeoutError here.
config({ credentials, pollInterval: 5_000, maxPollTime: 15 * 60_000 })

/** What to tell the user for each outcome. Only "completed" with a URL counts as success. */
function report(result: V2Response): number {
  // The API can also report "canceled", which the SDK's status type doesn't list.
  const status = result.status as V2Response["status"] | "canceled"
  switch (status) {
    case "completed":
      if (result.video?.url) {
        console.log(`Video ready (request ${result.request_id}):\n${result.video.url}`)
        return 0
      }
      console.error(`Higgsfield marked request ${result.request_id} completed but returned no video URL.`)
      return 1
    case "nsfw":
      console.error(`Request ${result.request_id} was blocked by content moderation. No video was produced.`)
      return 1
    case "failed":
      console.error(`Request ${result.request_id} failed. No video was produced.`)
      return 1
    case "canceled":
      console.error(`Request ${result.request_id} was canceled. No video was produced.`)
      return 1
    default:
      console.error(`Request ${result.request_id} ended with status "${status}" and no video.`)
      return 1
  }
}

/** One line per error, without request details (they can include the Authorization header). */
function describe(err: unknown): string {
  if (err instanceof CredentialsMissedError || err instanceof AuthenticationError) return "Higgsfield rejected the credentials. Check HF_CREDENTIALS in .env.local."
  if (err instanceof NotEnoughCreditsError) return "Not enough API credits. Top up at console.higgsfield.ai."
  if (err instanceof ValidationError || err instanceof BadInputError) return `Higgsfield rejected the input: ${err.message}`
  if (err instanceof TimeoutError) return "The video didn't finish within 15 minutes (it may have been canceled). Check the request in the Higgsfield console."
  if (err instanceof APIError) return `Higgsfield API error${err.statusCode ? ` (HTTP ${err.statusCode})` : ""}.`
  return `Unexpected error: ${err instanceof Error ? err.name : "unknown"}.`
}

try {
  console.log(`Submitting to ${MODEL} and waiting for the video…`)
  const result = await higgsfield.subscribe(MODEL, {
    input: {
      prompt: "A cinematic scene at sunset",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "9:16", // vertical, for YouTube Shorts and Facebook Reels
    },
    withPolling: true,
  })
  process.exitCode = report(result)
} catch (err) {
  console.error(describe(err))
  process.exitCode = 1
}
