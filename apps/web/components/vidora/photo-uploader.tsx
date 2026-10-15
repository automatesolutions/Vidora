"use client"

import { ImageUp, LoaderCircle, RefreshCw, X } from "lucide-react"
import { useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { cn } from "@/lib/utils"

// ⊕ Photo uploader: browser → storage with a signed PUT, then the server checks the file.
// States: empty, uploading (with progress), ready (preview), error (what happened + try again).

export type UploadedPhoto = { id: string; previewUrl: string; name: string }

const TYPES = "image/jpeg,image/png,image/webp"

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("content-type", file.type)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)))
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."))
    xhr.send(file)
  })
}

export function PhotoUploader({
  purpose,
  label,
  hint,
  value,
  onChange,
  maxMb,
}: {
  purpose: "input" | "logo"
  label: string
  hint: string
  value: UploadedPhoto | null
  onChange: (photo: UploadedPhoto | null) => void
  maxMb: number
}) {
  const inputId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    if (!TYPES.split(",").includes(file.type)) return setError("Choose a JPG, PNG, or WebP image.")
    if (file.size > maxMb * 1024 * 1024) return setError(`Choose an image under ${maxMb} MB.`)
    setProgress(0)
    try {
      const start = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose, mime: file.type, bytes: file.size }),
      })
      const s = await start.json()
      if (!start.ok) throw new Error(s.error ?? "We couldn't start the upload.")
      await putWithProgress(s.uploadUrl, file, setProgress)
      const done = await fetch(`/api/uploads/${s.id}/complete`, { method: "POST" })
      const d = await done.json()
      if (!done.ok) throw new Error(d.error ?? "We couldn't check the upload.")
      onChange({ id: s.id, previewUrl: d.previewUrl, name: file.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload didn't finish.")
    } finally {
      setProgress(null)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const uploading = progress !== null

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-body-sm-strong text-foreground">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={TYPES}
        aria-describedby={hintId}
        className="sr-only"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
        }}
      />

      {value ? (
        <div className="flex items-center gap-4 rounded-md bg-card p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, not optimizable */}
          <img src={value.previewUrl} alt="" className="size-20 shrink-0 rounded-sm object-cover" />
          <p className="min-w-0 flex-1 truncate text-body-sm text-foreground">{value.name}</p>
          <Button variant="text" size="sm" onClick={() => inputRef.current?.click()}>
            <RefreshCw aria-hidden />
            Replace
          </Button>
          <Button variant="text" size="icon" aria-label={`Remove ${value.name}`} onClick={() => onChange(null)}>
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-describedby={hintId}
          className={cn(
            "flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-foreground/40 bg-background p-6 text-center transition-colors hover:bg-muted",
            uploading && "cursor-wait"
          )}
        >
          {uploading ? (
            <LoaderCircle aria-hidden className="size-6 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
          ) : (
            <ImageUp aria-hidden className="size-6" strokeWidth={1.75} />
          )}
          <span className="text-body-sm-strong text-foreground">{uploading ? `Uploading ${progress}%` : "Choose a photo"}</span>
          <span className="text-caption text-muted-foreground">JPG, PNG, or WebP, up to {maxMb} MB</span>
        </button>
      )}
      <p id={hintId} className="text-body-sm text-muted-foreground">
        {hint}
      </p>
      <div aria-live="polite" className="sr-only">
        {uploading ? `Uploading, ${progress} percent` : value ? "Photo uploaded" : ""}
      </div>
      {error && (
        <InlineAlert title="The photo didn't upload">
          {error}
        </InlineAlert>
      )}
    </div>
  )
}
