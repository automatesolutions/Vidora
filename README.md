# Vidora

Vidora makes videos for YouTube and TikTok channels and posts only the ones you approve.

- Plan and status: [`docs/PLAN.md`](docs/PLAN.md)
- Design rules: [`.claude/skills/vidora-design/SKILL.md`](.claude/skills/vidora-design/SKILL.md) (source of truth: [`DESIGN.md`](DESIGN.md))
- n8n workflows: [`infra/n8n/README.md`](infra/n8n/README.md)
- Google and TikTok applications: [`docs/platform-applications.md`](docs/platform-applications.md)

## Layout

```
apps/web        Next.js app (UI, API, n8n callbacks)        → Cloud Run (GCP)
apps/worker     Dispatch to n8n, reconciler, pg-boss jobs    → VPS (Docker)
packages/core   State machine, credits, signing, contracts (pure, tested)
packages/db     Drizzle schema, migrations, job operations
infra           docker compose (n8n queue mode, Redis, dev Postgres), n8n workflows
scripts         brand assets, contrast check, copy lint
```

## Run it locally

Needs Node 22+, pnpm 9, and Docker Desktop.

```bash
pnpm install
cp .env.example .env          # then fill in the secrets (command in the file)
pnpm stack:up                 # n8n + Redis + Postgres (app DB on localhost:5433)
pnpm db:migrate
pnpm storage:seed             # S3-compatible storage on :9000 (bucket, CORS, sample video for the stub)
pnpm n8n:build                # then import + publish the workflow (infra/n8n/README.md)
pnpm dev                      # web on http://localhost:3010
pnpm dev:worker               # in a second terminal
pnpm smoke                    # end-to-end signed round trip
pnpm e2e                      # browser tests: sign up → make a video → review → connect on approve (uses your Chrome)
```

## Checks

```bash
pnpm check                    # contrast, copy lint, typecheck, lint, unit tests
TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora pnpm test   # adds DB integration tests
pnpm brand                    # regenerate brand assets from assets/vidora-logo.png
pnpm launch-check             # what still blocks a public launch (placeholders, legal review, platform applications)
```

## Deploy (web → Cloud Run)

GCP project `vidora-510913`, region `asia-southeast1`. Live at https://vidora-web-657635713769.asia-southeast1.run.app

```bash
pnpm deploy:web               # Cloud Build: builds infra/web.Dockerfile, pushes to Artifact Registry, deploys
```

Secrets live in Secret Manager and are mounted as env vars; the runtime service account is `vidora-web@vidora-510913.iam.gserviceaccount.com`.

| Env var | Source |
|---|---|
| `N8N_TO_VIDORA_SECRET` | secret `n8n-to-vidora-secret` |
| `DATABASE_URL` | secret `database-url` (Neon pooled URL), added once Neon exists, see below |
| `NEXT_PUBLIC_APP_URL` | build arg + env, `_APP_URL` in `infra/cloudbuild.web.yaml` |
| `ENABLE_DESIGN_SYSTEM` | build arg, `_ENABLE_DESIGN_SYSTEM` in `infra/cloudbuild.web.yaml` (set `"false"` to hide `/design-system`) |

Add the database (once):

```bash
printf '%s' 'postgres://...neon.tech/vidora?sslmode=require' | gcloud secrets create database-url --data-file=-
gcloud secrets add-iam-policy-binding database-url --member=serviceAccount:vidora-web@vidora-510913.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud run services update vidora-web --region asia-southeast1 --update-secrets DATABASE_URL=database-url:latest
DATABASE_URL='postgres://...' pnpm db:migrate   # use the direct (non-pooled) URL for migrations
```

Rotate a secret with `gcloud secrets versions add <name> --data-file=-`, then redeploy.
