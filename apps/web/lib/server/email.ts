import "server-only"

// Transactional email. Resend when RESEND_API_KEY is set; otherwise the message is printed to the server log
// (local dev: copy the link from the terminal). Templates stay plain text until the email design pass.

export async function sendEmail(input: { to: string; subject: string; text: string }) {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    if (process.env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set")
    console.info(`\n[email] to ${input.to}: ${input.subject}\n${input.text}\n`)
    return
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Vidora <hello@example.com>", to: input.to, subject: input.subject, text: input.text }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${await res.text().catch(() => "")}`)
}
