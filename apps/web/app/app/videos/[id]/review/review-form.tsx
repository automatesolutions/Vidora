"use client"

import { changeRequestCost, rerunFromStage, type ChangeTarget } from "@vidora/core/credits"
import { VISIBILITIES, YT_DESCRIPTION_MAX, YT_TITLE_MAX, formatPostTime, type Visibility } from "@vidora/core/youtube"
import { ExternalLink, Sparkles, Undo2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ApprovalBar, type Decision } from "@/components/vidora/approval-bar"
import { ChangeRequestSheet } from "@/components/vidora/change-request-sheet"
import { ChoiceCards } from "@/components/vidora/choice-cards"
import { ConnectDialog } from "@/components/vidora/connect-dialog"
import { CoverPicker } from "@/components/vidora/cover-picker"
import { HashtagInput } from "@/components/vidora/hashtag-input"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { PlatformChip } from "@/components/vidora/platform-chip"
import { ShortsFrame } from "@/components/vidora/shorts-frame"
import { StatusPill, type VideoStatus } from "@/components/vidora/status-pill"
import { VISIBILITY_LABELS, creditsLabel } from "@/lib/labels"
import {
  approveAction,
  rejectAction,
  requestChangesAction,
  saveDetailsAction,
  undoApproveAction,
  undoRejectAction,
} from "./actions"

type Job = {
  id: string
  status: string
  revision: number
  title: string
  description: string
  hashtags: string[]
  visibility: Visibility
  madeForKids: boolean
  coverOrdinal: number
  creditsCharged: number
  isFree: boolean
  baseCredits: number
  freeChangesLeft: number
  changeRequestCount: number
}

type Post = { status: string; scheduledAt: string; label: string; externalUrl: string | null; lastError: string | null } | null

