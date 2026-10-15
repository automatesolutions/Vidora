"use client"

import { YT_TITLE_MAX } from "@vidora/core/youtube"
import { CalendarClock, LoaderCircle, X } from "lucide-react"
import { useId, useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { HashtagInput } from "@/components/vidora/hashtag-input"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { approveVideo, rejectVideo } from "./actions"

// Review details: edit what YouTube shows, pick the posting time, then approve or reject.
export function ReviewForm({
  runId,
  initial,
  timeZone,
  channel,
}: {
  runId: string
  initial: { title: string; description: string; hashtags: string[]; postAt: string }
  timeZone: string
  channel: string | null
}) {
  const titleId = useId()
  const descId = useId()
  const timeId = useId()
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description)
  const [hashtags, setHashtags] = useState(initial.hashtags)
  const [postAt, setPostAt] = useState(initial.postAt)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // "Tue, Oct 20, 6:00 PM" for the button, read as wall-clock time in the campaign's zone.
  const postLabel = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(postAt)
    if (!m) return null
    const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!))
    return d.toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  }, [postAt])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={titleId} className="text-body-sm-strong text-foreground">
          Title
        </label>
        <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={YT_TITLE_MAX} />
        <p className="tabular text-caption text-muted-foreground">
          {title.length} of {YT_TITLE_MAX} characters
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={descId} className="text-body-sm-strong text-foreground">
          Description
        </label>
        <Textarea id={descId} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </div>
      <HashtagInput value={hashtags} onChange={setHashtags} />
      <div className="flex flex-col gap-2">
        <label htmlFor={timeId} className="text-body-sm-strong text-foreground">
          Posting time ({timeZone})
        </label>
        <Input id={timeId} type="datetime-local" value={postAt} onChange={(e) => setPostAt(e.target.value)} className="max-w-64" />
        <p className="text-caption text-muted-foreground">
          {channel ? `Uploads to ${channel} as private now, and YouTube makes it public at this time.` : "No YouTube channel is connected yet, so approving keeps the video ready until you connect one."}{" "}
          Every upload is labeled as AI-generated.
        </p>
      </div>

      {error && <InlineAlert title="This video wasn't approved">{error}</InlineAlert>}

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={pending || !postLabel}
          onClick={() => {
            setError(null)
            start(async () => {
              const r = await approveVideo(runId, { title, description, hashtags, postAt })
              if (r && !r.ok) setError(r.message)
            })
          }}
        >
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <CalendarClock aria-hidden />}
          {postLabel ? `Approve for ${postLabel}` : "Approve"}
        </Button>
        <Button
          variant="tertiary"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Reject this video? We won't post it, and the campaign keeps its schedule.")) return
            start(async () => {
              const r = await rejectVideo(runId)
              if (r && !r.ok) setError(r.message)
            })
          }}
        >
          <X aria-hidden />
          Reject
        </Button>
      </div>
    </div>
  )
}
