"use client"

import { LoaderCircle } from "lucide-react"
import { useActionState, useId, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { disconnectHiggsfield, removeHiggsfieldKey, saveBalance, saveHiggsfieldKey, type FormState } from "./actions"

const initial: FormState = { ok: false, message: null }

function Field({ label, hint, invalid, ...props }: React.ComponentProps<typeof Input> & { label: string; hint?: string; invalid?: boolean }) {
  const id = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-sm-strong text-foreground">
        {label}
      </label>
      <Input id={id} aria-invalid={invalid || undefined} aria-describedby={hint ? hintId : undefined} {...props} />
      {hint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

/** The API key goes in as Higgsfield Console copies it; it is never shown again once saved. */
export function HiggsfieldKeyForm({ hasKey }: { hasKey: boolean }) {
  const [state, action, pending] = useActionState(saveHiggsfieldKey, initial)
  return (
    <form action={action} className="flex flex-col gap-5">
      <Field
        label="API key"
        name="apiKey"
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        invalid={state.field === "apiKey"}
        hint="In console.higgsfield.ai, open API keys, press Copy API key, and paste it here."
      />
      {state.message && (
        <InlineAlert tone={state.ok ? "success" : "danger"} title={state.ok ? "Key saved" : "We couldn't save that key"}>
          {state.message}
        </InlineAlert>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />}
          {hasKey ? "Replace key" : "Save and check key"}
        </Button>
      </div>
    </form>
  )
}

export function RemoveKeyButton() {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="text"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Remove your Higgsfield key? Campaigns stop making videos until you add one again.")) start(() => void removeHiggsfieldKey())
      }}
    >
      Remove key
    </Button>
  )
}

export function BalanceForm({ current }: { current: number | null }) {
  const [state, action, pending] = useActionState(saveBalance, initial)
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Field
            label="Current balance (credits)"
            name="balance"
            inputMode="decimal"
            defaultValue={current ?? ""}
            invalid={state.field === "balance"}
            hint="Higgsfield's API doesn't report your balance. Copy it from console.higgsfield.ai."
          />
        </div>
        <Button type="submit" variant="tertiary" disabled={pending} className="mb-7">
          Update balance
        </Button>
      </div>
      {state.message && (
        <InlineAlert tone={state.ok ? "success" : "danger"} title={state.ok ? "Saved" : "Check the balance"}>
          {state.message}
        </InlineAlert>
      )}
    </form>
  )
}

export function DisconnectHiggsfieldButton() {
  const [pending, start] = useTransition()
  return (
    <Button
      variant="text"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Disconnect Higgsfield? Campaigns stop making videos until you connect again.")) start(() => void disconnectHiggsfield())
      }}
    >
      Disconnect
    </Button>
  )
}
