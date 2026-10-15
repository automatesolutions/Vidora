import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

// End-to-end and UX-audit tests against the local stack. Before running:
//   pnpm stack:up && pnpm storage:seed && pnpm dev   (web on :3010)   and   pnpm dev:worker
// .env needs ALLOW_FAKE_YOUTUBE=true (no Google credentials) so "Connect YouTube" uses a test channel.
// Uses the installed Chrome, so no browser download is needed.
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"))
} catch {
  // CI sets the environment directly.
}

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3010",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 375, height: 812 } } },
  ],
})
