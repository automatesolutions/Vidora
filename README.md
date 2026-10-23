# AutoShorts Studio

AutoShorts Studio turns one campaign into a steady stream of YouTube Shorts. You set it up once. On every scheduled run, it makes a new Short with your own Higgsfield API key and schedules it on your YouTube channel.

- Architecture and build status: [`docs/AUTOSHORTS.md`](docs/AUTOSHORTS.md)
- How a run makes a video: [`docs/GENERATION.md`](docs/GENERATION.md)
- The earlier Vidora plan: [`docs/PLAN.md`](docs/PLAN.md) (the Vidora wizard is kept at commit `a348446`)
- Design rules: [`.claude/skills/vidora-design/SKILL.md`](.claude/skills/vidora-design/SKILL.md) (source of truth: [`DESIGN.md`](DESIGN.md))
- Google and TikTok applications: [`docs/platform-applications.md`](docs/platform-applications.md)

## How a run works

1. The scheduler picks the next posting slot for a campaign.
2. The director agent (Claude) writes the hook, an open loop, a fast plan of 3-5 s shots, and cinematic Higgsfield prompts (full-frame camera, 35/50mm lenses, motivated light, the run's color grade).
3. Higgsfield renders each scene with your API key, inside the campaign's credit caps.
4. ElevenLabs v4 on your Higgsfield connection reads the narration with emotion tags. FFmpeg then cuts a 9:16 Short with on-screen hook text, word-by-word captions, reframe cuts, whip pans, film grain, a ducked music bed and sound effects (see `apps/worker/src/render.ts`).
5. The Short goes to Approvals, or straight to YouTube as private with a `publishAt` time.

## Layout

```
apps/web            Next.js: UI, auth, YouTube OAuth, Higgsfield webhook        → Cloud Run
apps/worker         BullMQ: run engine, generation, FFmpeg assembly, model refresh → Compute Engine VM
packages/core       Pure rules: generation states, model input, budget, schedules (tested)
packages/director   Director agent (Claude): hooks, scene plans, Higgsfield prompts
packages/providers  VideoProvider interface, HiggsfieldProvider, docs catalog reader
packages/db         Drizzle schema, migrations, generation and spend operations
packages/storage    S3 client (Google Cloud Storage in production, SeaweedFS locally)
infra               Docker Compose, Dockerfiles, Cloud Build configs, worker VM startup script
e2e                 Playwright screen tests with axe accessibility checks
scripts             Brand assets, contrast check, copy lint, launch check
```

## Run it locally

You need Node 22+, pnpm 9, Docker Desktop, and FFmpeg on your `PATH` (or set `FFMPEG_PATH`).

```bash
pnpm install
cp .env.example .env          # then fill in the secrets (the file shows how to make each one)
pnpm stack:up                 # Postgres :5433, Redis :6380, S3 storage :9000
pnpm db:migrate
pnpm storage:seed             # creates the storage bucket and CORS rules
pnpm dev                      # web on http://localhost:3010
pnpm dev:worker               # in a second terminal: the run engine
```

Then open http://localhost:3010/app/connections and add your Higgsfield key.

Service keys in `.env`:

| Env var | What it turns on |
|---|---|
| `ANTHROPIC_API_KEY` | The director agent. Required for scheduled runs: without it, each run fails with `no_director`. |
| `ELEVENLABS_API_KEY` | Caption word timings, music beds and sound effects (made once, then cached), and the fallback voice. |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | YouTube connections. `ALLOW_FAKE_YOUTUBE=true` stubs YouTube for local testing. |
| `RESEND_API_KEY` | Sign-in and notification emails. |

Stop the local stack with `pnpm stack:down`. Wipe the local database with `pnpm db:reset`.

## Try one piece at a time

```bash
pnpm director:try "Daily motivation for students"   # director plan only, a few Claude calls, no Higgsfield credits
pnpm video:test "Daily focus tips for remote workers"   # one real Short end to end, asks before it spends credits
pnpm video:rerender <runId>                         # re-render a run's stored clips with the current voice, captions and sound
pnpm models:refresh                                 # reload the Higgsfield model list into model_registry
```

## Checks

```bash
pnpm check                    # contrast, copy lint, typecheck, lint, unit tests
TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora_test pnpm test   # adds DB integration tests
pnpm e2e                      # Playwright screen tests (desktop and mobile screenshots in e2e/screens)
pnpm launch-check             # what still blocks a public launch (placeholders, legal review, platform applications)
pnpm brand                    # regenerate brand assets from assets/vidora-logo.png
pnpm db:generate              # create a migration after you change the Drizzle schema
```

## Deploy

Everything runs in GCP project `vidora-510913`, region `asia-southeast1`. Secrets live in Secret Manager.

### Web → Cloud Run

Live at https://vidora-web-657635713769.asia-southeast1.run.app

```bash
pnpm deploy:web               # Cloud Build builds infra/web.Dockerfile, pushes it, and deploys vidora-web
```

The runtime service account is `vidora-web@vidora-510913.iam.gserviceaccount.com`. `infra/cloudbuild.web.yaml` sets these on the service:

| Env var | Source |
|---|---|
| `NEXT_PUBLIC_APP_URL`, `APP_URL` | `_APP_URL` substitution (also a build arg) |
| `ENABLE_DESIGN_SYSTEM` | `_ENABLE_DESIGN_SYSTEM` build arg (set `"false"` to hide `/design-system`) |
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION` | Plain env vars: Google Cloud Storage, bucket `vidora-media-510913` |
| `DATABASE_URL` | Secret `database-url` (Neon pooled URL) |
| `BETTER_AUTH_SECRET`, `OAUTH_STATE_SECRET`, `TOKEN_ENCRYPTION_KEYS` | Secrets of the same name in kebab case |
| `HIGGSFIELD_WEBHOOK_SECRET` | Secret `higgsfield-webhook-secret` |
| `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | GCS HMAC key secrets |

The service sends private-range traffic through the `default` VPC.

### Worker → Compute Engine

The worker runs on the `vidora-worker` VM in zone `asia-southeast1-b`, next to its own Redis container.

```bash
pnpm deploy:worker            # builds infra/worker.Dockerfile, pushes it, then reruns the VM startup script
```

[`infra/gcp/worker-startup.sh`](infra/gcp/worker-startup.sh) runs on every boot and every deploy. It pulls the latest image, writes `/etc/vidora/worker.env` from Secret Manager, runs migrations, and restarts Redis and the worker. Redis uses AOF and `noeviction`, so BullMQ never loses queued jobs. Worker logs go to Cloud Logging.

The worker reads the same secrets as the web app, plus `anthropic-api-key`, `elevenlabs-api-key`, `google-oauth-client-id`, and `google-oauth-client-secret`. A missing optional secret comes out empty.

### Secrets

Add a secret and give the service account access:

```bash
printf '%s' '<value>' | gcloud secrets create <name> --data-file=-
gcloud secrets add-iam-policy-binding <name> --member=serviceAccount:vidora-web@vidora-510913.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
```

Rotate a secret with `gcloud secrets versions add <name> --data-file=-`, then redeploy.

Run migrations against Neon with the direct (non-pooled) URL:

```bash
DATABASE_URL='postgres://...' pnpm db:migrate
```
