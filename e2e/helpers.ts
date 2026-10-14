import AxeBuilder from "@axe-core/playwright"
import { expect, type Page } from "@playwright/test"
import postgres from "postgres"

// Shared steps for the e2e tests.

export const PASSWORD = "correct-horse-battery-9"

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.vidora`
}

/** Email links aren't readable in a test, so the test marks the address as confirmed in the database. */
export async function confirmEmail(email: string) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 })
  try {
    await sql`update "user" set email_verified = true where email = ${email}`
  } finally {
    await sql.end()
  }
}

export async function signUp(page: Page, email: string, name = "Mia Santos") {
  await page.goto("/sign-up")
  await page.getByLabel("Your name").fill(name)
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/app\/new/)
}

/** UX audit gate (design skill §8): axe WCAG 2.2 AA in this color scheme, and no sideways scroll. */
export async function audit(page: Page, label: string) {
  await page.waitForLoadState("networkidle")
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()
  const violations = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
  expect(violations, `axe on ${label}`).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, `horizontal overflow on ${label}`).toBeLessThanOrEqual(1)
}
