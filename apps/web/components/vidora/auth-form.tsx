"use client"

import { LoaderCircle } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useId, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { authClient } from "@/lib/auth-client"

// Sign up and sign in. Email and password; Google sign-in shows when it's configured.

function safeNext(next: string | null, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback
}

const ERRORS: Record<string, string> = {
  USER_ALREADY_EXISTS: "There's already an account with this email. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "There's already an account with this email. Sign in instead.",
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match. Check them and try again.",
  PASSWORD_TOO_SHORT: "Use a password with at least 10 characters.",
  INVALID_EMAIL: "Enter a valid email address.",
}

function Field({ label, hint, ...props }: React.ComponentProps<typeof Input> & { label: string; hint?: string }) {
  const id = useId()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body-sm-strong text-foreground">
        {label}
      </label>
      <Input id={id} aria-describedby={hint ? hintId : undefined} {...props} />
      {hint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

export function AuthForm({ mode, googleEnabled }: { mode: "sign-up" | "sign-in"; googleEnabled: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get("next"), "/app")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function onSubmit(form: FormData) {
    setError(null)
    const email = String(form.get("email") ?? "").trim()
    const password = String(form.get("password") ?? "")
    start(async () => {
      const res =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "").trim() || email.split("@")[0]!, callbackURL: next })
          : await authClient.signIn.email({ email, password })
      if (res.error) {
        setError(ERRORS[res.error.code ?? ""] ?? res.error.message ?? "That didn't work. Try again.")
        return
      }
      router.push(next)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display-md">{mode === "sign-up" ? "Make your first video" : "Sign in to Vidora"}</h1>
        <p className="text-body-md text-muted-foreground">
          {mode === "sign-up"
            ? "Your first video is free. You review it before anything posts."
            : "Your videos and your review queue are waiting."}
        </p>
      </div>

      <form action={onSubmit} className="flex flex-col gap-5">
        {mode === "sign-up" && <Field label="Your name" name="name" autoComplete="name" required maxLength={80} />}
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          required
          minLength={10}
          hint={mode === "sign-up" ? "At least 10 characters." : undefined}
        />
        {error && <InlineAlert title={mode === "sign-up" ? "We couldn't create your account" : "We couldn't sign you in"}>{error}</InlineAlert>}
        <Button type="submit" disabled={pending}>
          {pending && <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />}
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
      </form>

      {googleEnabled && (
        <Button
          variant="tertiary"
          disabled={pending}
          onClick={() => start(async () => void (await authClient.signIn.social({ provider: "google", callbackURL: next })))}
        >
          Continue with Google
        </Button>
      )}

      <p className="text-body-sm text-muted-foreground">
        {mode === "sign-up" ? "Already have an account? " : "New to Vidora? "}
        <Link
          href={`/${mode === "sign-up" ? "sign-in" : "sign-up"}${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-primary-text underline underline-offset-4 hover:no-underline"
        >
          {mode === "sign-up" ? "Sign in" : "Create an account"}
        </Link>
      </p>
      {mode === "sign-up" && (
        <p className="text-caption text-muted-foreground">
          By creating an account, you agree to the{" "}
          <Link href="/legal/terms" className="underline underline-offset-4">
            terms
          </Link>{" "}
          and the{" "}
          <Link href="/legal/privacy" className="underline underline-offset-4">
            privacy policy
          </Link>
          .
        </p>
      )}
    </div>
  )
}
