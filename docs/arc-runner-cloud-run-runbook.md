# Arc Runner — Cloud Run Go-Live Runbook

Activates the merged second brain (brand learning, recall, graph traversal) in
prod by running `apps/arc-runner` on Cloud Run. All steps are operator actions in
your GCP + Vercel + Supabase environments.

## 0. One-time GCP setup
- `gcloud auth login` and `gcloud config set project <PROJECT>`.
- Enable APIs: `gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com`.

## 1. Create secrets (Secret Manager)
Use your real values. `ARC_AGENT_API_TOKEN` and `ARC_WEBHOOK_SECRET` must MATCH the
Vercel app's values. Get the Claude token from `claude setup-token` (after
`npm i -g @anthropic-ai/claude-code` and logging in with your Max plan).

    printf '%s' "<sk-ant-oat01-...>"      | gcloud secrets create arc-claude-oauth-token --data-file=-
    printf '%s' "<ARC_AGENT_API_TOKEN>"   | gcloud secrets create arc-agent-api-token   --data-file=-
    printf '%s' "<ARC_WEBHOOK_SECRET>"    | gcloud secrets create arc-webhook-secret     --data-file=-

(Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor`
if prompted.)

## 2. Deploy
    GCP_PROJECT=<PROJECT> APP_API_BASE_URL=https://<prod-app> bash apps/arc-runner/deploy-cloud-run.sh

Capture the printed service URL. Confirm health:
    curl -s https://<service-url>/health      # -> {"ok":true,"service":"arc-runner"}

## 3. Wire the app (Vercel env)
- `ARC_RUNNER_URL = https://<service-url>/webhooks/growth-chat`
- `ARC_WEBHOOK_SECRET` = (same as the secret above)
- `ARC_AGENT_API_TOKEN` = (same as the secret above)
Redeploy the Vercel app so the env takes effect. Then verify the agent is wired:
Settings -> Agent drawer shows "Runner endpoint" ✓, or run `pnpm diagnose:arc`.

## 4. Database (prod = qqbecyrhnowmooyjiztz "marketing-engine", applied manually)
Vercel does not run migrations, so prod schema changes are a manual release step.
The project IS reachable from the Supabase MCP, so `apply_migration` works — the
SQL editor is no longer the only route.
- Apply migration `supabase/migrations/20260618120000_product_tenancy_foundation.sql` to prod.
  (The second-brain features add no migration — they reuse existing tables.)
- Onboard BSR: with `.env.local` pointed at PROD Supabase creds, run
  `pnpm seed:brand-kit-bsr`. This upserts BSR's profile as `status: active`, so
  the runner's brand context drives Arc immediately.

## 5. Smoke test (exercises all three features)
- `pnpm diagnose:arc` — env flags + ARC_RUNNER_URL correct.
- Bearer-check live routes (replace $TOK / host):
    curl -s -X POST https://<app>/api/v1/arc/ping -H "authorization: Bearer $TOK"
    curl -s https://<app>/api/v1/arc/brand/context -H "authorization: Bearer $TOK"        # BSR profile, not neutral
    curl -s -X POST https://<app>/api/v1/arc/brain/recall -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"message":"flood"}'
- In /arc: send a chat -> reply reflects BSR's voice (SP1); a fresh chat recalls a
  fact recorded elsewhere (SP2) with relationship sub-lines if nodes are linked (SP3a).

## Re-tokening (subscription OAuth expiry)
The `CLAUDE_CODE_OAUTH_TOKEN` can expire. When Arc stops responding with an auth
error in the Cloud Run logs:
    claude setup-token                       # produces a fresh sk-ant-oat01-...
    printf '%s' "<new-token>" | gcloud secrets versions add arc-claude-oauth-token --data-file=-
    gcloud run services update arc-runner --region <REGION>   # picks up :latest
(If you ever prefer no expiry, switch the secret to an ANTHROPIC_API_KEY-based
deploy — bills API credits instead of your Max plan.)

## Cost note
`--min-instances 1` + `--no-cpu-throttling` keep one instance warm 24/7 (required
so Arc's post-ack background work isn't killed). Expect a small constant cost
rather than scale-to-zero.

## Continuous deploy (auto-deploy on push to main)
A Cloud Build trigger rebuilds + redeploys the runner whenever `apps/arc-runner/**`
changes on `main` — so you never hand-run `deploy-cloud-run.sh` for code changes.
Build config: `apps/arc-runner/cloudbuild.yaml` (build → push → `gcloud run deploy
--image`; it preserves the service's env/secrets/scaling — only the image rolls).
Changes anywhere else don't trigger it (Vercel auto-deploys the app as usual).

One-time setup (operator, in Cloud Shell):

    # 1. Artifact Registry repo for the runner image
    gcloud artifacts repositories create arc-runner \
      --repository-format=docker --location=us-central1

    # 2. Grant the Cloud Build service account deploy permissions.
    #    NOTE: confirm which SA your builds use — Cloud Build → Settings shows it.
    #    Classic: <PROJECT_NUMBER>@cloudbuild.gserviceaccount.com
    #    Newer projects default builds to the Compute SA: <PROJECT_NUMBER>-compute@developer.gserviceaccount.com
    #    Grant to whichever the trigger runs as (do both if unsure).
    PROJ_NUM=$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')
    CB_SA="${PROJ_NUM}@cloudbuild.gserviceaccount.com"
    RUNTIME_SA="${PROJ_NUM}-compute@developer.gserviceaccount.com"
    gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:${CB_SA}" --role="roles/run.admin"
    gcloud projects add-iam-policy-binding "$GCP_PROJECT" --member="serviceAccount:${CB_SA}" --role="roles/artifactregistry.writer"
    gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --member="serviceAccount:${CB_SA}" --role="roles/iam.serviceAccountUser"

    # 3. Connect the GitHub repo to Cloud Build (one-time, console is easiest):
    #    Cloud Build → Triggers → Connect Repository → GitHub → authorize evanreppeto/arc-studio.

    # 4. Create the trigger (or do it in the console with the same values):
    gcloud builds triggers create github \
      --name=arc-runner-deploy \
      --region=us-central1 \
      --repo-name=arc-studio --repo-owner=evanreppeto \
      --branch-pattern='^main$' \
      --included-files='apps/arc-runner/**' \
      --build-config=apps/arc-runner/cloudbuild.yaml

Verify: merge a no-op change under `apps/arc-runner/` (or push the existing files),
then watch Cloud Build → History for an `arc-runner-deploy` run that ends in a new
Cloud Run revision. Roll back anytime via Cloud Run → Revisions.

Note: CI only rolls the **image**. Config changes (new/rotated secrets, scaling or
flag changes) still go through `deploy-cloud-run.sh` or `gcloud run services update`.

### ⚠️ Renaming the GitHub repo breaks this trigger, silently

The trigger stores the repo as a literal `github: {owner, name}` — **not a repo
id**. Rename the repo and GitHub's webhook starts carrying the new name, the
filter stops matching, and the runner just stops deploying. No error, no failed
build, nothing to notice. (Vercel is the opposite: it binds `repoId`, so it
survives a rename untouched.)

**Every `gcloud` repair path is blocked.** Verified 2026-08-04 against a renamed,
console-connected repo, in `global` and three regions:

| Attempt | Result |
| --- | --- |
| `triggers update github … --repo-name=X` | `INVALID_ARGUMENT` |
| `triggers import` (edited YAML) | `FAILED_PRECONDITION` |
| `triggers create github --repo-name=X` | `FAILED_PRECONDITION: Repository mapping does not exist` |
| `builds connections list` | 0 items everywhere — it is 1st-gen, no 2nd-gen connection to repoint |

The last one fails **even while the console lists that exact repo as connected**.
The console and the 1st-gen API disagree; the console is the one that can act.

**The procedure that works:**

1. Back up first — note `triggers export` does not exist:
   `gcloud builds triggers describe arc-runner-deploy --project=arc-marketing-500317 --format=yaml > backup.yaml`
2. Rename the repo (`gh repo rename …`).
3. Console → Cloud Build → Triggers → **Manage repositories**: disconnect the old
   name, connect the new one.
4. Console → **edit the existing trigger** and change its source repo. Do *not*
   create a replacement — editing preserves the id, service account, `filename`,
   `includedFiles` and branch pattern, so the diff against your backup is one line.
5. `git remote set-url` in every clone **and** worktree.
6. `diff backup.yaml <(gcloud builds triggers describe … --format=yaml)` — expect
   exactly the repo name to differ.

**Decide before step 3:** once the old repo is disconnected, reverting the rename
no longer restores anything — the old name has no mapping either, so going back
needs the same console work. There is no cheap undo after that point.

**A rename is not verified until the trigger fires.** That needs a real merge
touching `apps/arc-runner/**`. If a runner change ever produces no build, check
`github.name` on the trigger first.
