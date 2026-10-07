// n8n Code node: "Report failure" in the vidora.error workflow (run once for all items).
// Runs when any Vidora workflow execution crashes. Vidora finds the job by the execution ID it recorded at claim time.
const crypto = require("crypto")

const { execution, workflow } = $input.first().json
if (!execution || !execution.id) return [{ json: { reported: false, reason: "no execution id (error before the run started)" } }]

const base = String($env.VIDORA_APP_URL || "").replace(/\/$/, "")
const secret = String($env.VIDORA_CALLBACK_SECRET || "").split(",")[0].trim()
const body = JSON.stringify({
  message: String((execution.error && execution.error.message) || "The workflow failed.").slice(0, 5000),
  node: execution.lastNodeExecuted || null,
  workflow: (workflow && workflow.name) || null,
})
const ts = Math.floor(Date.now() / 1000)
const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")

const res = await this.helpers.httpRequest({
  method: "POST",
  url: `${base}/api/internal/n8n/executions/${encodeURIComponent(String(execution.id))}/failed`,
  body,
  json: false,
  headers: { "content-type": "application/json", "x-vidora-timestamp": String(ts), "x-vidora-signature": `v1=${sig}` },
  returnFullResponse: true,
  ignoreHttpStatusErrors: true,
  timeout: 15000,
})
return [{ json: { reported: res.statusCode === 200, status: res.statusCode, body: res.body } }]
