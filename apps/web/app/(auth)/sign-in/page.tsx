import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"
import { AuthForm } from "@/components/vidora/auth-form"

export const metadata: Metadata = { title: "Sign in" }

export default function Page() {
  return (
    <Suspense>
      <Form />
    </Suspense>
  )
}

async function Form() {
  await connection()
  const googleEnabled = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
  return <AuthForm mode="sign-in" googleEnabled={googleEnabled} />
}
