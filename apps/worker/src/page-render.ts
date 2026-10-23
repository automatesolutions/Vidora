import { lookup } from "node:dns/promises"
import { existsSync } from "node:fs"
import { isIP } from "node:net"
import { chromium } from "playwright-core"
import { log } from "./log"

// Renders a web page in headless Chromium and returns its visible text, for sites that draw their
// content with JavaScript (single-page apps), which Claude's web fetch can't read.
//
// The URL comes from a creator's campaign description, and the browser runs on our server, so every
// request the page makes (the page itself, redirects, scripts, API calls) must go to a public
// internet address: never localhost, the private network, or the cloud metadata server.
// The worker image ships a system Chromium (infra/worker.Dockerfile); locally Playwright's own browser is used.

const NAV_TIMEOUT_MS = 30_000
const SETTLE_MS = 1_500

/** True for loopback, private, link-local (incl. 169.254.169.254 metadata), CGNAT, and other non-public ranges. */
export function isPrivateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7))
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")
  }
  const [a, b] = ip.split(".").map(Number) as [number, number]
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

/** Whether a URL is http(s) and every address its host resolves to is public. */
export async function isPublicUrl(raw: string, resolve: (host: string) => Promise<string[]> = defaultResolve) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => [])
  return addresses.length > 0 && addresses.every((ip) => !isPrivateAddress(ip))
}

/** CHROMIUM_PATH, else the worker image's system Chromium (Alpine names it either way), else Playwright's own. */
function chromiumPath() {
  return process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync) || undefined
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address)

/** The page's visible text after its scripts have run, or null when it can't be rendered safely. */
export async function renderPageText(url: string): Promise<string | null> {
  if (!(await isPublicUrl(url))) {
    log.warn("page render refused: not a public address", { url })
    return null
  }
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--disable-dev-shm-usage"] })
  try {
    const context = await browser.newContext({ javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block", viewport: { width: 1280, height: 900 } })
    // Check every request, including redirects and the page's own API calls. Hosts are checked once.
    const verdicts = new Map<string, Promise<boolean>>()
    await context.route("**/*", async (route) => {
      const target = route.request().url()
      if (target.startsWith("data:") || target.startsWith("blob:")) return route.continue()
      let host: string
      try {
        host = new URL(target).host
      } catch {
        return route.abort()
      }
      if (!verdicts.has(host)) verdicts.set(host, isPublicUrl(target))
      return (await verdicts.get(host)) ? route.continue() : route.abort("blockedbyclient")
    })
    const page = await context.newPage()
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
    // Let the app fetch its content and draw; a page that never goes quiet still gets read.
    await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => {})
    await page.waitForTimeout(SETTLE_MS)
    const text = await page.evaluate(() => document.body?.innerText ?? "")
    return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null
  } catch (err) {
    log.warn("page render failed", { url, error: err instanceof Error ? err.message.slice(0, 200) : String(err) })
    return null
  } finally {
    await browser.close().catch(() => {})
  }
}
