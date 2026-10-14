"use client"

import {
  BRAND_COLORS_MAX,
  CAPTION_STYLES,
  CREATOR_KINDS,
  END_CARD_TEXT_MAX,
  LOOKS,
  TOPIC_MAX,
  VIDEO_TYPES,
  VOICE_LANGUAGES,
  VOICES,
  VideoBriefSchema,
  type CreatorKind,
  type VideoBrief,
  type VideoType,
} from "@vidora/core/brief"
import { creditsForNewVideo } from "@vidora/core/credits"
import {
  ArrowRight,
  Briefcase,
  Building2,
  Camera,
  Lightbulb,
  LoaderCircle,
  MailCheck,
  Quote,
  ShoppingBag,
  Sparkles,
  UserRound,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ChoiceCards } from "@/components/vidora/choice-cards"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { PhotoUploader, type UploadedPhoto } from "@/components/vidora/photo-uploader"
import { WizardShell } from "@/components/vidora/wizard-shell"
import { authClient } from "@/lib/auth-client"
import {
  CAPTION_LABELS,
  CREATOR_KIND_LABELS,
  LANGUAGE_LABELS,
  LENGTH_LABELS,
  LOOK_LABELS,
  VIDEO_TYPE_LABELS,
  VOICE_LABELS,
  creditsLabel,
} from "@/lib/labels"
import { createVideo, saveBrandKitAction } from "./actions"

type Step = "who" | "type" | "input" | "style" | "review"
type BrandKitDraft = { logo: UploadedPhoto | null; colors: string[]; endCardText: string }

type Draft = Omit<VideoBrief, "creator_kind" | "video_type"> & {
  creator_kind: CreatorKind | null
  video_type: VideoType | null
  photo: UploadedPhoto | null
}

const KIND_ICONS = { creator: UserRound, business: Building2, agency: Briefcase } as const
const TYPE_ICONS = { fact_tip: Lightbulb, product_showcase: ShoppingBag, photo_to_life: Camera, quote: Quote } as const
const DRAFT_KEY = "vidora:new-video-draft"

const emptyDraft = (kind: CreatorKind | null): Draft => ({
  creator_kind: kind,
  video_type: null,
  topic: "",
  source_url: null,
  photo_upload_id: null,
  photo: null,
  no_people_confirmed: false,
  look: "cinematic",
  voice: "friendly",
  language: "en",
  captions_style: "bold_words",
  length_sec: 15,
  use_brand_kit: false,
})

/** The draft and the step the creator was on, saved per tab (survives a reload and the email link). */
function loadDraft(kind: CreatorKind | null): { draft: Draft; step: Step | null } {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { draft?: Partial<Draft>; step?: Step }
      return { draft: { ...emptyDraft(kind), ...saved.draft, ...(kind ? { creator_kind: kind } : {}) }, step: saved.step ?? null }
    }
  } catch {
    // Private mode, blocked storage, or an old format: start fresh.
  }
  return { draft: emptyDraft(kind), step: null }
}

function toBrief(d: Draft): unknown {
  const rest: Partial<Draft> = { ...d }
  delete rest.photo
  const needsTopic = d.video_type === "fact_tip" || d.video_type === "quote"
  return {
    ...rest,
    topic: d.topic?.trim() ? d.topic.trim() : needsTopic ? "" : null,
    source_url: d.video_type === "product_showcase" && d.source_url?.trim() ? d.source_url.trim() : null,
    photo_upload_id: d.video_type === "product_showcase" || d.video_type === "photo_to_life" ? (d.photo?.id ?? null) : null,
    no_people_confirmed: d.video_type === "photo_to_life" ? d.no_people_confirmed : false,
  }
}

