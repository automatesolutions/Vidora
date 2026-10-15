// Creates the bucket (local dev), sets browser CORS, and uploads the stub pipeline's sample video and frames.
// Usage: pnpm storage:seed   (reads the root .env). Safe to run again.
// On R2, create the bucket in the dashboard; this script then only sets CORS and uploads the samples.
import { CreateBucketCommand, HeadBucketCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createStorage, SAMPLE_KEYS, storageEnvFrom } from "./index"

const storage = createStorage(storageEnvFrom(process.env))
const { client, bucket } = storage

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
} catch {
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  console.log(`created bucket ${bucket}`)
}

// Browsers PUT uploads straight to storage and play videos from signed URLs.
const origin = (process.env.APP_URL ?? "http://localhost:3010").replace(/\/$/, "")
try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          { AllowedOrigins: [origin], AllowedMethods: ["GET", "PUT", "HEAD"], AllowedHeaders: ["content-type"], ExposeHeaders: ["etag"], MaxAgeSeconds: 3600 },
        ],
      },
    })
  )
  console.log(`CORS allows ${origin}`)
} catch (err) {
  console.warn(`Couldn't set CORS (${String(err)}). On R2, set it in the bucket settings.`)
}

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../infra/samples")
for (const len of [8, 15]) {
  await storage.put(SAMPLE_KEYS.video(len), await readFile(path.join(samples, `short-${len}s.mp4`)), "video/mp4")
  for (let i = 0; i < SAMPLE_KEYS.frames; i++) {
    await storage.put(SAMPLE_KEYS.frame(len, i), await readFile(path.join(samples, `short-${len}s-frame-${i}.jpg`)), "image/jpeg")
  }
}
console.log("uploaded sample videos and frames")
