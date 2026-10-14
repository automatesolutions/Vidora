"use client"

import { SHORTS_TAG, YT_HASHTAGS_MAX, normalizeHashtags } from "@vidora/core/youtube"
import { Lock, X } from "lucide-react"
import { useId, useState } from "react"
import { Input } from "@/components/ui/input"

// ⊕ Hashtag input: chips plus a text field. Enter, comma, or space adds a tag. #Shorts is always first and locked.

export function HashtagInput({
  value,
  onChange,
  onCommit,
  disabled,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  onCommit?: () => void
  disabled?: boolean
}) {
  const id = useId()
  const hintId = useId()
  const [text, setText] = useState("")
  const tags = normalizeHashtags(value)
  const own = tags.filter((t) => t !== SHORTS_TAG)

  function add(raw: string) {
    const next = normalizeHashtags([...own, ...raw.split(/[\s,]+/)])
    onChange(next)
    setText("")
    onCommit?.()
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-sm-strong text-foreground">
        Hashtags
      </label>
      <ul className="flex flex-wrap gap-2" aria-label="Hashtags on this video">
        <li className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-body-sm text-secondary-foreground">
          <Lock aria-hidden className="size-3.5" strokeWidth={1.75} />
          {SHORTS_TAG}
          <span className="sr-only">, always added</span>
        </li>
        {own.map((t) => (
          <li key={t} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-muted pl-3 text-body-sm text-foreground">
            {t}
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove ${t}`}
              onClick={() => {
                onChange(own.filter((x) => x !== t))
                onCommit?.()
              }}
              className="flex size-9 items-center justify-center rounded-full hover:bg-border/60"
            >
              <X aria-hidden className="size-4" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
      {tags.length < YT_HASHTAGS_MAX && (
        <Input
          id={id}
          value={text}
          disabled={disabled}
          aria-describedby={hintId}
          placeholder="Add a hashtag"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === "," || e.key === " ") && text.trim()) {
              e.preventDefault()
              add(text)
            }
            if (e.key === "Backspace" && !text && own.length) onChange(own.slice(0, -1))
          }}
          onBlur={() => text.trim() && add(text)}
        />
      )}
      <p id={hintId} className="text-caption text-muted-foreground">
        Up to {YT_HASHTAGS_MAX}, including {SHORTS_TAG}. They go at the end of the description.
      </p>
    </div>
  )
}
