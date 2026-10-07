// n8n Code node: "Verify signature" (run once for all items).
// Checks the HMAC Vidora put on the trigger (docs/PLAN.md §4.4). Vidora signs JSON.stringify(body),
// and n8n parses then re-serializes the same JSON, so the strings match.
const crypto = require("crypto")

const { headers, body } = $input.first().json
const raw = JSON.stringify(body)
const ts = headers["x-vidora-timestamp"]
const given = String(headers["x-vidora-signature"] || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.startsWith("v1="))
  .map((s) => s.slice(3))
const secrets = String($env.VIDORA_INBOUND_SECRET || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

let valid = false
const fresh = ts && Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) <= 300
if (fresh) {
  for (const secret of secrets) {
    const expected = crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex")
    if (given.some((g) => g.length === expected.length && crypto.timingSafeEqual(Buffer.from(g, "hex"), Buffer.from(expected, "hex")))) {
      valid = true
    }
  }
}

return [{ json: { valid, reason: valid ? null : fresh ? "mismatch" : "stale", job: valid ? body : null } }]
