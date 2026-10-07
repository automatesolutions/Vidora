// Assembles infra/n8n/workflows/*.json from the Code node sources in infra/n8n/code/.
// Usage: node infra/n8n/build-workflows.mjs   (then see infra/n8n/README.md to import)
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const code = (name) => readFile(path.join(dir, "code", name), "utf8")

const generate = {
  id: "VidoraGenerate01",
  name: "vidora.generate",
  active: false,
  settings: {
    executionOrder: "v1",
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
    errorWorkflow: "VidoraError00001",
  },
  nodes: [
    {
      id: "6f0b7f1e-0001-4c1e-9a10-000000000001",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "6f0b7f1e-0001-4c1e-9a10-0000000000aa",
      parameters: { httpMethod: "POST", path: "vidora/generate", responseMode: "responseNode", options: {} },
    },
    {
      id: "6f0b7f1e-0001-4c1e-9a10-000000000002",
      name: "Verify signature",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [220, 0],
      parameters: { mode: "runOnceForAllItems", language: "javaScript", jsCode: await code("verify-signature.js") },
    },
    {
      id: "6f0b7f1e-0001-4c1e-9a10-000000000003",
      name: "Signature valid?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.2,
      position: [440, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "6f0b7f1e-0001-4c1e-9a10-0000000000c1",
              leftValue: "={{ $json.valid }}",
              rightValue: "",
              operator: { type: "boolean", operation: "true", singleValue: true },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    },
    {
      id: "6f0b7f1e-0001-4c1e-9a10-000000000004",
      name: "Accepted (202)",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [660, -100],
      parameters: {
        respondWith: "json",
        responseBody: "={{ JSON.stringify({ accepted: true, execution_id: String($execution.id) }) }}",
        options: { responseCode: 202 },
      },
    },
    {
      id: "6f0b7f1e-0001-4c1e-9a10-000000000005",
      name: "Rejected (401)",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [660, 100],
      parameters: {
        respondWith: "json",
        responseBody: '={{ JSON.stringify({ error: "invalid_signature", reason: $json.reason }) }}',
        options: { responseCode: 401 },
      },
    },
    {
      id: "6f0b7f1e-0001-4c1e-9a10-000000000006",
      name: "Run stub pipeline",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [880, -100],
      parameters: { mode: "runOnceForAllItems", language: "javaScript", jsCode: await code("stub-pipeline.js") },
    },
  ],
  connections: {
    Webhook: { main: [[{ node: "Verify signature", type: "main", index: 0 }]] },
    "Verify signature": { main: [[{ node: "Signature valid?", type: "main", index: 0 }]] },
    "Signature valid?": {
      main: [[{ node: "Accepted (202)", type: "main", index: 0 }], [{ node: "Rejected (401)", type: "main", index: 0 }]],
    },
    "Accepted (202)": { main: [[{ node: "Run stub pipeline", type: "main", index: 0 }]] },
  },
  pinData: {},
}

// Runs whenever a Vidora workflow execution crashes; tells Vidora which execution failed.
const error = {
  id: "VidoraError00001",
  name: "vidora.error",
  active: false,
  settings: { executionOrder: "v1" },
  nodes: [
    {
      id: "6f0b7f1e-0002-4c1e-9a10-000000000001",
      name: "Error Trigger",
      type: "n8n-nodes-base.errorTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
    {
      id: "6f0b7f1e-0002-4c1e-9a10-000000000002",
      name: "Report failure",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [220, 0],
      parameters: { mode: "runOnceForAllItems", language: "javaScript", jsCode: await code("report-failure.js") },
    },
  ],
  connections: { "Error Trigger": { main: [[{ node: "Report failure", type: "main", index: 0 }]] } },
  pinData: {},
}

for (const wf of [generate, error]) {
  await writeFile(path.join(dir, "workflows", `${wf.name}.json`), JSON.stringify(wf, null, 2) + "\n")
  console.log(`Wrote infra/n8n/workflows/${wf.name}.json`)
}
