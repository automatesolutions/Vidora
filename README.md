# AutoShorts Studio

Set up a campaign once. On every scheduled run, AutoShorts Studio makes a new Short with your own Higgsfield API key and schedules it on your YouTube channel.

- Architecture and status: [`docs/AUTOSHORTS.md`](docs/AUTOSHORTS.md) (the earlier Vidora plan: [`docs/PLAN.md`](docs/PLAN.md))
- Design rules: [`.claude/skills/vidora-design/SKILL.md`](.claude/skills/vidora-design/SKILL.md) (source of truth: [`DESIGN.md`](DESIGN.md))
- Google and TikTok applications: [`docs/platform-applications.md`](docs/platform-applications.md)

## Layout

```
apps/web            Next.js: UI, auth, YouTube OAuth, Higgsfield webhook   → Cloud Run (GCP)
apps/worker         BullMQ: generation engine, model registry refresh      → VPS (Docker)
packages/core       Pure rules: generation states, model input, budget, schedules (tested)
packages/providers  VideoProvider interface, HiggsfieldProvider, docs catalog reader
packages/db         Drizzle schema, migrations, generation and spend operations
packages/storage    S3 client (R2 in production, SeaweedFS locally)
infra               docker compose (Redis, dev Postgres, dev storage, worker)
scripts             brand assets, contrast check, copy lint
```

## Run it locally

Needs Node 22+, pnpm 9, and Docker Desktop.

```bash
pnpm install
cp .env.example .env          # then fill in the secrets (command in the file)
pnpm stack:up                 # Postgres :5433, Redis :6380, S3 storage :9000
pnpm db:migrate
pnpm storage:seed             # creates the storage bucket and CORS rules
pnpm dev                      # web on http://localhost:3010
pnpm dev:worker               # in a second terminal: Higgsfield generation engine
# then open http://localhost:3010/app/connections and add your Higgsfield key
```

## Checks

```bash
pnpm check                    # contrast, copy lint, typecheck, lint, unit tests
TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora_test pnpm test   # adds DB integration tests
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
