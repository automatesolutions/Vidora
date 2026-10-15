# AutoShorts Studio

Set up a campaign once. On every scheduled run, AutoShorts Studio makes a new Short with your own Higgsfield API key and schedules it on your YouTube channel.

- Architecture and status: [`docs/AUTOSHORTS.md`](docs/AUTOSHORTS.md) (the earlier Vidora plan: [`docs/PLAN.md`](docs/PLAN.md))
- Design rules: [`.claude/skills/vidora-design/SKILL.md`](.claude/skills/vidora-design/SKILL.md) (source of truth: [`DESIGN.md`](DESIGN.md))
- Google and TikTok applications: [`docs/platform-applications.md`](docs/platform-applications.md)

## Layout

```
apps/web            Next.js: UI, auth, YouTube OAuth, Higgsfield webhook   → Cloud Run (GCP)
apps/worker         BullMQ: generation engine, model registry refresh      → Compute Engine VM (GCP)
packages/core       Pure rules: generation states, model input, budget, schedules (tested)
packages/providers  VideoProvider interface, HiggsfieldProvider, docs catalog reader
packages/db         Drizzle schema, migrations, generation and spend operations
packages/storage    S3 client (Cloud Storage in production, SeaweedFS locally)
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

## Deploy (GCP)

Everything runs in GCP project `vidora-510913`, region `asia-southeast1`.
Live at https://vidora-web-657635713769.asia-southeast1.run.app

```bash
pnpm deploy:web               # Cloud Build → Artifact Registry → Cloud Run
pnpm deploy:worker            # Cloud Build → Artifact Registry, then reruns the VM's startup script
```

| Piece | Where |
|---|---|
| Web app | Cloud Run `vidora-web` (service account `vidora-web@`), reaches the database over the default VPC |
| Worker + Redis | VM `vidora-worker` (e2-small, zone `asia-southeast1-b`, no public IP, internet through Cloud NAT `vidora-nat`). `infra/gcp/worker-startup.sh` writes `/etc/vidora/worker.env` from Secret Manager, runs migrations, and (re)starts Redis and the worker on every boot and deploy |
| Database | Cloud SQL Postgres 17 `vidora-db` (private IP only), database and user `vidora` |
| Files | Cloud Storage bucket `vidora-media-510913` (private, CORS for the app URL), used through its S3 API with HMAC keys of `vidora-storage@` |

Secrets (Secret Manager): `database-url`, `db-password`, `better-auth-secret`, `token-encryption-keys`,
`oauth-state-secret`, `higgsfield-webhook-secret`, `storage-access-key-id`, `storage-secret-access-key`,
`elevenlabs-api-key`. Optional ones the worker picks up when they exist: `anthropic-api-key`,
`google-oauth-client-id`, `google-oauth-client-secret`.

Add or rotate a secret, then redeploy whatever reads it:

```bash
printf '%s' 'sk-ant-...' | gcloud secrets create anthropic-api-key --data-file=-    # new
printf '%s' '...' | gcloud secrets versions add better-auth-secret --data-file=-     # rotate
# web only: attach a new secret to the service once (kept across deploys)
gcloud run services update vidora-web --region asia-southeast1 --update-secrets RESEND_API_KEY=resend-api-key:latest
```

Worker logs: `gcloud compute ssh vidora-worker --zone asia-southeast1-b --tunnel-through-iap --command "sudo docker logs -f vidora-worker"`.
`/design-system` is on in production (`_ENABLE_DESIGN_SYSTEM` in `infra/cloudbuild.web.yaml`; set `"false"` to hide it).
