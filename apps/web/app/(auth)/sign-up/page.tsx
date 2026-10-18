import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"
import { AuthForm } from "@/components/vidora/auth-form"

export const metadata: Metadata = { title: "Create your account" }

export default function Page() {
  return (
    <Suspense>
      <Form />
    </Suspense>
  )
}

async function Form() {
  // Inside Suspense so the page can prerender. Credentials are runtime env, not build-time.
  await connection()
  const googleEnabled = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
  return <AuthForm mode="sign-up" googleEnabled={googleEnabled} />
}
