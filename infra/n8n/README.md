# n8n workflows

n8n runs the video pipeline only. It is an internal service: no public port, no OAuth tokens, no large files.
Contracts live in `packages/core/src/contracts.ts` (zod). This page mirrors them for workflow authors.

## Files

| Path | What |
|---|---|
| `code/*.js` | Source of every Code node. Edit these, not the JSON. |
| `build-workflows.mjs` | Assembles `workflows/*.json` from `code/`. Run `pnpm n8n:build`. |
| `workflows/vidora.generate.json` | The generation workflow (Phase 0: **stub pipeline**, makes no real video). |
| `workflows/vidora.error.json` | Error workflow: when an execution crashes, reports the execution ID to Vidora, which fails the job it claimed. |
| `task-runners.json` | Runner launcher config: JavaScript only, `crypto` allowed, minimal environment. |

## Import and publish

```bash
pnpm n8n:build
export MSYS_NO_PATHCONV=1   # Git Bash on Windows only: stops /workflows becoming a Windows path
C="docker compose -f infra/docker-compose.yml --env-file .env"
$C exec -T n8n n8n import:workflow --input=/workflows/vidora.error.json
$C exec -T n8n n8n import:workflow --input=/workflows/vidora.generate.json
$C exec -T n8n n8n publish:workflow --id=VidoraError00001
$C exec -T n8n n8n publish:workflow --id=VidoraGenerate01
$C restart n8n n8n-worker
```

If you change a workflow in the editor (http://127.0.0.1:5678), export it back before committing:
`n8n export:workflow --id=VidoraGenerate01 --output=/tmp/x.json` and copy the Code node bodies into `code/`.

## Contract

**Trigger** (worker → n8n): `POST /webhook/vidora/generate`
- Headers: `x-vidora-timestamp` (unix seconds), `x-vidora-signature: v1=<hex>[,v1=<hex>]`, `idempotency-key: <job_id>:<revision>`
- Signature: `HMAC_SHA256(VIDORA_INBOUND_SECRET, "<timestamp>.<JSON.stringify(body)>")`, 5-minute window
- Body: `GenerateRequest` (job_id, revision, workspace_id, rerun_from_stage, feedback, strategy, topic, providers, limits, reuse_assets, callback_url)
- Reply: `202 {"accepted": true, "execution_id": "..."}`, or `401` when the signature is wrong

**Claim** (n8n → Vidora, first step): `POST {VIDORA_APP_URL}/api/internal/n8n/jobs/{job_id}/claim` with `{revision, execution_id}`.
`200` = go. `409` = another execution owns this revision, or it is stale: stop without calling back.

**Execution failed** (error workflow → Vidora): `POST {VIDORA_APP_URL}/api/internal/n8n/executions/{execution_id}/failed`
with `{message, node, workflow}`, signed with `VIDORA_CALLBACK_SECRET`. Always answers 200; the outcome is `failed`, `ignored`, or `not_found`.

**Callbacks** (n8n → Vidora): `POST {VIDORA_APP_URL}/api/webhooks/n8n`, signed the same way with `VIDORA_CALLBACK_SECRET`.
- `type`: `job.stage_started` | `job.stage_completed` | `job.completed` | `job.failed` (needs `error`)
- `event_id`: unique and **stable across retries** (the stub uses `job:revision:execution:type:stage`)
- `stage`, `progress` (0–1), `assets[]` (R2 keys, never file bytes), `data` (script, title, caption, hashtags), `cost[]` (provider, units, unit, usd)
- Vidora dedupes on `event_id` and drops callbacks for an old revision or another execution.

## Rules for real workflows (Phase 1)

- Call AI providers only through the provider gateway (`/internal/gen/*`), which writes outputs to R2 and returns keys.
- Wait for slow providers with Wait nodes (over 65 s they're saved to the database and free the worker slot).
- Retry provider calls 3 times with backoff. Send `job.failed` with `retryable` set honestly.
- Code nodes may use `require("crypto")` and `$env`. Shell nodes are disabled.

## Security model

- Code nodes run in **external task runners** (`n8n-runner`, `n8n-worker-runner`), not inside n8n.
- `$env` in a Code node shows **n8n's** environment (n8n passes it to the runner). So n8n's own secrets are
  mounted as files (`N8N_ENCRYPTION_KEY_FILE`, `DB_POSTGRESDB_PASSWORD_FILE` from Docker secrets); the
  environment holds only paths. The only secret values in it are the two Vidora signing secrets the workflows need.
- To scale workers, add `n8n-worker-2` plus `n8n-worker-2-runner` (each worker needs its own runner).
- The test hook `topic === "__smoke_crash__"` in the stub crashes on purpose for `pnpm smoke`. It goes away with the stub.
