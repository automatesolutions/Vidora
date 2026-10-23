// A safety net for messages stored on runs and campaigns: customers never see which services make
// the videos. Messages that name one (older runs, provider error text) are replaced with a plain line.

const SERVICE_NAMES = /higgsfield|kling|seedance|elevenlabs|eleven labs|anthropic|claude|fal\.ai|kie\.ai|api[_ ]key/i

export const GENERIC_FAILURE = "This video couldn't be finished. Your next scheduled video runs as usual."

export function customerText(message: string | null | undefined, fallback = GENERIC_FAILURE) {
  if (!message) return null
  return SERVICE_NAMES.test(message) ? fallback : message
}
