# Vidora plan (approved 2026-10-07)

Condensed record of the approved implementation plan. Design rules live in `.claude/skills/vidora-design/SKILL.md`.

## Decisions (defaults accepted for all 8 open questions)

1. MVP is **shorts only** (9:16, up to 60s). Long-form comes in Phase 2.
2. Visual style: **hybrid** as Standard (AI images with motion, stock footage, a few AI clips). **All-AI clips** as Premium.
3. **Global, USD**, Stripe.
4. Start the Google OAuth verification, the YouTube API audit, and the TikTok app audit in Phase 0, because they take weeks.
5. Before the TikTok audit passes, posts go to TikTok as **inbox drafts**.
6. Hosting: **Vercel** (web) + **one Hetzner VPS** with Docker Compose (worker, provider gateway, n8n main and workers, Redis) + **Neon** Postgres + **Cloudflare R2**.
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
