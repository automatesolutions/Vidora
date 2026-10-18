"use client"

import { LoaderCircle } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useId, useState, useTransition } from "react"
import { siGoogle } from "simple-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InlineAlert } from "@/components/vidora/inline-alert"
import { authClient } from "@/lib/auth-client"

// Sign up and sign in. "Continue with Google" comes first when Google is configured (one click: new
// Google users get an account and a workspace, returning ones are signed in). Email and password stay
// as the fallback.

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
  const googleError = params.get("error")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function google() {
    setError(null)
    start(async () => {
      const res = await authClient.signIn.social({ provider: "google", callbackURL: next, newUserCallbackURL: next, errorCallbackURL: `/${mode}` })
      if (res?.error) setError(res.error.message ?? "Google sign-in didn't start. Try again.")
    })
  }

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
        <h1 className="font-display text-display-md">{mode === "sign-up" ? "Create your account" : "Sign in to Vidora"}</h1>
        <p className="text-body-md text-muted-foreground">
          {googleEnabled
            ? "Continue with your Google account. It takes one click."
            : mode === "sign-up"
              ? "Use your email to get started."
              : "Your campaigns and videos are waiting."}
        </p>
      </div>

      {googleEnabled && (
        <div className="flex flex-col gap-4">
          <Button size="lg" onClick={google} disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden className="fill-current">
                <path d={siGoogle.path} />
              </svg>
            )}
            Continue with Google
          </Button>
          {googleError && (
            <InlineAlert title="Google sign-in didn't finish">
              {googleError === "access_denied"
                ? "Google sign-in was canceled. Try again when you're ready."
                : googleError === "account_not_linked"
                  ? "This email already has an account with a password, and its email isn't confirmed yet. Sign in with your email and password below, then confirm your email from the message we sent. After that, Google works too."
                  : "Something went wrong with Google. Try again, or use your email below."}
            </InlineAlert>
          )}
          <div className="flex items-center gap-3 text-body-sm text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            or use your email
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

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
        <Button type="submit" variant={googleEnabled ? "secondary" : "primary"} disabled={pending}>
          {pending && <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />}
          {mode === "sign-up" ? "Create account" : "Sign in with email"}
        </Button>
      </form>

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
