# Vidora plan (approved 2026-10-07)

Condensed record of the approved implementation plan. Design rules live in `.claude/skills/vidora-design/SKILL.md`.

## Decisions (defaults accepted for all 8 open questions)

1. MVP is **shorts only** (9:16, up to 60s). Long-form comes in Phase 2.
2. Visual style: **hybrid** as Standard (AI images with motion, stock footage, a few AI clips). **All-AI clips** as Premium.
3. **Global, USD**, Stripe.
4. Start the Google OAuth verification, the YouTube API audit, and the TikTok app audit in Phase 0, because they take weeks.
5. Before the TikTok audit passes, posts go to TikTok as **inbox drafts**.
6. Hosting: **Cloud Run on GCP** (web, changed from Vercel on 2026-10-07) + **one Hetzner VPS** with Docker Compose (worker, provider gateway, n8n main and workers, Redis) + **Neon** Postgres + **Cloudflare R2**.
7. Auth: **Better Auth** with the organization plugin.
8. Fonts: **Mona Sans** (display) + **Inter** (body). Logo: vectorized from the PNG, dark variant with a `#FFFEFB` wordmark.

## Architecture rules

- n8n runs the generation pipeline only, in queue mode, with **no public ingress**. The worker calls it over the private network, and it calls back to Vidora over HTTPS with HMAC signatures (`${timestamp}.${rawBody}`, a separate secret for each direction, a 5-minute window, and `event_id` dedupe).
- n8n never handles large files or OAuth tokens. The provider gateway (TypeScript, in the worker) wraps the AI providers, writes outputs to R2, and tracks cost. Publishing to YouTube and TikTok happens in the Vidora worker.
- App job queue: **pg-boss** (Postgres). Video state machine: `queued → generating → pending_approval → approved/rejected/changes_requested → scheduled → publishing → published/publish_failed`. Every change goes through a pure `transition()` function and is logged in `job_events`.
- Credits are reserved at `queued`, charged at `pending_approval`, and released on failure or cancel. Each video includes 2 free change requests.
- Tables: users (Better Auth), workspaces, workspace_members, connected_accounts (encrypted tokens), content_strategies, video_jobs, job_events, assets, approvals, scheduled_posts, post_metrics, subscriptions, credit_ledger, provider_runs, webhook_events, notifications.

## Platform risks to keep checking

- **YouTube:** the default quota is 10k units per day, and an upload has historically cost about 1,600 units, so a quota extension is needed. Unaudited projects can only upload private videos. The `youtube.upload` scope needs Google OAuth verification. Set `containsSyntheticMedia` on every upload.
- **TikTok:** Direct Post needs an audit. Unaudited apps can only post privately, for up to 5 creators in 24 hours. TikTok's required posting UX includes creator info, privacy chosen by the creator, interaction toggles, and disclosure. Label AI-generated content.
- **Content rules:** YouTube's inauthentic-content policy. No copyrighted music. Block real-person likeness. Voice cloning only with consent.

## Pricing (draft)

1 credit costs the customer $0.25 and costs us about $0.08. Standard short = 20 credits, Premium short = 60, long-form = 150.

| Plan | Price per month | Credits |
|---|---|---|
| Trial | $0 | 40 |
| Creator | $39 | 160 |
| Pro | $99 | 450 |
| Studio | $249 | 1,200 |

Top-up: 100 credits for $29.

## Roadmap

- **Phase 0 (1.5–2 weeks):** setup, tokens, brand assets, `/design-system`, compose stack, legal pages, platform applications.
- **Phase 1 (7–9 weeks):** MVP for shorts. Auth and workspaces, connect accounts, strategy, the n8n pipeline, the approval queue (desktop and mobile), publishing, Stripe, email notifications.
- **Phase 2 (5–6 weeks):** long-form, calendar, analytics, multiple providers, in-app notifications, team roles.
- **Phase 3:** Postgres row-level security, scaling, brand kits, voice cloning, PWA push, more platforms.

Every UI phase must pass the UX audit gate in the skill file (§8).

## Phase 0 status

| # | Task | Status |
|---|---|---|
| 1 | Design skill file | Done |
| 2 | Repo and pnpm workspace | Done, CI in `.github/workflows/ci.yml` |
| 3 | Next.js app and tokens | Done |
| 4 | Contrast check and copy lint | Done |
| 5 | Brand assets | Done |
| 6 | `/design-system` | Done, passed the audit |
| 7 | `packages/db` schema | Done: 19 tables, first migration, 5 integration tests |
| 8 | `packages/core` state machine and contracts | Done: 20 unit tests |
| 9 | Compose stack and signed n8n round trip | Done: `pnpm smoke` passes end to end (stub pipeline) |
| 10 | Legal pages and platform applications | Built: `/legal/privacy`, `/legal/terms`, `docs/platform-applications.md`. Placeholders, lawyer review, and submission need Jonel (`pnpm launch-check`) |

