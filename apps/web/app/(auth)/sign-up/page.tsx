import type { Metadata } from "next"
import { Suspense } from "react"
import { AuthForm } from "@/components/vidora/auth-form"

export const metadata: Metadata = { title: "Create your account" }

export default function Page() {
  const googleEnabled = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
  return (
    <Suspense>
      <AuthForm mode="sign-up" googleEnabled={googleEnabled} />
    </Suspense>
  )
}
