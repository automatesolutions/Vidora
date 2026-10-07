// n8n Code node: "Run stub pipeline" (run once for all items).
// PHASE 0 STUB. It makes no real video. It proves the signed round trip:
// claim → one signed callback per stage → job.completed (or job.failed on any error).
// Phase 1 replaces this node with real stage nodes that call the provider gateway.
const crypto = require("crypto")

const job = $("Verify signature").first().json.job
const base = String($env.VIDORA_APP_URL || "").replace(/\/$/, "")
const secret = String($env.VIDORA_CALLBACK_SECRET || "").split(",")[0].trim()
const executionId = String($execution.id)
const helpers = this.helpers

async function signedPost(path, payload) {
  const body = JSON.stringify(payload)
  const ts = Math.floor(Date.now() / 1000)
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")
  const res = await helpers.httpRequest({
    method: "POST",
    url: base + path,
    body,
    json: false,
    headers: { "content-type": "application/json", "x-vidora-timestamp": String(ts), "x-vidora-signature": `v1=${sig}` },
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    timeout: 15000,
  })
  return { status: res.statusCode, body: res.body }
}

const event = (type, stage, extra = {}) => ({
  event_id: `${job.job_id}:${job.revision}:${executionId}:${type}:${stage ?? "end"}`, // stable, so retries dedupe
  type,
  job_id: job.job_id,
  revision: job.revision,
  execution_id: executionId,
  stage,
  ...extra,
})

const claim = await signedPost(`/api/internal/n8n/jobs/${job.job_id}/claim`, { revision: job.revision, execution_id: executionId })
if (claim.status !== 200) {
  // Someone else owns this revision, or it is stale. Stop quietly.
  return [{ json: { claimed: false, status: claim.status, body: claim.body } }]
}

// Smoke-test hook: crash outside the try/catch so only the vidora.error workflow reports it.
if (job.topic === "__smoke_crash__") throw new Error("Smoke test crash")

const stages = ["ideation", "script", "voiceover", "visuals", "captions", "thumbnail", "render"]
const startAt = job.rerun_from_stage ? Math.max(0, stages.indexOf(job.rerun_from_stage)) : 0
const sent = []
try {
  for (let i = startAt; i < stages.length; i++) {
    const stage = stages[i]
    const extra = { progress: Number(((i + 1) / stages.length).toFixed(2)), cost: [{ provider: "stub", units: 1, unit: "call", usd: 0 }] }
    if (stage === "script") {
      extra.data = {
        title: `Stub video: ${job.topic || job.strategy.niche}`,
        caption: "Stub caption from the Phase 0 pipeline.",
        hashtags: ["#vidora", "#stub"],
      }
    }
    const r = await signedPost("/api/webhooks/n8n", event("job.stage_completed", stage, extra))
    if (r.status !== 200) throw new Error(`Callback for ${stage} returned ${r.status}: ${r.body}`)
    sent.push(stage)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const prefix = `${job.workspace_id}/${job.job_id}/r${job.revision}`
  const done = await signedPost(
    "/api/webhooks/n8n",
    event("job.completed", "render", {
      progress: 1,
      assets: [
        { kind: "final_video", storage_key: `${prefix}/final.mp4`, mime: "video/mp4", duration_ms: 42000, width: 1080, height: 1920 },
        { kind: "thumbnail", storage_key: `${prefix}/thumb.jpg`, mime: "image/jpeg", width: 1080, height: 1920 },
      ],
    })
  )
  if (done.status !== 200) throw new Error(`job.completed returned ${done.status}: ${done.body}`)
  return [{ json: { claimed: true, stages: sent, completed: true } }]
} catch (err) {
  await signedPost(
    "/api/webhooks/n8n",
    event("job.failed", sent.length ? stages[startAt + sent.length] ?? null : null, {
      error: { code: "stub_error", message: String(err && err.message ? err.message : err).slice(0, 500), retryable: true },
    })
  )
  throw err
}