## Phase 0 notes (2026-10-07)

- Local dev runs the web app on **port 3010** (3000 is used by another app on Jonel's machine). App DB on 5433.
- n8n pinned to **2.42.4** (queue mode). Workflows activate with `n8n publish:workflow` in 2.x.
- The `queued` status is the dispatch outbox: the worker takes queued jobs with `FOR UPDATE SKIP LOCKED`,
  and a dispatch that n8n never claims goes stale after 10 minutes and is retried (failed after 5 attempts).
- n8n Code nodes run in external task runners. n8n's secrets are mounted as files (see infra/n8n/README.md).
- The `vidora.error` workflow reports crashed executions. `pnpm smoke` tests both the success path and the crash path.
- Google verification and TikTok review need a demo of the working connect-and-post flow, so they're
  submitted early in Phase 1 (docs/platform-applications.md).
- Carried into Phase 1:
  - Act on callback effects (notifications).
  - Check the Better Auth tables against its CLI when installing it.

## Phase 1 milestone: first video (2026-10-11)

Goal: a new creator signs up, makes an 8 or 15 second Short, reviews it, and connects YouTube only when approving.
Built on the stub pipeline (it returns a sample video); the real pipeline is GENERATION.md G2.

Defaults accepted without answers (Jonel said "please proceed"): first video free on top of the 40 trial credits,
email must be confirmed before making a video · 8 s = 6 credits, 15 s = 10 · only 8 s / 15 s and Standard in the wizard ·
"Bring a photo to life" only for photos without people (checkbox for now, no face check) · visibility choice shown, upload
is Private until the YouTube audit (`YOUTUBE_AUDITED`) · made-for-kids switch per video, default No · email + password
sign-in, Google sign-in when configured · "Who are you" asked once per workspace · music only from a royalty-free
library (not chosen) · languages en, es, pt, fr, de.

What shipped:

| Area | Where |
|---|---|
| Better Auth + organization plugin, mapped onto `workspaces` / `workspace_members` (ws_ IDs) | `apps/web/lib/auth.ts`, `packages/db/src/auth-adapter.ts`, migration `0001_first_video` |
| Wizard `/app/new` (5 steps, draft kept per tab) | `apps/web/app/app/new/` |
| Brief contract and short pricing | `packages/core/src/brief.ts`, `credits.ts`, `contracts.ts` (new fields optional) |
| Progress `/app/videos/[id]` (polls `/api/videos/[id]/progress`, ETag) | stage callbacks now logged in `job_events` |
| Review `/app/videos/[id]/review` (autosave, cover frames, AI label locked on) | `packages/db/src/review.ts` |
| Connect on approve (Google OAuth + PKCE, tokens AES-256-GCM) | `apps/web/app/api/connect/youtube/` |
| Publishing in the worker (refresh, resumable upload, cover, retries, reconnect) | `apps/worker/src/publish.ts`, `packages/db/src/publishing.ts` |
| Uploads (signed PUT, then size and file-type check) and storage | `packages/storage`, `apps/web/app/api/uploads/` |
| Videos list and queue | `/app/videos`, `/app/queue` |

Polling, not server-sent events: Neon's pooled connections can't LISTEN/NOTIFY, so a stream would poll the database
anyway while holding a Cloud Run request open for the whole job.

Tests: core 42, DB integration 14, worker 8 (Google mocked), `pnpm smoke` (adds a wizard job), `pnpm e2e` (Playwright on
the installed Chrome: the full flow at 375 and 1280 px in light and dark, with axe WCAG 2.2 AA and overflow checks).

Local dev notes:
- Storage is SeaweedFS 4.47 in the compose `dev` profile (MinIO stopped publishing images). `pnpm storage:seed` once.
- Without Google credentials and with `ALLOW_FAKE_YOUTUBE=true`, "Connect YouTube" makes a test channel and the
  worker simulates the upload. Ignored when `NODE_ENV=production`.

Open:
- Real Google OAuth client, verification of `youtube.upload`, and the API audit (uploads stay Private until then).
- Custom covers need a verified channel, and the Shorts feed may ignore them.
- Email provider (Resend key) for verification emails in production.
- Notifications (`notify_review`, `notify_failure`) are still not acted on.
- Stale dispatch after an n8n restart waits 10 minutes before retrying (outbox design); consider a faster first retry.
