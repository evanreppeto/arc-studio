# Go-live checklist

Bringing a new Arc Studio environment fully live, in the order that works, with
a way to **verify** each step rather than only perform it.

Written because the recurring failure here is not a missing feature — it is a
feature that shipped, looked live, and was silently inert because one flag was
never set. The weather connector, Sentry, and the inbound email receiver all
went that way. Every step below therefore has a check, and the check is the
point.

## Before you start

A deployment is **two halves**, and a merge to `main` ships both:

| half | where | env file |
| --- | --- | --- |
| app | Vercel | `.env.example` |
| Arc runner | Cloud Run (`arc-runner`) | `apps/arc-runner/.env.example` |

Setting a variable on one half does nothing for the other. Most "the runner
isn't picking up work" reports are a variable set on the app only.

**Env changes are not picked up by a running deployment. Redeploy after each
group**, or you will verify the previous state and believe it.

Ask the app what is missing at any point:

```bash
pnpm diagnose:env                  # every capability, and why each is off
pnpm diagnose:env --required-only  # only what is actually broken
pnpm diagnose:env --file .env.prod # against a pulled prod env file
```

Once someone is a platform admin, **Settings → Health** answers the same
question from inside the running app, which is the version that reflects what
prod actually has rather than what your file says.

> `vercel env pull` writes sensitive variables as **blank**. Blank in the pulled
> file does not mean unset in Vercel. Trust `diagnose:env` against the real
> environment, or the Health console, over a pulled file.

---

## 1. Persistence — required first

Nothing else can be verified until the database answers.

Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**Verify:** `pnpm diagnose:env` reports Persistence as `ready`, then load any
`(app)` page and confirm it renders real (possibly empty) data rather than an
"unavailable" banner. An empty workspace is a success here; a banner is not.

**Migrations:** merging to `main` applies them automatically. Confirm the
`Migration drift (prod)` check is green on the merge commit before trusting a
feature that needs a new table.

## 2. Operator access

Set `ARC_AUTH_MODE=supabase` on any shared host. Set
`ARC_PLATFORM_ADMIN_EMAILS` to the people who run the platform.

**Verify:** sign out and load a page — you should land on `/login`. Sign in as a
listed admin and confirm **Settings → Health** and **Settings → Waitlist** are
visible; sign in as a non-listed user and confirm they are not. Unset means
nobody, by design, so an empty value locks *you* out too.

> Leave `ARC_SELF_SERVE_SIGNUP` unset. Signup stays invite-only until the launch
> checklist in M4/M7 is done.

## 3. Observability — before anything that can fail

Deliberately early. Everything after this can break, and you want to hear about
it from Sentry and Slack rather than from a customer.

Set `NEXT_PUBLIC_SENTRY_DSN` and `ALERT_SLACK_WEBHOOK_URL`.

**Verify:** Settings → Health → **Send a test alert** must post to the Slack
channel. For Sentry, confirm an event actually arrives — the SDK reporting
`flushed: true` is not proof, since an auth redirect can swallow the request.

`ALERT_SLACK_WEBHOOK_URL` must be a **platform** webhook, not a tenant's. The
per-workspace `slack-alerts` connector is a separate thing.

## 4. Agent loop

App side: `ARC_AGENT_API_TOKEN`, `ARC_RUNNER_URL`, `ARC_WEBHOOK_SECRET`,
`GEMINI_API_KEY`.
Runner side: `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`,
`APP_API_BASE_URL`, and the same `ARC_WEBHOOK_SECRET`.

**Verify:** `pnpm diagnose:arc`, then ask Arc a question **whose answer you
already know**. That last part is the whole check. A run that completes proves
the plumbing; only a correct answer proves the loop. Settings → Health should
show the runner `live` rather than `unknown`.

## 5. Scheduled work

Set `CRON_SECRET`, then enable what you want:
`OPPORTUNITY_SCAN_CRON_ENABLED`, `BILLING_NOTICES_CRON_ENABLED`.

