# Vidora

Vidora makes videos for YouTube and TikTok channels and posts only the ones you approve.

- Plan and status: [`docs/PLAN.md`](docs/PLAN.md)
- Design rules: [`.claude/skills/vidora-design/SKILL.md`](.claude/skills/vidora-design/SKILL.md) (source of truth: [`DESIGN.md`](DESIGN.md))
- n8n workflows: [`infra/n8n/README.md`](infra/n8n/README.md)
- Google and TikTok applications: [`docs/platform-applications.md`](docs/platform-applications.md)

## Layout

```
apps/web        Next.js app (UI, API, n8n callbacks)        → Vercel
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
pnpm n8n:build                # then import + publish the workflow (infra/n8n/README.md)
pnpm dev                      # web on http://localhost:3010
pnpm dev:worker               # in a second terminal
pnpm smoke                    # end-to-end signed round trip
```

## Checks

```bash
pnpm check                    # contrast, copy lint, typecheck, lint, unit tests
TEST_DATABASE_URL=postgres://vidora:vidora@localhost:5433/vidora pnpm test   # adds DB integration tests
pnpm brand                    # regenerate brand assets from assets/vidora-logo.png
pnpm launch-check             # what still blocks a public launch (placeholders, legal review, platform applications)
```
