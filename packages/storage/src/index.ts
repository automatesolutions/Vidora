import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// Object storage: Cloudflare R2 in production, MinIO (compose `dev` profile) locally. Both speak S3.
// Keys are `<workspaceId>/...` so a key always says which workspace owns it. Browsers only ever get
// short-lived signed URLs; the bucket is private.

export type StorageEnv = {
  STORAGE_ENDPOINT: string // https://<account>.r2.cloudflarestorage.com, or http://localhost:9000 for MinIO
  STORAGE_BUCKET: string
  STORAGE_ACCESS_KEY_ID: string
  STORAGE_SECRET_ACCESS_KEY: string
  STORAGE_REGION?: string // "auto" for R2
  STORAGE_FORCE_PATH_STYLE?: string // "true" for MinIO
}

export function storageEnvFrom(env: Record<string, string | undefined>): StorageEnv {
  const need = (k: keyof StorageEnv) => {
    const v = env[k]
    if (!v) throw new Error(`${k} is not set (see .env.example)`)
    return v
  }
  return {
    STORAGE_ENDPOINT: need("STORAGE_ENDPOINT"),
    STORAGE_BUCKET: need("STORAGE_BUCKET"),
    STORAGE_ACCESS_KEY_ID: need("STORAGE_ACCESS_KEY_ID"),
    STORAGE_SECRET_ACCESS_KEY: need("STORAGE_SECRET_ACCESS_KEY"),
    STORAGE_REGION: env.STORAGE_REGION ?? "auto",
    STORAGE_FORCE_PATH_STYLE: env.STORAGE_FORCE_PATH_STYLE,
  }
}

export function createStorage(env: StorageEnv) {
  const client = new S3Client({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION ?? "auto",
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: env.STORAGE_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY },
    // R2 rejects the newer default checksum headers on presigned PUTs.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
  const Bucket = env.STORAGE_BUCKET

  return {
    /**
     * Signed PUT for a browser upload. R2 has no POST policies, so size and type are fixed by signing
     * Content-Length and Content-Type; the upload is checked again after it lands (see `inspect`).
     */
    presignPut(key: string, opts: { mime: string; bytes: number; expiresSec?: number }) {
      return getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: opts.mime, ContentLength: opts.bytes }), {
        expiresIn: opts.expiresSec ?? 300,
        signableHeaders: new Set(["content-type", "content-length"]),
      })
    },

    presignGet(key: string, opts: { expiresSec?: number; downloadName?: string } = {}) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ...(opts.downloadName ? { ResponseContentDisposition: `attachment; filename="${opts.downloadName}"` } : {}),
        }),
        { expiresIn: opts.expiresSec ?? 900 }
      )
    },

    /** Size, declared type, and the first bytes (for a magic-number check). Null when the object is missing. */
    async inspect(key: string): Promise<{ bytes: number; mime: string | undefined; head: Uint8Array } | null> {
      try {
        const meta = await client.send(new HeadObjectCommand({ Bucket, Key: key }))
        const first = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: "bytes=0-31" }))
        const head = first.Body ? await first.Body.transformToByteArray() : new Uint8Array()
        return { bytes: meta.ContentLength ?? 0, mime: meta.ContentType, head }
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    },

    async get(key: string): Promise<GetObjectCommandOutput> {
      return client.send(new GetObjectCommand({ Bucket, Key: key }))
    },

    async put(key: string, body: Uint8Array | string, mime: string) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: mime }))
    },

    client,
    bucket: Bucket,
  }
}
export type Storage = ReturnType<typeof createStorage>

function isNotFound(err: unknown) {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404
}

/** Checks the file's first bytes, so a renamed .exe can't pass as a photo. Returns the real type or null. */
export function sniffImageType(head: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  const b = head
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png"
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp"
  return null
}

/** Sample files the stub pipeline points at (seeded by `pnpm storage:seed`). Real videos replace them in G2. */
export const SAMPLE_KEYS = {
  video: (lengthSec: number) => `samples/short-${lengthSec}s.mp4`,
  frame: (lengthSec: number, i: number) => `samples/short-${lengthSec}s-frame-${i}.jpg`,
  frames: 6,
}