export function Wizard({
  email,
  emailVerified,
  knownKind,
  available,
  freeVideoAvailable,
  brandKit: initialKit,
}: {
  email: string
  emailVerified: boolean
  knownKind: CreatorKind | null
  available: number
  freeVideoAvailable: boolean
  brandKit: BrandKitDraft | null
}) {
  const router = useRouter()
  // "Who are you?" is asked once per workspace.
  const steps = useMemo<Step[]>(() => (knownKind ? ["type", "input", "style", "review"] : ["who", "type", "input", "style", "review"]), [knownKind])
  const [stepIndex, setStepIndex] = useState(0)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(knownKind))
  const [kit, setKit] = useState<BrandKitDraft>(initialKit ?? { logo: null, colors: [], endCardText: "" })
  const [kitDirty, setKitDirty] = useState(false)
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const [pending, start] = useTransition()
  const [resent, setResent] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  // Restore this tab's draft and step (sessionStorage only exists in the browser, so after mount).
  // Saving starts only after the restored draft is in state, so a stale first render never overwrites it.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    const saved = loadDraft(knownKind)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from browser storage
    setDraft(saved.draft)
    const i = saved.step ? steps.indexOf(saved.step) : -1
    if (i > 0) setStepIndex(i)
    setRestored(true)
  }, [knownKind, steps])
  useEffect(() => {
    if (!restored) return
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, step: steps[stepIndex] }))
    } catch {
      // Storage full or blocked: the draft lives only in memory.
    }
  }, [draft, stepIndex, steps, restored])
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
    window.scrollTo({ top: 0 })
  }, [stepIndex])

  // Never show a step whose earlier choices are missing (old or partial drafts): go back to the first gap.
  const firstGap: Step | null = !draft.creator_kind ? "who" : !draft.video_type ? "type" : null
  const step = firstGap && steps.indexOf(firstGap) >= 0 && steps.indexOf(firstGap) < stepIndex ? firstGap : steps[stepIndex]!
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError(null)
    setDraft((d) => ({ ...d, [key]: value }))
  }
  const price = creditsForNewVideo({ lengthSec: draft.length_sec, freeVideoAvailable })
  const at = steps.indexOf(step)
  const back =
    at > 0
      ? () => {
          setError(null)
          setStepIndex(at - 1)
        }
      : undefined
  const goTo = (s: Step) => {
    setError(null)
    setStepIndex(steps.indexOf(s))
  }

  function validateInput(): boolean {
    const parsed = VideoBriefSchema.safeParse(toBrief(draft))
    if (parsed.success) return true
    const issue = parsed.error.issues.find((i) => ["topic", "source_url", "photo_upload_id", "no_people_confirmed"].includes(String(i.path[0])))
    if (!issue) return true
    setError({ message: issue.message, field: String(issue.path[0]) })
    return false
  }

  function next() {
    if (step === "who" && !draft.creator_kind) return setError({ message: "Pick the one that fits you best." })
    if (step === "type" && !draft.video_type) return setError({ message: "Pick a type of video." })
    if (step === "input" && !validateInput()) return
    if (step === "style" && draft.use_brand_kit && kitDirty) {
      start(async () => {
        const r = await saveBrandKitAction({ logoUploadId: kit.logo?.id ?? null, colors: kit.colors, endCardText: kit.endCardText || null })
        if (!r.ok) return setError({ message: r.error, field: "brand_kit" })
        setKitDirty(false)
        setStepIndex(at + 1)
      })
      return
    }
    setError(null)
    setStepIndex(at + 1)
  }

  function make() {
    setError(null)
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    start(async () => {
      const r = await createVideo(toBrief(draft), timeZone)
      if (!r.ok) return setError({ message: r.error, field: r.field })
      try {
        sessionStorage.removeItem(DRAFT_KEY)
      } catch {}
      router.push(`/app/videos/${r.jobId}`)
    })
  }

  const fieldError = (f: string) => (error?.field === f ? error.message : null)
  const notEnough = !price.isFree && price.credits > available
  const stepError = error && !["topic", "source_url", "photo_upload_id", "no_people_confirmed"].includes(error.field ?? "") ? error : null

  const continueButton = (
    <Button onClick={next} disabled={pending}>
      {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
      Continue
      <ArrowRight aria-hidden />
    </Button>
  )

  const shell = { step: at + 1, total: steps.length, headingRef, onBack: back }

  if (step === "who") {
    return (
      <WizardShell {...shell} title="Who are you making videos for?" description="We'll suggest ideas that fit. You can change this later." primary={continueButton}>
        <ChoiceCards
          name="creator_kind"
          legend="Who are you making videos for?"
          hideLegend
          columns={1}
          value={draft.creator_kind}
          onChange={(v) => set("creator_kind", v)}
          options={CREATOR_KINDS.map((k) => ({ value: k, icon: KIND_ICONS[k], ...CREATOR_KIND_LABELS[k] }))}
        />
        {stepError && <InlineAlert title="One more thing">{stepError.message}</InlineAlert>}
      </WizardShell>
    )
  }

  if (step === "type") {
    return (
      <WizardShell {...shell} title="What kind of video?" description="Each one is a vertical YouTube Short." primary={continueButton}>
        <ChoiceCards
          name="video_type"
          legend="What kind of video?"
          hideLegend
          value={draft.video_type}
          onChange={(v) => set("video_type", v)}
          options={VIDEO_TYPES.map((t) => ({ value: t, icon: TYPE_ICONS[t], ...VIDEO_TYPE_LABELS[t] }))}
        />
        {stepError && <InlineAlert title="One more thing">{stepError.message}</InlineAlert>}
      </WizardShell>
    )
  }

  if (step === "input") {
    const t = draft.video_type!
    const title =
      t === "product_showcase" ? "Which product?" : t === "photo_to_life" ? "Which photo?" : t === "quote" ? "What's the quote or idea?" : "What's the fact or tip?"
    return (
      <WizardShell {...shell} title={title} primary={continueButton}>
        {(t === "fact_tip" || t === "quote") && (
          <TextAreaField
            label={t === "quote" ? "Quote or idea" : "Topic"}
            hint={
              t === "quote"
                ? "Paste a quote with its author, or describe the idea. Example: Start before you feel ready."
                : "One idea works best. Example: Why octopuses have three hearts."
            }
            value={draft.topic ?? ""}
            onChange={(v) => set("topic", v)}
            error={fieldError("topic")}
          />
        )}
        {t === "product_showcase" && (
          <>
            <TextField
              label="Product or website link"
              hint="We read the page for the product name, photos, and key details."
              type="url"
              inputMode="url"
              placeholder="https://"
              value={draft.source_url ?? ""}
              onChange={(v) => set("source_url", v || null)}
              error={fieldError("source_url")}
            />
            <PhotoUploader
              purpose="input"
              label="Or add a product photo (optional)"
              hint="A clear photo on a plain background works best."
              value={draft.photo}
              onChange={(p) => set("photo", p)}
              maxMb={15}
            />
            <TextAreaField
              label="Anything to mention? (optional)"
              hint="Example: Mention the free shipping."
              value={draft.topic ?? ""}
              onChange={(v) => set("topic", v)}
              error={fieldError("topic")}
              rows={3}
            />
          </>
        )}
        {t === "photo_to_life" && (
          <>
            <PhotoUploader
              purpose="input"
              label="Photo"
              hint="Places, products, food, and pets work well. Photos of people aren't supported yet."
              value={draft.photo}
              onChange={(p) => set("photo", p)}
              maxMb={15}
            />
            {fieldError("photo_upload_id") && <InlineAlert title="Add a photo">{fieldError("photo_upload_id")}</InlineAlert>}
            <CheckboxField
              label="This photo has no people in it"
              checked={draft.no_people_confirmed}
              onChange={(v) => set("no_people_confirmed", v)}
              error={fieldError("no_people_confirmed")}
            />
          </>
        )}
      </WizardShell>
    )
  }

  if (step === "style") {
    return (
      <WizardShell {...shell} title="How should it look and sound?" description="We picked a starting point. Change anything you like." primary={continueButton}>
        <ChoiceCards
          name="length_sec"
          legend="Length"
          columns={2}
          size="sm"
          value={String(draft.length_sec) as "8" | "15"}
          onChange={(v) => set("length_sec", Number(v) as 8 | 15)}
          options={(["8", "15"] as const).map((v) => ({ value: v, label: LENGTH_LABELS[Number(v) as 8 | 15].label, meta: LENGTH_LABELS[Number(v) as 8 | 15].description }))}
        />
        <ChoiceCards
          name="look"
          legend="Look"
          columns={2}
          size="sm"
          value={draft.look}
          onChange={(v) => set("look", v)}
          options={LOOKS.map((l) => ({ value: l, ...LOOK_LABELS[l] }))}
        />
        <ChoiceCards
          name="voice"
          legend="Voice"
          columns={2}
          size="sm"
          value={draft.voice}
          onChange={(v) => set("voice", v)}
          options={VOICES.map((v) => ({ value: v, ...VOICE_LABELS[v] }))}
        />
        <LanguageSelect value={draft.language} onChange={(v) => set("language", v)} musicOnly={draft.voice === "music_only"} />
        <ChoiceCards
          name="captions_style"
          legend="Captions"
          columns={1}
          size="sm"
          value={draft.captions_style}
          onChange={(v) => set("captions_style", v)}
          options={CAPTION_STYLES.map((c) => ({ value: c, ...CAPTION_LABELS[c] }))}
        />
        <BrandKitSection
          enabled={draft.use_brand_kit}
          onEnabled={(v) => set("use_brand_kit", v)}
          kit={kit}
          onKit={(k) => {
            setKit(k)
            setKitDirty(true)
          }}
          error={fieldError("brand_kit")}
        />
      </WizardShell>
    )
  }

  // Review
  const summary: { label: string; value: string; step: Step }[] = [
    ...(steps.includes("who") ? [{ label: "You are", value: CREATOR_KIND_LABELS[draft.creator_kind!].label, step: "who" as Step }] : []),
    { label: "Video", value: VIDEO_TYPE_LABELS[draft.video_type!].label, step: "type" },
    {
      label: draft.video_type === "product_showcase" ? "Product" : draft.video_type === "photo_to_life" ? "Photo" : "Topic",
      value:
        draft.video_type === "photo_to_life"
          ? (draft.photo?.name ?? "No photo")
          : draft.video_type === "product_showcase"
            ? [draft.source_url, draft.photo?.name].filter(Boolean).join(" and ")
            : (draft.topic ?? ""),
      step: "input",
    },
    { label: "Length", value: LENGTH_LABELS[draft.length_sec].label, step: "style" },
    { label: "Look", value: LOOK_LABELS[draft.look].label, step: "style" },
    {
      label: "Voice",
      value: draft.voice === "music_only" ? "Music only" : `${VOICE_LABELS[draft.voice].label}, ${LANGUAGE_LABELS[draft.language]}`,
      step: "style",
    },
    { label: "Captions", value: CAPTION_LABELS[draft.captions_style].label, step: "style" },
    { label: "Brand kit", value: draft.use_brand_kit ? "On" : "Off", step: "style" },
  ]

  return (
    <WizardShell
      {...shell}
      title="Ready to make your video?"
      description="It takes about two minutes. You'll review it before anything posts."
      aside={
        <span className="tabular">
          {price.isFree ? "Free: your first video" : `${creditsLabel(price.credits)}. You have ${available}.`}
        </span>
      }
      primary={
        <Button onClick={make} disabled={pending || !emailVerified || notEnough}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Sparkles aria-hidden />}
          Make video
        </Button>
      }
    >
      <dl className="divide-y divide-border rounded-md bg-card">
        {summary.map((row) => (
          <div key={row.label} className="flex items-center gap-4 px-4 py-2">
            <dt className="w-28 shrink-0 text-body-sm text-muted-foreground">{row.label}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-body-sm-strong text-foreground">{row.value}</span>
              <Button variant="text" size="sm" onClick={() => goTo(row.step)} aria-label={`Change ${row.label.toLowerCase()}`}>
                Change
              </Button>
            </dd>
          </div>
        ))}
      </dl>

      {!emailVerified && (
        <InlineAlert
          tone="info"
          title="Confirm your email to make this video"
          action={
            <Button
              variant="tertiary"
              size="sm"
              disabled={resent}
              onClick={async () => {
                await authClient.sendVerificationEmail({ email, callbackURL: "/app/new" })
                setResent(true)
              }}
            >
              <MailCheck aria-hidden />
              {resent ? "Link sent" : "Send the link again"}
            </Button>
          }
        >
          We sent a link to {email}. Your choices stay here while you check.
        </InlineAlert>
      )}
      {notEnough && (
        <InlineAlert title="Not enough credits">
          This video needs {price.credits} credits and you have {available}. Pick 8 seconds, or add credits.
        </InlineAlert>
      )}
      {error && <InlineAlert title="We couldn't start this video">{error.message}</InlineAlert>}
    </WizardShell>
  )
}

