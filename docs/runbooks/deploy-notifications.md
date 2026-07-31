# Deploy notifications (#arc-deploys)

## What this answers

"Merged" and "live" are not the same thing here, and confirming the difference
used to mean opening two dashboards. `.github/workflows/deploy-notify.yml` posts
both halves into `#arc-deploys` so the answer arrives instead of being looked
for — and so a **failure** arrives, which is the case that actually matters.

## Two halves, different triggers

| Half | Deploys when | Reports into GitHub as |
| --- | --- | --- |
| App → Vercel | every push to `main` | a Deployment (`deployment_status` event) |
| `apps/arc-runner` → Cloud Run | pushes touching `apps/arc-runner/**` | a check run, `arc-runner-deploy (arc-marketing-500317)` |

**They do not both fire on every merge.** Observed 2026-07-31: of five merges to
`main`, four touched app code only and one moved both. So "app deployed, runner
unchanged" is the *common* case, and the app message says so explicitly — a bare
"deployed" would be misleading, and a silent runner is precisely how it ends up
serving a stale image while `main` has moved on.

Because both halves already report into GitHub, this needs **no** Cloud Build
Pub/Sub notifier and **no** Vercel Slack integration. Everything lives in this
repo.

## What posts, and what deliberately does not

| Event | Posts? |
| --- | --- |
| Production app deploy, success or failure | **yes** |
| Preview deploy | no — four fired in three minutes on a busy branch |
| In-flight states (`pending`, `in_progress`) | no |
| Runner build succeeded or failed on `main` | **yes** |
| Runner build skipped (`neutral` — merge did not touch the runner) | no — the app message already says the runner is unchanged; posting here too would double every merge |
| Any other check run (`verify`, `e2e`, …) | no |

Every skip is logged with its reason. Silence with no explanation is the failure
mode this whole ticket is about.

## Setup

One secret, created once. **This is the only step not in the repo.**

1. In Slack, create an incoming webhook pointed at `#arc-deploys`.
2. Store it:

```bash
gh secret set SLACK_DEPLOY_WEBHOOK_URL --body "https://hooks.slack.com/services/..."
```

Until that secret exists the workflow **fails loudly** on each production
deploy rather than going quiet, and prints the message it would have sent. A
notification pipeline that silently stops notifying is worse than one that is
obviously broken.

## Testing it

**The delivery path** — proves webhook, channel and formatting without waiting
for a deploy:

```bash
gh workflow run deploy-notify.yml -f drill=true
```

That posts a message clearly labelled as a test.

**The failure path** — the acceptance for BSR-536 asks for this to be *verified,
not assumed*. The safe way to force a real one is to break the Cloud Build
config rather than the code:

- A change to `apps/arc-runner/cloudbuild.yaml` (say, a bad image reference)
  passes `verify` and `e2e`, because neither typechecks that file, and then
  fails in Cloud Build.
- **A failed Cloud Build does not touch the running service.** Cloud Run keeps
  serving the previous revision, so this is non-destructive — then revert.

Do not test the app half this way: a failed Vercel production build is not
equally harmless to leave sitting on `main`.

## Known limits — stated so nobody reads more into a message than it carries

- **No build duration for the app half.** Vercel creates the GitHub Deployment
  only *after* the build finishes, then posts success about a second later
  (measured: created `16:21:48`, success `16:21:49`). That gap is alias
  promotion, not build time. Printing it would report "1s" for a multi-minute
  deploy, so the app message carries no duration at all. The runner half has
  real start and finish times and does show one.
- **No Cloud Run revision id.** The check run does not carry it, and fetching it
  would mean granting the workflow Cloud Run read access. The commit SHA plus
  the Cloud Build log link answer "is what I merged what's running?" without a
  new IAM grant.
- **The message proves a deploy happened, not that it works.** `prod-nightly.yml`
  is what proves the deployed app still functions.
