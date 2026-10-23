"use client"

import type { LockableElement } from "@vidora/core/campaign"
import { describeSchedule, upcomingSlots } from "@vidora/core/schedule"
import { ArrowLeft, ArrowRight, Clapperboard, LoaderCircle, Package, Scissors, Sparkles, UserRound } from "lucide-react"
import Link from "next/link"
import { useId, useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ChoiceCards } from "@/components/vidora/choice-cards"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { PhotoUploader, type UploadedPhoto } from "@/components/vidora/photo-uploader"
import { NewCampaignSchema, type NewCampaignInput } from "@/lib/campaign-form"
import { cn } from "@/lib/utils"
import { createCampaignAction } from "../actions"

// New campaign: one decision group per step. Original and Product work today; UGC and Clipping show
// as "Coming soon". Everything is checked again on the server.

type Mode = "original" | "product"
type Frequency = "daily" | "three_per_week" | "weekly" | "custom"
const STEPS = ["Type", "Details", "Schedule", "Variety", "Publishing"] as const
const DAYS = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 0, label: "Sun" },
]
const LOCKS: { value: LockableElement; label: string }[] = [
  { value: "voice", label: "Narrator voice" },
  { value: "visual_style", label: "Visual style" },
  { value: "color_grade", label: "Color grade" },
  { value: "camera_language", label: "Camera style" },
  { value: "caption_style", label: "Caption style" },
  { value: "music_mood", label: "Music mood" },
]
const ZONES = ["Asia/Manila", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"]

function Field({ label, hint, children }: { label: string; hint?: string; children: (ids: { id: string; hintId?: string }) => React.ReactNode }) {
  const id = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-sm-strong text-foreground">
        {label}
      </label>
      {children({ id, hintId: hint ? hintId : undefined })}
      {hint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

const lines = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean)

export function NewCampaignWizard({ channels }: { channels: { id: string; name: string }[] }) {
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const [mode, setMode] = useState<Mode | null>(null)
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const [audience, setAudience] = useState("")
  const [tone, setTone] = useState("")
  const [length, setLength] = useState<"15" | "30" | "45" | "59">("30")
  const [language, setLanguage] = useState<"en" | "fil">("en")
  const [cta, setCta] = useState("Follow for more")
  const [hashtags, setHashtags] = useState("")
  const [banned, setBanned] = useState("")
  const [product, setProduct] = useState({ name: "", description: "", price: "", link: "" })
  const [photos, setPhotos] = useState<UploadedPhoto[]>([])

  const [frequency, setFrequency] = useState<Frequency>("three_per_week")
  const [days, setDays] = useState<number[]>([1, 3, 5])
  const [times, setTimes] = useState<string[]>(["18:00"])
  const [timeZone, setTimeZone] = useState("Asia/Manila")
  const [ahead, setAhead] = useState<"12" | "24" | "48">("24")

  const [intensity, setIntensity] = useState<"low" | "medium" | "high">("medium")
  const [locks, setLocks] = useState<LockableElement[]>([])

  const [publishMode, setPublishMode] = useState<"auto" | "approval">("approval")
  const [channel, setChannel] = useState<string>(channels[0]?.id ?? "")
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public")
  const [runCap, setRunCap] = useState("")
  const [monthCap, setMonthCap] = useState("")

  const schedule = useMemo(
    () => ({
      frequency,
      days: frequency === "daily" ? [] : frequency === "weekly" ? days.slice(0, 1) : days,
      times: times.filter(Boolean),
      timeZone,
      generateAheadHours: Number(ahead),
    }),
    [frequency, days, times, timeZone, ahead]
  )

  const input: NewCampaignInput = {
    name: name.trim() || (mode === "product" ? product.name : topic).slice(0, 60) || "My campaign",
    mode: mode ?? "original",
    topic,
    audience,
    tone,
    language,
    targetLengthSec: Number(length) as 15 | 30 | 45 | 59,
    cta: lines(cta),
    hashtagSeeds: lines(hashtags),
    bannedTopics: lines(banned),
    product: mode === "product" ? { ...product, imageUploadIds: photos.map((p) => p.id) } : undefined,
    schedule,
    publishMode,
    variationIntensity: intensity,
    lockedElements: locks,
    perRunCapCredits: runCap ? Number(runCap) : null,
    monthlyCapCredits: monthCap ? Number(monthCap) : null,
    youtubeAccountId: channel || null,
    visibility,
    madeForKids: false,
  }

  // Each step only checks its own fields, so the error shows where it can be fixed.
  function checkStep(s: number): string | null {
    if (s === 0 && !mode) return "Choose the kind of videos."
    if (s === 1 && mode === "original" && topic.trim().length < 3) return "Describe what the videos are about."
    if (s === 1 && mode === "product" && !product.name.trim()) return "Add the product name."
    if (s === 1 && mode === "product" && photos.length === 0) return "Add at least one product photo."
    if (s === 2) {
      if (schedule.times.length === 0) return "Add a posting time."
      if (frequency === "three_per_week" && days.length !== 3) return "Pick three days."
      if (frequency === "weekly" && days.length < 1) return "Pick a day."
      if (frequency === "custom" && days.length === 0) return "Pick at least one day."
    }
    return null
  }

  function next() {
    const problem = checkStep(step)
    setError(problem)
    if (!problem) setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function submit() {
    const parsed = NewCampaignSchema.safeParse(input)
    if (!parsed.success) return setError(parsed.error.issues[0]!.message)
    setError(null)
    start(async () => {
      const r = await createCampaignAction(input)
      if (r && !r.ok) setError(r.message)
    })
  }

  const preview = useMemo(() => {
    try {
      if (checkStep(2)) return []
      return upcomingSlots(schedule, new Date(), 3)
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkStep reads the same state
  }, [schedule])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="tabular text-body-sm text-muted-foreground">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-foreground" : "bg-muted")} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-display-md">What kind of videos?</h1>
            <p className="text-body-md text-muted-foreground">Set it up once. Every run makes a new Short in this style.</p>
          </div>
          <ChoiceCards
            name="mode"
            legend="Video type"
            hideLegend
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { value: "original", label: "Original video", description: "A topic or niche. We write the script and generate every scene.", icon: Sparkles },
              { value: "product", label: "Product video", description: "Your product photos come to life, with a voiceover and a call to action.", icon: Package },
              { value: "ugc", label: "UGC-style creator", description: "The same AI creator talking to camera, selfie-style.", icon: UserRound, meta: "Coming soon", disabled: true },
              { value: "clipping", label: "Clipping", description: "The best moments of your long videos, cut and reframed.", icon: Scissors, meta: "Coming soon", disabled: true },
            ]}
          />
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-6">
          <h1 className="font-display text-display-md">{mode === "product" ? "Tell us about the product" : "What are the videos about?"}</h1>
          {mode === "original" ? (
            <Field label="Topic or niche" hint='Be specific. Example: "Budget tips for young Filipinos in their first job".'>
              {({ id, hintId }) => <Textarea id={id} aria-describedby={hintId} value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} maxLength={1500} />}
            </Field>
          ) : (
            <>
              <Field label="Product name">{({ id }) => <Input id={id} value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} maxLength={120} />}</Field>
              <Field label="What it is and who it's for" hint="We only say what you write here: no invented features or claims.">
                {({ id, hintId }) => (
                  <Textarea id={id} aria-describedby={hintId} value={product.description} onChange={(e) => setProduct({ ...product, description: e.target.value })} rows={3} maxLength={1000} />
                )}
              </Field>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Price (optional)">{({ id }) => <Input id={id} value={product.price} onChange={(e) => setProduct({ ...product, price: e.target.value })} placeholder="₱499" maxLength={40} />}</Field>
                <Field label="Buy link (optional)">
                  {({ id }) => <Input id={id} type="url" value={product.link} onChange={(e) => setProduct({ ...product, link: e.target.value })} placeholder="https://" maxLength={500} />}
                </Field>
              </div>
              <div className="flex flex-col gap-4">
                <p className="text-body-sm-strong text-foreground">Product photos ({photos.length} of 6)</p>
                {photos.map((p, i) => (
                  <PhotoUploader
                    key={p.id}
                    purpose="input"
                    label={`Photo ${i + 1}`}
                    hint={i === 0 ? "Scene 1 starts from this photo." : `Scene ${i + 1} starts from this photo.`}
                    value={p}
                    onChange={(v) => setPhotos((all) => (v ? all.map((x) => (x.id === p.id ? v : x)) : all.filter((x) => x.id !== p.id)))}
                    maxMb={15}
                  />
                ))}
                {photos.length < 6 && (
                  <PhotoUploader
                    purpose="input"
                    label={photos.length ? "Add another photo" : "First photo"}
                    hint="Clear, well-lit photos of the product. Each scene starts from one of them."
                    value={null}
                    onChange={(v) => v && setPhotos((all) => [...all, v])}
                    maxMb={15}
                  />
                )}
              </div>
            </>
          )}
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Audience (optional)">{({ id }) => <Input id={id} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Young professionals in Manila" maxLength={200} />}</Field>
            <Field label="Tone (optional)">{({ id }) => <Input id={id} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Friendly and practical" maxLength={120} />}</Field>
          </div>
          <ChoiceCards
            name="length"
            legend="Length"
            size="sm"
            columns={3}
            value={length}
            onChange={(v) => setLength(v as typeof length)}
            options={[
              { value: "15", label: "15 seconds", meta: "about 3 scenes" },
              { value: "30", label: "30 seconds", meta: "about 5 scenes" },
              { value: "45", label: "45 seconds", meta: "about 7 scenes" },
              { value: "59", label: "60 seconds", meta: "about 9 scenes" },
            ]}
          />
          <ChoiceCards
            name="language"
            legend="Narration language"
            size="sm"
            columns={2}
            value={language}
            onChange={(v) => setLanguage(v as typeof language)}
            options={[
              { value: "en", label: "English" },
              { value: "fil", label: "Filipino" },
            ]}
          />
          <Field label="Call to action" hint="One per line. Each video uses one of them.">
            {({ id, hintId }) => <Textarea id={id} aria-describedby={hintId} value={cta} onChange={(e) => setCta(e.target.value)} rows={2} />}
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Hashtag ideas (optional)" hint="Separate with commas.">
              {({ id, hintId }) => <Input id={id} aria-describedby={hintId} value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="ipon, budgeting" />}
            </Field>
            <Field label="Never mention (optional)" hint="Topics or words to keep out.">
              {({ id, hintId }) => <Input id={id} aria-describedby={hintId} value={banned} onChange={(e) => setBanned(e.target.value)} placeholder="crypto, loans" />}
            </Field>
          </div>
          <Field label="Campaign name" hint="Only you see this.">
            {({ id, hintId }) => <Input id={id} aria-describedby={hintId} value={name} onChange={(e) => setName(e.target.value)} placeholder={input.name} maxLength={80} />}
          </Field>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-6">
          <h1 className="font-display text-display-md">When should they post?</h1>
          <ChoiceCards
            name="frequency"
            legend="How often"
            size="sm"
            value={frequency}
            onChange={(v) => {
              setFrequency(v as Frequency)
              if (v === "three_per_week") setDays([1, 3, 5])
              if (v === "weekly") setDays([1])
            }}
            options={[
              { value: "daily", label: "Every day" },
              { value: "three_per_week", label: "3 times a week" },
              { value: "weekly", label: "Once a week" },
              { value: "custom", label: "Custom days" },
            ]}
          />
          {frequency !== "daily" && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-body-sm-strong text-foreground">{frequency === "three_per_week" ? "Pick three days" : frequency === "weekly" ? "Pick the day" : "Pick the days"}</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map(({ d, label }) => {
                  const on = days.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDays((all) => (frequency === "weekly" ? [d] : on ? all.filter((x) => x !== d) : [...all, d]))}
                      className={cn(
                        "min-h-11 min-w-14 rounded-md border px-3 text-body-sm-strong transition-colors",
                        on ? "border-foreground bg-secondary text-secondary-foreground" : "border-border bg-background text-foreground hover:border-foreground/60"
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}
          <div className="flex flex-col gap-3">
            <p className="text-body-sm-strong text-foreground">Posting time</p>
            {times.map((t, i) => (
              <div key={i} className="flex items-center gap-3">
                <Input aria-label={`Posting time ${i + 1}`} type="time" value={t} onChange={(e) => setTimes((all) => all.map((x, j) => (j === i ? e.target.value : x)))} className="max-w-40" />
                {times.length > 1 && (
                  <Button variant="text" size="sm" onClick={() => setTimes((all) => all.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {times.length < 3 && (
              <div>
                <Button variant="tertiary" size="sm" onClick={() => setTimes((all) => [...all, "08:00"])}>
                  Add another time
                </Button>
              </div>
            )}
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Time zone">
              {({ id }) => (
                <>
                  <Input id={id} list={`${id}-zones`} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
                  <datalist id={`${id}-zones`}>
                    {ZONES.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <ChoiceCards
              name="ahead"
              legend="Make each video"
              size="sm"
              columns={1}
              value={ahead}
              onChange={(v) => setAhead(v as typeof ahead)}
              options={[
                { value: "12", label: "12 hours before" },
                { value: "24", label: "24 hours before" },
                { value: "48", label: "48 hours before" },
              ]}
            />
          </div>
          {preview.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md bg-card p-4">
              <p className="text-body-sm-strong text-foreground">{describeSchedule(schedule)}</p>
              <ul className="tabular text-body-sm text-muted-foreground">
                {preview.map((s) => (
                  <li key={s.slotAt.toISOString()}>
                    Posts {s.slotAt.toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-display-md">How different should each video be?</h1>
            <p className="text-body-md text-muted-foreground">Every video gets a new hook, script, and visuals. This controls how much else changes between runs.</p>
          </div>
          <ChoiceCards
            name="intensity"
            legend="Variety"
            hideLegend
            columns={1}
            value={intensity}
            onChange={(v) => setIntensity(v as typeof intensity)}
            options={[
              { value: "low", label: "Low", description: "A consistent look. Two production choices change per video." },
              { value: "medium", label: "Medium", description: "Recognizable but fresh. Four choices change per video." },
              { value: "high", label: "High", description: "Every unlocked choice changes every time." },
            ]}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-body-sm-strong text-foreground">Keep the same in every video</legend>
            <p className="text-body-sm text-muted-foreground">Locked choices keep whatever the first video uses.</p>
            {LOCKS.map((l) => (
              <label key={l.value} className="flex min-h-11 cursor-pointer items-center gap-3 text-body-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--color-primary)]"
                  checked={locks.includes(l.value)}
                  onChange={(e) => setLocks((all) => (e.target.checked ? [...all, l.value] : all.filter((x) => x !== l.value)))}
                />
                {l.label}
              </label>
            ))}
          </fieldset>
        </section>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-6">
          <h1 className="font-display text-display-md">How should videos post?</h1>
          <ChoiceCards
            name="publishMode"
            legend="Publishing"
            hideLegend
            columns={1}
            value={publishMode}
            onChange={(v) => setPublishMode(v as typeof publishMode)}
            options={[
              { value: "approval", label: "Ask me first (recommended)", description: "Each finished video gets a review page. You watch it, edit the title and time, then approve it before it's scheduled." },
              { value: "auto", label: "Post automatically", description: "Each finished video is scheduled on YouTube for its slot without waiting for you." },
            ]}
          />
          {channels.length > 0 ? (
            <ChoiceCards name="channel" legend="YouTube channel" size="sm" value={channel} onChange={setChannel} options={channels.map((c) => ({ value: c.id, label: c.name }))} />
          ) : (
            <InlineAlert tone="info" title="No YouTube channel yet">
              Videos still get made and wait in your Video Library.{" "}
              <Link href="/app/connections" className="text-primary-text underline underline-offset-4">
                Connect YouTube
              </Link>{" "}
              to post them.
            </InlineAlert>
          )}
          <ChoiceCards
            name="visibility"
            legend="At the posting time, make the video"
            size="sm"
            value={visibility}
            onChange={(v) => setVisibility(v as typeof visibility)}
            options={[
              { value: "public", label: "Public" },
              { value: "unlisted", label: "Unlisted" },
            ]}
          />
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="Credit limit per video (optional)" hint="Skip a video that would cost more.">
              {({ id, hintId }) => <Input id={id} aria-describedby={hintId} inputMode="numeric" value={runCap} onChange={(e) => setRunCap(e.target.value.replace(/[^\d.]/g, ""))} placeholder="60" />}
            </Field>
            <Field label="Credit limit per month (optional)" hint="The campaign pauses when it's reached.">
              {({ id, hintId }) => <Input id={id} aria-describedby={hintId} inputMode="numeric" value={monthCap} onChange={(e) => setMonthCap(e.target.value.replace(/[^\d.]/g, ""))} placeholder="600" />}
            </Field>
          </div>
        </section>
      )}

      {error && <InlineAlert title="Check this step">{error}</InlineAlert>}

      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button variant="text" onClick={() => setStep((s) => s - 1)} disabled={pending}>
            <ArrowLeft aria-hidden />
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>
            Continue
            <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button onClick={submit} disabled={pending}>
            {pending ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Clapperboard aria-hidden />}
            Start campaign
          </Button>
        )}
      </div>
    </div>
  )
}
