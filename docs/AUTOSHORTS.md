# AutoShorts Studio: architecture (Phase 1)

AutoShorts Studio turns a one-time **Campaign** into a stream of new YouTube Shorts. Each scheduled run
makes a fresh variation through the user's own **Higgsfield** API key, assembles a 9:16 Short, and uploads
it to YouTube as private with a `publishAt` time. Rebuilt on 2026-10-14 from the Vidora repo (the Vidora
wizard is preserved at commit `a348446` on `main`).

## Build order

| Step | Scope | Status |
|---|---|---|
| 1 | Project structure, DB schema, `HiggsfieldProvider` with resumable jobs | **Done** |
| 1b | Director agent (Claude): hooks, scene plans, Higgsfield prompts; "Connect Higgsfield" (plan credits via MCP) | **Done** |
| 2 | Scheduler (daily / weekly / 3x week / custom), run engine (variation → director → scenes → voice → FFmpeg → approval/auto → YouTube publishAt), credit caps, Original + Product modes | **Done** (needs ANTHROPIC_API_KEY to run) |
| 3 | UI: Dashboard, Campaigns (wizard + controls), Video Library, Approvals, Connections | **Done** (Brand Kit and Settings next) |
| 4 | UGC-style and Clipping modes, analytics, email/Telegram notifications | Next |

## Layout

```
apps/web            Next.js: UI, auth, YouTube OAuth, Higgsfield webhook          → Cloud Run
apps/worker         BullMQ workers: generation engine, model refresh, (step 2) runs and uploads → Compute Engine VM
packages/core       Pure rules: generation states, retries, model input, budget, schedules, YouTube helpers
packages/providers  VideoProvider interface + HiggsfieldProvider + docs catalog reader
packages/db         Drizzle schema, migrations, generation/spend/credential/model operations
packages/storage    S3 client (Cloud Storage in production, SeaweedFS locally)
infra               docker compose: Postgres (dev), Redis (BullMQ), storage (dev), worker (prod)
```

## Data model

Auth and tenancy: `user`, `session`, `account`, `verification`, `workspaces`, `workspace_members`, `invitation`.

| Table | Purpose |
|---|---|
| `provider_credentials` | The workspace's Higgsfield key, AES-256-GCM encrypted (`TOKEN_ENCRYPTION_KEYS`). Status, last check, user-entered balance. |
| `model_registry` | One row per Higgsfield endpoint, refreshed daily from docs.higgsfield.ai: input JSON schema, durations, aspect ratios, resolutions, seed support, `verticalFromText`, cached cost estimates. |
| `connected_accounts` | YouTube channels (encrypted OAuth tokens), per-channel daily upload cap. |
| `campaigns` / `schedules` | Mode, brief, model preferences, variation intensity and locks, per-run and monthly USD caps, publish mode (auto by default), schedule (frequency, days, times, time zone, hours ahead). |
| `runs` / `run_events` | One run per posting slot (`unique(campaign_id, slot_at)` prevents double-booking). Plan, chosen variation, estimate, status history. |
| `generation_jobs` | One paid Higgsfield request each. Resumable (see below). |
| `videos` | Library entries: Generating / Ready / Scheduled / Published / Failed, YouTube IDs, cost. |
| `variation_fingerprints` | Element values + hash per run (`unique(campaign_id, hash)`), hook shingles for similarity. |
| `assets`, `uploads`, `brand_kits` | Scene clips, voiceover, captions, thumbnails, finals; user files; brand kit. |
| `spend_ledger` | Append-only hold / charge / release per generation job (`unique(generation_job_id, kind)`). |
| `upload_logs`, `youtube_quota_days` | Every YouTube call and its quota cost; daily project quota (Pacific date). |
| `analytics_snapshots` | Views, likes, comments over time. |
| `webhook_events`, `notifications` | Webhook dedupe; in-app/email/Telegram notices. |

## Higgsfield integration

Verified against the docs on 2026-10-14:

- Auth `Authorization: Key KEY_ID:KEY_SECRET`. Submit `POST /{endpoint}` with an `Idempotency-Key`,
  optional `?hf_webhook=`. Status `GET /requests/{id}/status`: `queued`, `in_progress`, `completed`,
  `failed`, `nsfw`, `canceled`. Cancel `POST /requests/{id}/cancel` (queued only). Estimate
  `POST /estimate/{endpoint}` → `{ credits, usd }`.
- `failed` and `nsfw` are not billed. Outputs are kept for at least 7 days. Concurrency limits come back as `400`.
- **Not in the API:** an account balance endpoint. The balance is user-entered in Connections, and we
  subtract what we've charged since. A `403` (out of credits) also pauses work.
- Webhooks are **not signed**. Our webhook URL carries our own signed token, and the payload only moves
  the job's next check to "now"; the worker then reads the real status with the user's key.

