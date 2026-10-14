"use client"

import { Lightbulb, Quote, ShoppingBag, Camera } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChoiceCards } from "@/components/vidora/choice-cards"
import { ConnectDialog } from "@/components/vidora/connect-dialog"
import { CoverPicker } from "@/components/vidora/cover-picker"
import { HashtagInput } from "@/components/vidora/hashtag-input"
import { PhotoUploader } from "@/components/vidora/photo-uploader"
import { ShortsFrame } from "@/components/vidora/shorts-frame"
import { WizardShell } from "@/components/vidora/wizard-shell"

// ⊕ Components added for the create-video and review milestone, with their states.

const FRAME = "/brand/og-default.png"

export function ChoiceCardsDemo() {
  const [v, setV] = useState<"fact_tip" | "product_showcase" | "photo_to_life" | "quote" | null>("fact_tip")
  const [len, setLen] = useState<"8" | "15">("15")
  return (
    <div className="flex flex-col gap-8">
      <ChoiceCards
        name="demo-type"
        legend="With icons and descriptions (selected and not selected)"
        value={v}
        onChange={setV}
        options={[
          { value: "fact_tip", label: "Fact or tip", description: "One surprising fact or useful tip.", icon: Lightbulb },
          { value: "product_showcase", label: "Product showcase", description: "Show a product from its website.", icon: ShoppingBag },
          { value: "photo_to_life", label: "Bring a photo to life", description: "Add motion to a photo.", icon: Camera },
          { value: "quote", label: "Quote or motivation", description: "A short quote with visuals.", icon: Quote },
        ]}
      />
      <ChoiceCards
        name="demo-length"
        legend="Small, with meta"
        size="sm"
        value={len}
        onChange={setLen}
        options={[
          { value: "8", label: "8 seconds", meta: "6 credits" },
          { value: "15", label: "15 seconds", meta: "10 credits" },
        ]}
      />
    </div>
  )
}

export function WizardShellDemo() {
  return (
    <div className="rounded-md border border-border p-4 sm:p-6">
      <WizardShell step={2} total={5} title="What kind of video?" description="Each one is a vertical YouTube Short." onBack={() => {}} primary={<Button>Continue</Button>} aside="10 credits. You have 40.">
        <p className="text-body-sm text-muted-foreground">One decision per screen goes here.</p>
      </WizardShell>
    </div>
  )
}

export function UploaderDemo() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <PhotoUploader purpose="input" label="Photo (empty)" hint="Places, products, food, and pets work well." value={null} onChange={() => {}} maxMb={15} />
      <PhotoUploader
        purpose="input"
        label="Photo (uploaded)"
        hint="Replace or remove it."
        value={{ id: "upl_demo", name: "serum-on-table.jpg", previewUrl: FRAME }}
        onChange={() => {}}
        maxMb={15}
      />
    </div>
  )
}

export function ReviewPartsDemo() {
  const [tags, setTags] = useState(["#money", "#tips"])
  const [cover, setCover] = useState(1)
  const [open, setOpen] = useState(false)
  const frames = Array.from({ length: 6 }, (_, i) => ({ ordinal: i, url: FRAME, atSec: i * 2 + 1 }))
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,280px)_1fr]">
      <div className="flex flex-col gap-4">
        <ShortsFrame src={null} title="3 money habits" channel={null} />
        <p className="text-caption text-muted-foreground">Shorts frame: file not ready, no channel connected yet.</p>
      </div>
      <div className="flex flex-col gap-8">
        <HashtagInput value={tags} onChange={setTags} />
        <CoverPicker frames={frames} value={cover} onChange={setCover} />
        <CoverPicker frames={frames} value={cover} onChange={setCover} disabled />
        <div>
          <Button variant="tertiary" onClick={() => setOpen(true)}>
            Open the connect dialog
          </Button>
        </div>
        <ConnectDialog open={open} onOpenChange={setOpen} connectHref="#" postLabel="Tue 6:00 PM" audited={false} />
      </div>
    </div>
  )
}
