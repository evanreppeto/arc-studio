# Arc Runner on Cloud Run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the deploy artifacts (Dockerfile, `.dockerignore`, reproducible lockfile, parameterized deploy script) and a go-live runbook to run `apps/arc-runner` as an always-on Cloud Run service — activating the merged second brain in prod.

**Architecture:** Containerize the runner as a **standalone npm package** (build context = `apps/arc-runner` only; it has no workspace-internal imports, so this avoids pnpm-monorepo Docker pain). The image installs `@anthropic-ai/claude-code` globally (the Agent SDK spawns the CLI). Deploy via `gcloud run deploy --source apps/arc-runner` with CPU-always-allocated + `--min-instances=1` (required by the runner's post-ack background work). A runbook covers secrets, wiring `ARC_RUNNER_URL`, the tenancy migration, BSR seeding, and the smoke test.

**Tech Stack:** Docker, Node 20, npm (for the container only — repo stays pnpm), Google Cloud Run + Secret Manager + Cloud Build, bash.

**Important constraints:**
- This is **deploy artifacts + a runbook**, not app code. There are no unit tests; "verification" is `docker build` (if Docker is available to the implementer) and `bash -n`/shellcheck on the script. The authoritative verification (image deploys, Arc responds) happens in the operator's GCP environment and is documented in the runbook.
- The runner is **self-contained** — `apps/arc-runner/src/types.ts` notes its app contracts are "Duplicated, not imported," so a standalone npm install from `apps/arc-runner/package.json` is sufficient (no workspace needed in the image).
- The runner builds CommonJS to `apps/arc-runner/dist/` (`tsconfig.json` `outDir: "dist"`, `rootDir: "src"`); entry is `dist/index.js`. It reads `process.env.PORT` (Cloud Run injects 8080).
- Do NOT set `ANTHROPIC_API_KEY` anywhere — it silently overrides `CLAUDE_CODE_OAUTH_TOKEN` and bills API credits (`config.ts` warns).

---

## File Structure

- `apps/arc-runner/.dockerignore` — keep the build context lean + secrets out.
- `apps/arc-runner/package-lock.json` — committed for reproducible `npm ci` builds.
- `apps/arc-runner/Dockerfile` — standalone build of the runner + global `claude-code`.
- `apps/arc-runner/deploy-cloud-run.sh` — parameterized `gcloud run deploy`.
- `docs/arc-runner-cloud-run-runbook.md` — operator go-live + re-token + smoke test.

---

## Task 1: `.dockerignore`

**Files:**
- Create: `apps/arc-runner/.dockerignore`

- [ ] **Step 1: Create the file**

```
node_modules
dist
.env
.env.*
*.log
*.test.ts
vitest.config.ts
```

- [ ] **Step 2: Verify**

Run: `cat apps/arc-runner/.dockerignore`
Expected: the contents above. (This keeps the host's `node_modules`/`dist` and any local `.env` out of the image so the build is clean and no secret is baked in.)

- [ ] **Step 3: Commit**

```bash
git add apps/arc-runner/.dockerignore
git commit -m "chore(arc-runner): add .dockerignore for the container build"
```

---

## Task 2: Reproducible lockfile (`package-lock.json`)

The container uses `npm ci` for reproducible installs. Generate the lockfile from the runner's existing `package.json` without disturbing the repo's pnpm setup.

**Files:**
- Create: `apps/arc-runner/package-lock.json`

- [ ] **Step 1: Generate the lockfile (no node_modules install)**

Run from the repo root:
```bash
npm install --package-lock-only --prefix apps/arc-runner
```
Expected: creates `apps/arc-runner/package-lock.json`. `--package-lock-only` resolves the dependency tree and writes the lock **without** installing `node_modules`, so it won't create an npm-style `node_modules` that conflicts with the pnpm workspace.

- [ ] **Step 2: Verify the lockfile is valid and covers the deps**

Run: `node -e "const l=require('./apps/arc-runner/package-lock.json'); console.log('lockfileVersion:', l.lockfileVersion); console.log('name:', l.name)"`
Expected: prints a lockfileVersion (2 or 3) and `@bsr/arc-runner`. Also confirm `apps/arc-runner/package-lock.json` references `@anthropic-ai/claude-agent-sdk`, `dotenv`, `zod`:
Run: `node -e "const l=require('./apps/arc-runner/package-lock.json'); const k=Object.keys(l.packages||l.dependencies||{}).join(','); for (const d of ['claude-agent-sdk','dotenv','zod']) if(!k.includes(d)) throw new Error('missing '+d); console.log('deps present')"`
Expected: `deps present`.

- [ ] **Step 3: Ensure no stray npm node_modules got committed**

Run: `git status --short apps/arc-runner`
Expected: only `package-lock.json` is new/untracked. If an `apps/arc-runner/node_modules` appeared, it is already covered by the repo's gitignore / the `.dockerignore` — do NOT `git add` it. (If it exists on disk from a prior `npm install`, you may delete it; the workspace uses pnpm at the root.)

- [ ] **Step 4: Commit**

```bash
git add apps/arc-runner/package-lock.json
git commit -m "chore(arc-runner): add npm lockfile for reproducible container builds"
```

---

## Task 3: `Dockerfile`

**Files:**
- Create: `apps/arc-runner/Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
# Standalone container for the Arc runner. Build context is apps/arc-runner only
# (the runner has no workspace-internal imports), so this is a plain npm build —
# no pnpm/workspace needed in the image.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Runtime deps only (prod), reproducible.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# The Claude Agent SDK spawns the Claude Code CLI at runtime — it must be on PATH.
RUN npm install -g @anthropic-ai/claude-code
# Compiled output from the build stage.
COPY --from=build /app/dist ./dist
# Cloud Run injects PORT (8080); config.ts reads process.env.PORT.
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Build the image (if Docker is available)**

Run from the repo root:
```bash
docker build -t arc-runner:smoke apps/arc-runner
```
Expected: a successful build ending in `naming to docker.io/library/arc-runner:smoke`.

**If Docker is NOT available to you:** do not block. Validate the Dockerfile syntax instead — `docker --version || echo "no docker"` — and mark this step as an operator verification in the runbook (Task 5). Report `DONE_WITH_CONCERNS` noting Docker wasn't available so the image build is unverified.

- [ ] **Step 3: Smoke-test the container boots (only if Step 2 built)**

```bash
docker run --rm -d --name arc-smoke -p 8080:8080 \
  -e PORT=8080 -e APP_API_BASE_URL=http://example.invalid -e ARC_AGENT_API_TOKEN=x \
  -e CLAUDE_CODE_OAUTH_TOKEN=x arc-runner:smoke
sleep 2
curl -s http://localhost:8080/health
curl -s -X POST http://localhost:8080/webhooks/growth-chat -H 'content-type: application/json' -d '{"type":"ping"}'
docker stop arc-smoke
```
Expected: `/health` → `{"ok":true,"service":"arc-runner"}`; ping → `{"ok":true,"status":"pong"}`. This proves the image boots and the server responds (it does NOT exercise Claude — that needs a real token + wake, covered in the runbook smoke test).

- [ ] **Step 4: Commit**

```bash
git add apps/arc-runner/Dockerfile
git commit -m "feat(arc-runner): Dockerfile (standalone build + global claude-code CLI)"
```

---

## Task 4: `deploy-cloud-run.sh`

**Files:**
- Create: `apps/arc-runner/deploy-cloud-run.sh`

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# Deploy the Arc runner to Cloud Run. Run from the repo root:
#   GCP_PROJECT=my-proj APP_API_BASE_URL=https://app.example bash apps/arc-runner/deploy-cloud-run.sh
#
# Prerequisites (one-time, see docs/arc-runner-cloud-run-runbook.md):
#   - gcloud auth + project set; Cloud Run + Cloud Build + Secret Manager APIs enabled
#   - Secret Manager secrets created: arc-claude-oauth-token, arc-agent-api-token, arc-webhook-secret
set -euo pipefail

PROJECT="${GCP_PROJECT:?set GCP_PROJECT to your GCP project id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE_NAME:-arc-runner}"
APP_URL="${APP_API_BASE_URL:?set APP_API_BASE_URL to the prod app base URL}"
MODEL="${ARC_MODEL:-claude-haiku-4-5}"

# Secret Manager secret names (value:version). Override if you named them differently.
SECRET_OAUTH="${SECRET_OAUTH:-arc-claude-oauth-token}"
SECRET_API_TOKEN="${SECRET_API_TOKEN:-arc-agent-api-token}"
SECRET_WEBHOOK="${SECRET_WEBHOOK:-arc-webhook-secret}"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source apps/arc-runner \
  --no-cpu-throttling \
  --min-instances 1 \
  --max-instances 3 \
  --concurrency 4 \
  --timeout 900 \
  --allow-unauthenticated \
  --set-env-vars "APP_API_BASE_URL=${APP_URL},ARC_MODEL=${MODEL}" \
  --set-secrets "CLAUDE_CODE_OAUTH_TOKEN=${SECRET_OAUTH}:latest,ARC_AGENT_API_TOKEN=${SECRET_API_TOKEN}:latest,ARC_WEBHOOK_SECRET=${SECRET_WEBHOOK}:latest"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
echo ""
echo "Deployed: $URL"
echo "Next: set Vercel ARC_RUNNER_URL=${URL}/webhooks/growth-chat (and matching ARC_WEBHOOK_SECRET + ARC_AGENT_API_TOKEN)."
```

- [ ] **Step 2: Validate the script syntax**

Run: `bash -n apps/arc-runner/deploy-cloud-run.sh && echo "syntax ok"`
Expected: `syntax ok`. If `shellcheck` is available, also run `shellcheck apps/arc-runner/deploy-cloud-run.sh` and fix any error-level findings (the `${VAR:?}` guards and quoting are intentional).

- [ ] **Step 3: Make it executable + commit**

```bash
git update-index --add --chmod=+x apps/arc-runner/deploy-cloud-run.sh 2>/dev/null || chmod +x apps/arc-runner/deploy-cloud-run.sh
git add apps/arc-runner/deploy-cloud-run.sh
git commit -m "feat(arc-runner): parameterized Cloud Run deploy script"
```

---

## Task 5: Go-live runbook

**Files:**
- Create: `docs/arc-runner-cloud-run-runbook.md`

- [ ] **Step 1: Write the runbook**

Create `docs/arc-runner-cloud-run-runbook.md` with exactly this content:

```markdown
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

## 4. Database (prod = qqbecyrhnowmooyjiztz, applied manually)
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
```

- [ ] **Step 2: Verify the doc rendered + links are sane**

Run: `rg -n "ARC_RUNNER_URL|min-instances|seed:brand-kit-bsr|setup-token" docs/arc-runner-cloud-run-runbook.md`
Expected: matches present (the runbook references the wiring var, the CPU flag, the seed, and the re-token step).

- [ ] **Step 3: Commit**

```bash
git add docs/arc-runner-cloud-run-runbook.md
git commit -m "docs(arc-runner): Cloud Run go-live + re-token + smoke-test runbook"
```

---

## Task 6: Final review pass

- [ ] **Step 1: Confirm all artifacts exist and are committed**

Run:
```bash
ls apps/arc-runner/.dockerignore apps/arc-runner/Dockerfile apps/arc-runner/deploy-cloud-run.sh apps/arc-runner/package-lock.json docs/arc-runner-cloud-run-runbook.md
git status --short
```
Expected: all five files exist; working tree clean (everything committed).

- [ ] **Step 2: Sanity-check the Dockerfile entry path matches the build output**

Run: `node -e "const t=require('./apps/arc-runner/tsconfig.json'); if(t.compilerOptions.outDir!=='dist') throw new Error('outDir changed'); console.log('dist/index.js entry confirmed')"`
Expected: `dist/index.js entry confirmed` (the Dockerfile `CMD` and `COPY --from=build /app/dist` rely on `outDir: dist`).

- [ ] **Step 3: Confirm no `ANTHROPIC_API_KEY` is set in any artifact**

Run: `rg -n "ANTHROPIC_API_KEY" apps/arc-runner/Dockerfile apps/arc-runner/deploy-cloud-run.sh && echo "FOUND (must be removed)" || echo "clean — not set anywhere"`
Expected: `clean — not set anywhere` (it must never be set; it would override the OAuth token and bill API credits).

---

## Self-Review (completed by plan author)

- **Spec coverage:** Dockerfile + global claude-code → Task 3; `.dockerignore` → Task 1; reproducible build (lockfile/`npm ci`) → Task 2; deploy script with CPU-always-on + min-instances=1 + secrets + env → Task 4; go-live sequence + re-token + smoke test + cost note → Task 5 runbook; final artifact/entry/no-API-key checks → Task 6. All spec sections covered.
- **Standalone-build decision:** justified by `types.ts` ("Duplicated, not imported") — the runner has no workspace-internal deps, so context = `apps/arc-runner` and `--source apps/arc-runner` works without pnpm in the image. Documented in the header.
- **Placeholder scan:** no TBD/TODO. Region/project/secret-names are explicit script variables with `:?`/defaults, not placeholders. The "if Docker unavailable" branch in Task 3 is a concrete fallback (validate + defer to operator), not a vague instruction.
- **Consistency:** `outDir: dist` ↔ Dockerfile `COPY --from=build /app/dist ./dist` + `CMD ["node","dist/index.js"]` (Task 6 Step 2 asserts this). Secret names in `deploy-cloud-run.sh` (`arc-claude-oauth-token` etc.) match the runbook's `gcloud secrets create` names. `ARC_AGENT_API_TOKEN`/`ARC_WEBHOOK_SECRET` "must match Vercel" stated in both the script comment and runbook §3. PORT handled by Cloud Run + `config.ts` (no `--port` flag needed).
- **Honest scope:** no app code / unit tests; verification is `docker build` (best-effort, with an explicit no-Docker fallback) + syntax checks + the operator runbook. The real end-to-end proof is in the operator's GCP env, by design.
```
