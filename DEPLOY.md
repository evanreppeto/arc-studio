# Deploy

How the two deployable surfaces ship, plus the manual steps that are easy to forget.

## How PRs land on `main`

`main` is protected: PR-only, `enforce_admins`, linear history, and required
checks `verify` + `e2e` with **`strict: true`** (a PR must be up to date with
`main` to merge). Always merge with auto-merge rather than waiting on a green
tick:

```bash
gh pr merge <n> --auto --squash
```

**Auto-merge alone is not enough.** GitHub's auto-merge does not update a branch
that has fallen behind `main` — even with `allow_update_branch: true`. Under
`strict` a behind branch never becomes mergeable without an external push, so
auto-merge parks indefinitely while both checks sit green. The PR looks landed
and is not.

[`.github/workflows/auto-update-pr-branches.yml`](.github/workflows/auto-update-pr-branches.yml)
closes that loop: on every push to `main` (plus a 15-minute sweep) it finds open
PRs that have auto-merge enabled and are `BEHIND`, and updates them. A PR
overtaken mid-CI is picked up by the next run rather than parking.

- It requires an **`AUTO_UPDATE_PAT`** repo secret — a fine-grained PAT with
  Contents: read/write and Pull requests: read/write. A push made with the
  built-in `GITHUB_TOKEN` does not trigger workflow runs, so the update would
  change the head SHA while `verify`/`e2e` never run on it, parking the PR
  permanently. The workflow fails loudly if the secret is missing *and* there is
  a behind PR to update.
- Still true regardless: **merged ≠ live.** Confirm both deploy halves below.

## App → Vercel

The Next.js app auto-deploys from `origin/main` — merging to `main` triggers a Vercel build and deploy. No manual step.

- Scheduled jobs are declared in [`vercel.json`](vercel.json). Current cron: `/api/cron/opportunity-scan` (daily at `0 13 * * *`).
- Env vars live in the Vercel project settings (not in the repo). See [`.env.example`](.env.example) for the full list of variables the app expects.

## Arc runner → Cloud Run

The Arc runner (`apps/arc-runner/`) deploys to Google Cloud Run.

- **Auto-deploy**: a Cloud Build trigger runs [`apps/arc-runner/cloudbuild.yaml`](apps/arc-runner/cloudbuild.yaml) on push to `main`, filtered to changes under `apps/arc-runner/**`.
- **Config / secret changes** (or a manual deploy): run [`apps/arc-runner/deploy-cloud-run.sh`](apps/arc-runner/deploy-cloud-run.sh).
- **Secrets** live in GCP Secret Manager, not in the repo.
- Full procedure and operational details: [`docs/arc-runner-cloud-run-runbook.md`](docs/arc-runner-cloud-run-runbook.md).

## Database migrations (MANUAL — do not skip)

Migrations are timestamped SQL files in [`supabase/migrations/`](supabase/migrations). They are **NOT** auto-applied on deploy.

Apply any new migration to the **production** Supabase DB **before or together with** merging the code that depends on it. Merging code that reads a column/table the prod DB doesn't have yet causes schema drift and breaks prod.

## Post-deploy smoke check

After a deploy, confirm the surfaces are healthy:

```bash
pnpm smoke:http <prod-base-url>   # expected pages load (HTTP checks)
pnpm health:supabase              # Supabase connectivity / health
```

Green on both = expected pages load and the DB is reachable.

## Rollback

- **App (Vercel)**: redeploy a previous deployment from the Vercel dashboard.
- **Arc runner (Cloud Run)**: images are tagged by commit SHA — redeploy a prior tag. See [`docs/arc-runner-cloud-run-runbook.md`](docs/arc-runner-cloud-run-runbook.md).
