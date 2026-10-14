import { ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PlatformIcon } from "@/components/vidora/platform-chip"

// ⊕ Connect dialog, opened by Approve when no channel is connected yet (onboarding copy from the skill §7).
// The link goes through Google and comes back to the same review page, where the approval finishes.

export function ConnectDialog({
  open,
  onOpenChange,
  connectHref,
  postLabel,
  audited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectHref: string
  postLabel: string
  audited: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect where you post.</DialogTitle>
          <DialogDescription>We&apos;ll only post videos you approve.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3 text-body-sm text-foreground">
          <li className="flex gap-3">
            <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
            <span>Google asks you to let Vidora upload to your YouTube channel. You can remove access any time in your Google account.</span>
          </li>
          <li className="flex gap-3">
            <PlatformIcon platform="youtube" className="mt-0.5 size-5 shrink-0" />
            <span>
              Then we come back here and approve this video for {postLabel}.
              {!audited && " It uploads as Private for now, while Google reviews Vidora."}
            </span>
          </li>
        </ul>
        <DialogFooter className="gap-3 sm:justify-end">
          <Button variant="tertiary" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button asChild>
            <a href={connectHref}>
              <PlatformIcon platform="youtube" className="size-5" />
              Connect YouTube
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