/** datetime-local value (browser's time zone) ↔ ISO instant. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const CONNECT_ERRORS: Record<string, string> = {
  denied: "YouTube wasn't connected, so nothing was approved. Approve again when you're ready.",
  no_channel: "That Google account doesn't have a YouTube channel. Create one in YouTube, then connect again.",
  missing_scope: "Google didn't give permission to upload. Connect again and allow uploads.",
  stale: "YouTube is connected, but this video changed while you were away. Check it and approve again.",
  failed: "We couldn't connect YouTube. Try again in a minute.",
}

export function ReviewForm({
  job,
  video,
  frames,
  channel,
  post,
  suggestedPostAt,
  suggestedLabel,
  timeZone,
  audited,
  canReview,
}: {
  job: Job
  video: string | null
  frames: { ordinal: number; url: string; atSec: number }[]
  channel: { displayName: string; avatarUrl: string | null; handle: string | null } | null
  post: Post
  suggestedPostAt: string
  suggestedLabel: string
  timeZone: string
  audited: boolean
  canReview: boolean
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [title, setTitle] = useState(job.title)
  const [description, setDescription] = useState(job.description)
  const [hashtags, setHashtags] = useState(job.hashtags)
  const [visibility, setVisibility] = useState<Visibility>(job.visibility)
  const [madeForKids, setMadeForKids] = useState(job.madeForKids)
  const [cover, setCover] = useState(job.coverOrdinal)
  const [postAt, setPostAt] = useState(suggestedPostAt)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  // Coming back from Google with a problem: show it from the first render.
  const [error, setError] = useState<string | null>(() => {
    const c = params.get("connect")
    return c ? (CONNECT_ERRORS[c] ?? CONNECT_ERRORS.failed!) : null
  })
  const [titleError, setTitleError] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [changesError, setChangesError] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [pending, start] = useTransition()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ids = { title: useId(), desc: useId(), time: useId(), kids: useId(), ai: useId(), titleErr: useId() }

  const editable = canReview && job.status === "pending_approval"
  const details = useCallback(
    () => ({ title: title.trim(), description, hashtags, visibility, madeForKids, coverOrdinal: cover }),
    [title, description, hashtags, visibility, madeForKids, cover]
  )
  const postLabel = formatPostTime(new Date(postAt), browserTz())

  // Autosave (no Save button): fields save shortly after a change, and right away on blur.
  const save = useCallback(
    async (d = details(), at = postAt) => {
      if (!editable) return
      if (!d.title) return setTitleError("Add a title")
      setTitleError(null)
      setSaveState("saving")
      const r = await saveDetailsAction(job.id, d, at)
      setSaveState(r.ok ? "saved" : "error")
      if (!r.ok) setError(r.error)
    },
    [details, editable, job.id, postAt]
  )
  const saveSoon = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(), 800)
  }
  const saveNow = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void save()
  }
  // Radios, switches, chips, and the cover save on change, after state settles.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    saveSoon()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save on these discrete controls only
  }, [hashtags, visibility, madeForKids, cover, postAt])

  // Coming back from Google: finish the story the Approve button started.
  useEffect(() => {
    const approved = params.get("approved")
    const connect = params.get("connect")
    const connected = params.get("connected") ?? params.get("reconnected")
    if (!approved && !connect && !connected) return
    if (params.get("reconnected")) toast.success("YouTube is connected again. We'll try the post again now.")
    else if (connected) toast.success("YouTube is connected.")
    if (approved && post) {
      toast.success(`Approved. Posting ${post.label}.`, {
        duration: Infinity,
        closeButton: true,
        action: { label: "Undo", onClick: () => undo() },
      })
    }
    router.replace(`/app/videos/${job.id}/review`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per return from Google
  }, [])

  function undo() {
    start(async () => {
      const r = await undoApproveAction(job.id)
      if (!r.ok) return void toast.error(r.error, { duration: Infinity, closeButton: true })
      toast("Approval undone. The video is back in your queue.")
      router.refresh()
    })
  }

  function approve() {
    const d = details()
    if (!d.title) return setTitleError("Add a title")
    setError(null)
    start(async () => {
      const r = await approveAction(job.id, d, postAt)
      if (!r.ok) {
        if (r.needsConnection) {
          // Save first, so the details are already there when Google sends the creator back.
          await saveDetailsAction(job.id, d, postAt)
          return setConnectOpen(true)
        }
        return setError(r.error)
      }
      toast.success(`Approved. Posting ${formatPostTime(new Date(r.postAt), browserTz())}.`, {
        duration: Infinity,
        closeButton: true,
        action: { label: "Undo", onClick: () => undo() },
      })
      router.refresh()
    })
  }

  const onDecision = useCallback(
    (d: Decision) => {
      if (d === "approve") approve()
      if (d === "reject") setRejectOpen(true)
      if (d === "changes") setChangesOpen(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- approve reads the latest state when called
    [details, postAt]
  )

  const changeCost = (targets: ChangeTarget[]) => {
    if (job.freeChangesLeft > 0) return `Free. ${job.freeChangesLeft} free ${job.freeChangesLeft === 1 ? "change" : "changes"} left.`
    if (targets.length === 0) return "Pick what to redo to see the cost."
    return `${creditsLabel(changeRequestCost(job.baseCredits, rerunFromStage(targets), job.changeRequestCount))} for this change.`
  }

  const connectHref = `/api/connect/youtube/start?${new URLSearchParams({ job: job.id, postAt }).toString()}`
  const shortcuts = editable && !rejectOpen && !changesOpen && !connectOpen

  return (
    <div className="grid gap-8 pb-28 md:pb-0 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-12">
      <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <ShortsFrame
          src={video}
          poster={frames.find((f) => f.ordinal === cover)?.url ?? null}
          title={title || "Untitled video"}
          channel={channel ? { name: channel.displayName, avatarUrl: channel.avatarUrl } : null}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={job.status as VideoStatus} />
            <PlatformChip platform="youtube" account={channel?.handle ?? channel?.displayName ?? "not connected"} />
            {job.revision > 1 && <span className="text-caption text-muted-foreground">Version {job.revision}</span>}
          </div>
          <h1 className="font-display text-display-md">{editable ? "Review your video" : (title || "Your video")}</h1>
          {editable && <p className="text-body-md text-muted-foreground">Check the video and the details. Nothing posts until you approve it.</p>}
        </div>

        <StatusBanner job={job} post={post} onUndo={undo} pending={pending} canReview={canReview} />
        {error && <InlineAlert title="That didn't work">{error}</InlineAlert>}

        <section aria-label="YouTube details" className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label htmlFor={ids.title} className="text-body-sm-strong text-foreground">
              Title
            </label>
            <Input
              id={ids.title}
              value={title}
              maxLength={YT_TITLE_MAX}
              disabled={!editable}
              aria-invalid={titleError ? true : undefined}
              aria-describedby={titleError ? ids.titleErr : undefined}
              onChange={(e) => {
                setTitle(e.target.value)
                saveSoon()
              }}
              onBlur={saveNow}
            />
            <div className="flex justify-between text-caption text-muted-foreground">
              {titleError ? (
                <p id={ids.titleErr} className="text-body-sm text-danger">
                  {titleError}
                </p>
              ) : (
                <span />
              )}
              <span className="tabular">
                {title.length}/{YT_TITLE_MAX}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={ids.desc} className="text-body-sm-strong text-foreground">
              Description
            </label>
            <Textarea
              id={ids.desc}
              rows={4}
              value={description}
              maxLength={YT_DESCRIPTION_MAX - 200}
              disabled={!editable}
              onChange={(e) => {
                setDescription(e.target.value)
                saveSoon()
              }}
              onBlur={saveNow}
            />
          </div>

          <HashtagInput value={hashtags} onChange={setHashtags} disabled={!editable} />

          <CoverPicker frames={frames} value={cover} onChange={setCover} disabled={!editable} />

          <div className="flex flex-col gap-2">
            <ChoiceCards
              name="visibility"
              legend="Visibility"
              columns={3}
              size="sm"
              value={visibility}
              onChange={(v) => editable && setVisibility(v)}
              options={VISIBILITIES.map((v) => ({ value: v, label: VISIBILITY_LABELS[v].label }))}
            />
            <p className="text-caption text-muted-foreground">
              {VISIBILITY_LABELS[visibility].description}
              {!audited && visibility !== "private" && " For now, it uploads as Private while Google reviews Vidora. You can change it in YouTube Studio."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={ids.time} className="text-body-sm-strong text-foreground">
              Post time
            </label>
            <Input
              id={ids.time}
              type="datetime-local"
              disabled={!editable}
              value={toLocalInput(postAt)}
              min={toLocalInput(new Date().toISOString())}
              onChange={(e) => e.target.value && setPostAt(new Date(e.target.value).toISOString())}
              className="w-full sm:w-72"
            />
            <p className="text-caption text-muted-foreground">
              Suggested: {suggestedLabel} ({timeZone.replace(/_/g, " ")}), when Shorts usually get the most views.
            </p>
          </div>

          <div className="flex flex-col gap-4 rounded-md bg-card p-4">
            <div className="flex items-center gap-4">
              <div className="flex flex-1 flex-col gap-0.5">
                <label htmlFor={ids.kids} className="text-body-sm-strong text-foreground">
                  Made for kids
                </label>
                <p className="text-body-sm text-muted-foreground">YouTube requires this answer. Turn it on only if kids are the main audience.</p>
              </div>
              <Switch id={ids.kids} checked={madeForKids} disabled={!editable} onCheckedChange={setMadeForKids} />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-1 flex-col gap-0.5">
                <label htmlFor={ids.ai} className="text-body-sm-strong text-foreground">
                  AI-generated label
                </label>
                <p className="text-body-sm text-muted-foreground">Always on. YouTube shows viewers that this video was made with AI.</p>
              </div>
              <Switch id={ids.ai} checked disabled aria-readonly />
            </div>
          </div>

          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-body-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Credits used</dt>
              <dd className="tabular text-foreground">{job.isFree && job.creditsCharged === 0 ? "Free (your first video)" : creditsLabel(job.creditsCharged)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Free changes left</dt>
              <dd className="tabular text-foreground">{job.freeChangesLeft}</dd>
            </div>
          </dl>
          <p role="status" aria-live="polite" className="text-caption text-muted-foreground">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
          </p>
        </section>

        {editable && (
          <>
            <ApprovalBar scheduledLabel={postLabel} onDecision={onDecision} shortcuts={shortcuts} disabled={pending} className="max-md:hidden" />
            <div className="safe-x fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background md:hidden">
              <ApprovalBar layout="mobile" scheduledLabel={postLabel} onDecision={onDecision} disabled={pending} />
            </div>
          </>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reject this video?</DialogTitle>
            <DialogDescription>We won&apos;t post it, and it won&apos;t use more credits.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 sm:justify-end">
            <Button variant="tertiary" onClick={() => setRejectOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await rejectAction(job.id)
                  setRejectOpen(false)
                  if (!r.ok) return setError(r.error)
                  toast("Video rejected.", {
                    duration: Infinity,
                    closeButton: true,
                    action: {
                      label: "Undo",
                      onClick: () =>
                        start(async () => {
                          const u = await undoRejectAction(job.id)
                          if (!u.ok) return void toast.error(u.error)
                          router.refresh()
                        }),
                    },
                  })
                  router.refresh()
                })
              }
            >
              Reject video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangeRequestSheet
        open={changesOpen}
        onOpenChange={setChangesOpen}
        costLabel={changeCost}
        pending={pending}
        error={changesError}
        onSend={(targets, text) =>
          start(async () => {
            setChangesError(null)
            const r = await requestChangesAction(job.id, targets, text)
            if (!r.ok) return setChangesError(r.error)
            setChangesOpen(false)
            toast(`Got it. We're making version ${job.revision + 1}.`)
            router.push(`/app/videos/${job.id}`)
          })
        }
      />

      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} connectHref={connectHref} postLabel={postLabel} audited={audited} />
    </div>
  )
}

function StatusBanner({ job, post, onUndo, pending, canReview }: { job: Job; post: Post; onUndo: () => void; pending: boolean; canReview: boolean }) {
  if (job.status === "scheduled" || job.status === "approved") {
    return (
      <InlineAlert
        tone="success"
        title={`Approved. Posting ${post?.label ?? "soon"}.`}
        action={
          canReview && (
            <Button variant="tertiary" size="sm" disabled={pending} onClick={onUndo}>
              <Undo2 aria-hidden />
              Undo approval
            </Button>
          )
        }
      >
        We upload it to YouTube at that time.
      </InlineAlert>
    )
  }
  if (job.status === "publishing") return <InlineAlert tone="info" title="Uploading to YouTube now" />
  if (job.status === "published") {
    return (
      <InlineAlert
        tone="success"
        title="Posted to YouTube"
        action={
          post?.externalUrl && (
            <Button variant="tertiary" size="sm" asChild>
              <a href={post.externalUrl} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                Watch on YouTube
              </a>
            </Button>
          )
        }
      />
    )
  }
  if (job.status === "publish_failed" || job.status === "partially_published") {
    const reauth = post?.status === "needs_reauth"
    return (
      <InlineAlert
        title={reauth ? "We couldn't post to YouTube. Your YouTube login expired." : "We couldn't post to YouTube."}
        action={
          reauth && (
            <Button variant="tertiary" size="sm" asChild>
              <a href={`/api/connect/youtube/start?job=${job.id}&reconnect=1`}>Reconnect YouTube</a>
            </Button>
          )
        }
      >
        {reauth ? "Reconnect, and we'll try again." : (post?.lastError ?? "We'll try again automatically.")}
      </InlineAlert>
    )
  }
  if (job.status === "rejected") {
    return (
      <InlineAlert
        tone="info"
        title="You rejected this video"
        action={
          <Button variant="tertiary" size="sm" asChild>
            <Link href="/app/new">
              <Sparkles aria-hidden />
              Make another video
            </Link>
          </Button>
        }
      >
        It won&apos;t post.
      </InlineAlert>
    )
  }
  if (job.status === "pending_approval" && !canReview) {
    return <InlineAlert tone="info" title="Waiting for review">Viewers can watch videos, but a reviewer approves them.</InlineAlert>
  }
  return null
}