// ── Fields ───────────────────────────────────────────────────────────────────

function TextAreaField({
  label,
  hint,
  value,
  onChange,
  error,
  rows = 4,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  error: string | null
  rows?: number
}) {
  const id = useId()
  const hintId = useId()
  const errId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-sm-strong text-foreground">
        {label}
      </label>
      <Textarea
        id={id}
        rows={rows}
        maxLength={TOPIC_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${hintId}${error ? ` ${errId}` : ""}`}
      />
      <div className="flex gap-4 text-caption text-muted-foreground">
        <p id={hintId} className="flex-1">
          {hint}
        </p>
        <span className="tabular" aria-hidden>
          {value.length}/{TOPIC_MAX}
        </span>
      </div>
      {error && (
        <p id={errId} className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function TextField({
  label,
  hint,
  value,
  onChange,
  error,
  ...rest
}: { label: string; hint: string; value: string; onChange: (v: string) => void; error: string | null } & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "onChange"
>) {
  const id = useId()
  const hintId = useId()
  const errId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-sm-strong text-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${hintId}${error ? ` ${errId}` : ""}`}
        {...rest}
      />
      <p id={hintId} className="text-caption text-muted-foreground">
        {hint}
      </p>
      {error && (
        <p id={errId} className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function CheckboxField({ label, checked, onChange, error }: { label: string; checked: boolean; onChange: (v: boolean) => void; error: string | null }) {
  const id = useId()
  const errId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-body-sm text-foreground">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className="size-5 shrink-0 accent-[var(--color-ink)] dark:accent-[var(--color-canvas)]"
        />
        {label}
      </label>
      {error && (
        <p id={errId} className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function LanguageSelect({ value, onChange, musicOnly }: { value: VideoBrief["language"]; onChange: (v: VideoBrief["language"]) => void; musicOnly: boolean }) {
  const id = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label id={id} className="text-body-sm-strong text-foreground">
        Language
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as VideoBrief["language"])}>
        <SelectTrigger aria-labelledby={id} aria-describedby={hintId} className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {VOICE_LANGUAGES.map((l) => (
            <SelectItem key={l} value={l}>
              {LANGUAGE_LABELS[l]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={hintId} className="text-caption text-muted-foreground">
        {musicOnly ? "Used for the captions." : "Used for the voice and the captions."}
      </p>
    </div>
  )
}

function BrandKitSection({
  enabled,
  onEnabled,
  kit,
  onKit,
  error,
}: {
  enabled: boolean
  onEnabled: (v: boolean) => void
  kit: BrandKitDraft
  onKit: (k: BrandKitDraft) => void
  error: string | null
}) {
  const switchId = useId()
  const endId = useId()
  return (
    <section aria-labelledby={switchId} className="flex flex-col gap-4 rounded-md bg-card p-4 sm:p-6">
      <div className="flex items-center gap-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <label id={switchId} htmlFor={`${switchId}-switch`} className="text-body-sm-strong text-foreground">
            Add my logo and colors
          </label>
          <p className="text-body-sm text-muted-foreground">Saved for your next videos too. Optional.</p>
        </div>
        <Switch id={`${switchId}-switch`} checked={enabled} onCheckedChange={onEnabled} />
      </div>
      {enabled && (
        <div className="flex flex-col gap-5">
          <PhotoUploader
            purpose="logo"
            label="Logo"
            hint="A PNG with a transparent background looks best on the end card."
            value={kit.logo}
            onChange={(logo) => onKit({ ...kit, logo })}
            maxMb={2}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-body-sm-strong text-foreground">Brand colors (up to {BRAND_COLORS_MAX})</legend>
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: BRAND_COLORS_MAX }, (_, i) => {
                const color = kit.colors[i] ?? ""
                return (
                  <label key={i} className="flex min-h-11 items-center gap-2 text-body-sm">
                    <input
                      type="color"
                      value={color || "#201515"}
                      aria-label={`Brand color ${i + 1}`}
                      onChange={(e) => {
                        const colors = [...kit.colors]
                        colors[i] = e.target.value.toUpperCase()
                        onKit({ ...kit, colors: colors.filter(Boolean) })
                      }}
                      className="size-11 cursor-pointer rounded-sm border border-input bg-background p-1"
                    />
                    <span className="tabular w-20 text-muted-foreground">{color || "Not set"}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor={endId} className="text-body-sm-strong text-foreground">
              End card text
            </label>
            <Input
              id={endId}
              maxLength={END_CARD_TEXT_MAX}
              value={kit.endCardText}
              placeholder="Example: Follow for a new tip every day"
              onChange={(e) => onKit({ ...kit, endCardText: e.target.value })}
            />
          </div>
          {error && <InlineAlert title="We couldn't save your brand kit">{error}</InlineAlert>}
        </div>
      )}
    </section>
  )
}