**Verify:** the cron routes fail closed, so confirm a scheduled run actually
appears — a scan that never runs and a scan that runs and finds nothing look
identical from the outside. Check for an `arc_opportunity_scan` task after the
first scheduled window.

Leave `OPPORTUNITY_AUTO_DRAFT_ENABLED` off until you have watched a few scans.
When you do enable it, set `OPPORTUNITY_AUTO_DRAFT_DRY_RUN=1` first and read
what it *would* have drafted. Drafts are approval-gated either way — nothing
reaches a customer without a human.

## 6. Send loop

All six are required together, and this is the group where half-configured is
worse than off: mail leaves and nothing comes back, which looks like success.

`ARC_SEND_ENABLED`, `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET`,
`EMAIL_UNSUBSCRIBE_SECRET`, `NEXT_PUBLIC_SITE_URL`.

Also register the webhook endpoint in the **Resend dashboard**
(Webhooks → Add endpoint → `delivered`, `opened`, `clicked`, `bounced`,
`complained`) pointing at `/api/webhooks/resend`. Setting the secret without
registering the endpoint means no events ever arrive.

**Verify, in order:**

1. Send one campaign to **yourself** before any real recipient.
2. Confirm it arrives, and that the unsubscribe link in the footer both renders
   and works. An unsigned or broken unsubscribe is a compliance failure.
3. Open it, and confirm a `delivered` and an `opened` touchpoint appear on the
   journey timeline in the UI. If nothing appears, the webhook is not wired —
   the send succeeding tells you nothing about the return path.
4. Send a request to the webhook with a **bad signature** and confirm it is
   rejected. Do not assume the signature check runs; make it reject.

> `RESEND_*` belongs on Vercel and locally **only**. The runner sends no email.

## 7. Media generation

Prefer the per-workspace connectors (Settings → Connections) over the legacy
deployment-wide `ARC_MEDIA_ENABLED`. Either way `GEMINI_API_KEY` is required.

**Verify:** generate one asset and follow it through approve → resize. Confirm
the asset card shows source type, model/job id, and risk flags — a generated
asset that cannot be told apart from real customer media is the failure mode
here.

## 8. Billing

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and one price id per paid tier.
Add the webhook endpoint at `/api/webhooks/stripe` subscribed to
`customer.subscription.created/updated/deleted`.

**Verify:** run one real checkout end to end and confirm entitlements change
after payment. The webhook is the half that usually is not proven — without it
a paying customer silently stays on the free tier. Leave
`ARC_BILLING_ENFORCEMENT` unset until you have watched quota numbers you trust.

## 9. Optional capabilities

Connector OAuth, social publishing, inbound API tokens, Drive import. Each is
genuinely optional — `diagnose:env` marks them so, and an unset optional
variable is a choice rather than a fault.

Two worth calling out, because unset means **open** rather than **off**:
`LEADS_INGEST_API_TOKEN`, `CAMPAIGN_RESULTS_API_TOKEN`, `MEDIA_INGEST_API_TOKEN`.
Set them on any shared host.

---

## Final check

```bash
pnpm diagnose:env --required-only
```

Anything still listed is either deliberately off — fine, say so out loud — or a
gap. Then confirm the same from inside the running app at **Settings → Health**,
because that reads the environment prod actually has rather than the file you
believe it has.

**Do not treat a green screen as proof on its own.** This project's most
expensive bugs all rendered a normal-looking page. Where a step above says
"confirm an event arrives" or "make it reject", do that literally.

## When something is off and you cannot tell why

- `pnpm diagnose:env` — is the variable even set?
- Settings → Health — is the capability graded `live`, `degraded`, or `unknown`?
  `unknown` means we could not read the evidence, not that things are fine.
- Sentry, then the Vercel/Cloud Run logs.
- If a screen is empty, check whether the read *failed*: read-models report
  failures rather than degrading to empty (BSR-575), so an empty screen with no
  banner really does mean empty.
