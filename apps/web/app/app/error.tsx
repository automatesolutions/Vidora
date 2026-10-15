"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/vidora/inline-alert"

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <h1 className="font-display text-display-md">This page didn&apos;t load</h1>
      <InlineAlert
        title="Something went wrong on our side"
        action={
          <Button variant="tertiary" size="sm" onClick={reset}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        }
      >
        Your videos are safe. Try again, and if it keeps happening, come back in a few minutes.
      </InlineAlert>
    </div>
  )
}