`HiggsfieldProvider` (packages/providers) implements `VideoProvider`: `listModels`, `estimateCost`,
`submitGeneration`, `pollStatus`, `downloadResult`, `cancel`, `verifyCredentials`. It never sends the key
to any host but the API (status and cancel URLs from responses are checked), and it downloads outputs
without the key.

Requests are built per model from the registry's JSON schema (`buildModelInput` in packages/core): only
documented fields, duration rounded up to an allowed value, `aspect_ratio: "9:16"`, a seed in the model's
range, native sound off. A model that can't make vertical video from a prompt alone is refused.

## Resumable generation jobs

```
pending ─submit─▶ submitted ─poll─▶ in_progress ─poll─▶ completed ─download─▶ stored
   └──────────────────┴──────────────────┴──▶ failed | nsfw | canceled | timed_out
```

- The row is the source of truth. Every step is compare-and-set on `status` and `version`, so a replayed
  or racing step changes nothing.
- The idempotency key is written **before** the first submit. After a crash, timeout, or `5xx`, the same
  key is sent again, and Higgsfield returns the original request instead of billing a second one.
- The worker's sweep reads due rows from Postgres every 3 s and enqueues `"{id}.v{version}"` in BullMQ.
  If Redis is wiped or the worker restarts, the next sweep picks everything up again.
- Money: a hold is written when the job is created (caps see it right away), then either charge + release
  (stored) or release only (failed, nsfw, canceled, timed out, rejected).
- Retries (spec: 2 retries, then fail; moderation gets 1 retry with a rewritten prompt) create a **new**
  job row with a new key (`retryDecision` in packages/core). The run orchestrator applies them in step 2.

## Director agent (packages/director)

Writes the creative plan and the Higgsfield prompts for each run, from the campaign's description.

1. **Variation engine** (`pickVariation` in packages/core, plain code) picks this run's visual style, camera
   language, pacing, script angle, caption style, music mood, voice, and model. It respects locks and the
   Low / Medium / High intensity (2 / 4 / all unlocked axes change), prefers the least recently used option,
   and won't repeat any of the last 30 combinations.
2. **Ideate** (Claude Opus 5.5, effort medium): 8 hook candidates. Code picks the one least like the
   campaign's past hooks (word-pair similarity under 0.45), preferring this run's angle; if none qualify,
   it asks once more, then fails the run.
3. **Direct** (effort high): the full plan. For each scene it writes structured shot fields (shot type,
   subject, action, setting, light, one camera move, framing, style, mood), assembles a prompt from them,
   and adds the voiceover line and caption words. One fixed `subject_anchor` is pasted word for word into
   every prompt where the subject appears, since each Higgsfield generation is independent.
4. **Check** (`validatePlan`, plain code): allowed durations, total under 60 s, prompt length within the
   model's limit, "vertical 9:16 composition", no text/logo/signage requests, one continuous shot, the anchor
   present, banned topics, the hook spoken first, narration that fits the time. Failures go back to Claude
   with the exact messages (up to 2 repairs); remaining errors fail the run, remaining warnings are logged.
5. **Moderation retry**: `rewriteForModeration` rewrites a prompt Higgsfield rejected as nsfw, once.

Every call uses structured outputs, adaptive thinking, a cached system prompt and run context (the second
call reads the first one's cache), and `fallbacks: "default"` for refusals. Try it on a sample campaign:
`pnpm director:try "Daily motivation for students"` (needs `ANTHROPIC_API_KEY`).

## Runs (apps/worker/src/run-engine.ts)

`planned → generating → assembling → [awaiting_approval] → uploading → scheduled → published` (+ failed, skipped, canceled).
The worker books the next three slots of every active campaign each minute (`unique(campaign_id, slot_at)`), then
advances due runs with the same compare-and-set + `next_check_at` pattern as generation jobs. Planning claims the
run first (a 20-minute lease) because the director call takes a minute or two. Failed scenes retry twice with a
new request; moderation rejections get one Claude rewrite. Three failed runs in a row pause the campaign; budget
and credential problems pause it immediately with the reason shown on the campaign page.

Tests use a separate database so a running `pnpm dev:worker` never picks up test rows:
`TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora_test pnpm test` (create it once with
`createdb` in the compose Postgres and run `DATABASE_URL=…/vidora_test pnpm db:migrate`).

## Local setup

```bash
pnpm stack:up          # Postgres :5433, Redis :6380, storage :9000
pnpm db:migrate
pnpm dev               # web on :3010
pnpm dev:worker        # generation engine; fills the model registry on first start
pnpm models:refresh    # refresh the registry by hand
```

Add the Higgsfield key in the app under **Connections**. `pnpm db:reset` wipes a local database (it refuses
any non-local host).
