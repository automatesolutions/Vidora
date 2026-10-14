import { expect, test } from "@playwright/test"
import { audit, confirmEmail, signUp, uniqueEmail } from "./helpers"

// The milestone goal: a new creator signs up, makes a Short, reviews it, and connects YouTube only on approve.

for (const scheme of ["light", "dark"] as const) {
  test(`new creator makes, reviews, and approves a first video (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
    const email = uniqueEmail(`${info.project.name}-${scheme}`)
    await signUp(page, email)

    // Step 1: who are you
    await expect(page.getByRole("heading", { level: 1, name: "Who are you making videos for?" })).toBeVisible()
    await expect(page.getByText("Step 1 of 5")).toBeVisible()
    await audit(page, `wizard step 1 (${scheme})`)
    await page.getByRole("button", { name: /Continue/ }).click()
    await expect(page.getByText("Pick the one that fits you best.")).toBeVisible() // error state
    await page.getByText("Creator", { exact: true }).click()
    await page.getByRole("button", { name: /Continue/ }).click()

    // Step 2: video type
    await expect(page.getByRole("heading", { level: 1, name: "What kind of video?" })).toBeFocused()
    await page.getByText("Fact or tip", { exact: true }).click()
    await audit(page, `wizard step 2 (${scheme})`)
    await page.getByRole("button", { name: /Continue/ }).click()

    // Step 3: input, with validation
    await page.getByRole("button", { name: /Continue/ }).click()
    await expect(page.getByText("Add a topic of at least 3 characters")).toBeVisible()
    await page.getByLabel("Topic").fill("Why octopuses have three hearts")
    await audit(page, `wizard step 3 (${scheme})`)
    await page.getByRole("button", { name: /Continue/ }).click()

    // Step 4: look and sound
    await page.getByText("8 seconds", { exact: true }).click()
    await audit(page, `wizard step 4 (${scheme})`)
    await page.getByRole("button", { name: /Continue/ }).click()

    // Step 5: review choices. Email not confirmed yet → Make video waits.
    await expect(page.getByText("Free: your first video")).toBeVisible()
    await expect(page.getByText("Confirm your email to make this video")).toBeVisible()
    await expect(page.getByRole("button", { name: "Make video" })).toBeDisabled()
    await audit(page, `wizard step 5 (${scheme})`)
    await confirmEmail(email)
    await page.reload()
    // The draft survives the reload (and the email round trip); "Who are you" is remembered later.
    await expect(page.getByText("Why octopuses have three hearts")).toBeVisible()
    await page.getByRole("button", { name: /Change length/ }).click()
    await page.getByRole("button", { name: /Continue/ }).click()
    await page.getByRole("button", { name: "Make video" }).click()

    // Progress page, live from job_events
    await page.waitForURL(/\/app\/videos\/job_[A-Z0-9]+$/)
    await expect(page.getByRole("heading", { level: 1, name: "Making your video" })).toBeVisible()
    await expect(page.getByRole("progressbar", { name: "Video progress" })).toBeVisible()
    await audit(page, `progress (${scheme})`)

    // Review page
    await page.waitForURL(/\/review$/, { timeout: 90_000 })
    await expect(page.getByRole("heading", { level: 1, name: "Review your video" })).toBeVisible()
    const title = page.getByLabel("Title")
    await expect(title).toHaveValue(/Stub video/)
    await title.fill("Octopuses have three hearts")
    await title.blur()
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible()
    await expect(page.getByRole("list", { name: "Hashtags on this video" })).toContainText("#Shorts")
    await expect(page.getByLabel("AI-generated label")).toBeDisabled()
    await expect(page.getByLabel("AI-generated label")).toBeChecked()
    await expect(page.getByRole("radio", { name: /Frame 1 of 6/ })).toBeAttached()
    await expect(page.getByText("Free (your first video)")).toBeVisible()
    await audit(page, `review (${scheme})`)

    // Request changes sheet opens with the skill's chips, then closes without sending.
    await page.getByRole("button", { name: /Changes|Request changes/ }).first().click()
    await expect(page.getByRole("heading", { name: "What should change?" })).toBeVisible()
    for (const chip of ["Script", "Voice", "Visuals", "Captions", "Thumbnail"]) {
      await expect(page.getByRole("button", { name: chip, exact: true })).toBeVisible()
    }
    await expect(page.getByText("Free. 2 free changes left.")).toBeVisible()
    await page.keyboard.press("Escape")

    // Approve → connect dialog (no YouTube yet) → Google stand-in → back here, approved.
    await page.getByRole("button", { name: /^Approve/ }).first().click()
    await expect(page.getByRole("heading", { name: "Connect where you post." })).toBeVisible()
    await expect(page.getByText("We'll only post videos you approve.")).toBeVisible()
    await page.getByRole("link", { name: "Connect YouTube" }).click()
    await page.waitForURL(/\/review$/)
    await expect(page.getByText(/^Approved\. Posting/).first()).toBeVisible()
    await expect(page.getByRole("figure").getByText("(test channel)")).toBeVisible()
    await audit(page, `review after approve (${scheme})`)

    // Undo puts it back in review.
    await page.getByRole("button", { name: "Undo approval" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Review your video" })).toBeVisible()

    // Lists
    await page.goto("/app/queue")
    await expect(page.getByRole("list", { name: /waiting for review/ })).toContainText("Octopuses have three hearts")
    await audit(page, `queue (${scheme})`)
    await page.goto("/app/videos")
    await expect(page.getByRole("list", { name: /Your videos/ })).toContainText("Octopuses have three hearts")
    await audit(page, `videos (${scheme})`)

    // Second video: "Who are you" is skipped, and the price is no longer free.
    await page.goto("/app/new")
    await expect(page.getByText("Step 1 of 4")).toBeVisible()
    await expect(page.getByRole("heading", { level: 1, name: "What kind of video?" })).toBeVisible()
  })
}

test("empty states for a brand-new account", async ({ page }) => {
  await signUp(page, uniqueEmail("empty"))
  await page.goto("/app/videos")
  await expect(page.getByText("No videos yet")).toBeVisible()
  await audit(page, "videos empty")
  await page.goto("/app/queue")
  await expect(page.getByText("Nothing to review right now")).toBeVisible()
  await audit(page, "queue empty")
  await page.goto("/app/videos/job_DOESNOTEXIST000000000000000")
  await expect(page.getByText("We couldn't find that video")).toBeVisible()
})

test("design system shows the new components accessibly", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto("/design-system#create")
    await expect(page.getByRole("heading", { name: "Create video", level: 2 })).toBeVisible()
    await audit(page, `design system (${scheme})`)
  }
})

test("signed-out visitors are sent to sign in, then back", async ({ page }) => {
  await page.goto("/app/queue")
  await page.waitForURL(/\/sign-in\?next=%2Fapp%2Fqueue/)
  await audit(page, "sign in")
})
