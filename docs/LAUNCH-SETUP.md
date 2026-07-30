# Launch setup — the operator-only steps

Everything here needs a dashboard login, so it can't be automated from the repo.
Each section is verified against the code as of 2026-07-29: the integration
exists and is wired, it is waiting on credentials and remote configuration.

Ordered by how much each unblocks.

---


## 1. Resend inbound events (BSR-473) — ✅ ALREADY DONE

Verified from the Resend dashboard 2026-07-30: endpoint registered and
**Enabled** (created 2d ago), events arriving, every one returning **200**.

That 200 is the proof the secret is set: the route returns `503
no_webhook_secret` when `RESEND_WEBHOOK_SECRET` is missing and `400
invalid_signature` on a bad signature. Neither is happening.

### About the `"recorded": false` in every response — this is CORRECT

`recordResendWebhookEvent` looks up `campaign_dispatches` by
`provider_message_id`. The events currently arriving were sent by the **Big
Shoulders Manager app**, which shares the same Resend account — so there is no
matching dispatch and the receiver declines to record them, returning 200 so
svix stops retrying. It is correctly ignoring another app's traffic.

Arc Studio sees those payloads in transit but stores nothing from them.

**Separate sending domains do NOT fix this** (Arc Studio and the Manager app
already have their own). Resend registers a webhook **per account**, not per
domain, so any endpoint on that account receives events for every email either
app sends. Only a separate Resend *account* would isolate them, and that is
probably not worth it — the receiver already filters correctly.

What the cross-app traffic did expose: `provider_message_id` on
`campaign_dispatches` had **no index**, so every foreign event ran a sequential
scan before correctly finding nothing. Indexed in
`20260730120000_dispatch_provider_message_id_idx.sql` — the scan count grows
with both apps' combined volume while the table grows with every dispatch, so
it was quietly quadratic.

### The one thing still unproven

No Arc Studio email has been sent **since this endpoint was created**, so
`recorded: true` has never actually happened. Send one campaign email from Arc
Studio and confirm the response flips. Until then the return path is
configured but not demonstrated.

### Historical note

**URL:** `https://arc-studio.ai/api/webhooks/resend`

**Events handled:** `email.sent`, `email.delivered`, `email.opened`,
`email.clicked`, `email.bounced`, `email.complained`, `email.delivery_delayed`

---

## 2. Failure alerting (BSR-477) — one webhook URL, no paid tier

**Revised 2026-07-30: Sentry's Slack integration is a paid add-on, so the plan
that routed everything through Sentry is off.**

Better answer, and cheaper: skip Sentry for alerting entirely. The app already
funnels every degraded read through one chokepoint — `reportDegraded`
(`src/lib/observability/report-degraded.ts`, built in BSR-544) — and
`postSlackWebhook` (`src/lib/integrations/slack/notify.ts`) already exists and
is tested. Wiring one to the other needs a **free Slack Incoming Webhook** and
no Sentry plan at all.

Sentry stays as the error *record*; Slack becomes the *alert*. They are
different jobs and Sentry was only ever the convenient middleman.

### What's needed from you

Create a **Slack Incoming Webhook** for an ops channel and set it on Vercel:

```
ALERT_SLACK_WEBHOOK_URL   https://hooks.slack.com/services/…
```

Free, and the only manual step.

### What I build once it exists

- `reportDegraded` with `surface: "primary"` posts to the webhook. **Primary
  only** — alerting on every optional panel is how real alerts get ignored.
- Arc runner failures post too. The runner is a separate Cloud Run service, so
  it would have been outside Sentry's app integration regardless.
- Rate-limited per scope, so one broken query can't flood the channel.

Unset means no-op, exactly like the other integrations — nothing breaks if you
never set it.

### Do NOT reuse the `slack-alerts` connector

That one is **per-workspace and operator-triggered** — a tenant's own webhook,
posting opportunity summaries when someone clicks a button. Routing platform
failures through it would send our ops noise into a customer's channel.

---

## 4. Supabase auth URLs — verify before acting

Reported unset a couple of weeks ago; **confirm current state before changing
anything.**

Dashboard → Authentication → URL Configuration:

- **Site URL:** `https://arc-studio.ai`
- **Redirect URLs:** include `https://arc-studio.ai/**`

If these are unset or still `localhost`, signup confirmation links point
somewhere the user can't reach — a hard blocker for M4's self-serve path, and a
dashboard setting rather than a code change.

---

## 5. Staging (BSR-475)

The Supabase half (`zheuujpxsxmisnrlsriv`) is alive. The **Vercel app half was
deleted**. Create the project and point it at that database; configuration
afterwards is a code task.

---

## 6. Real recipients — M2's actual blocker

M2 is at 0% and genuinely blocked, not merely unstarted: every CRM contact is a
seeded `.local` fake, so send → engage → outcome has no fuel. This is a
business decision about who can legitimately be contacted, which is why it
isn't a ticket anyone can implement.

---

## Optional cleanup

Once the 2026-07-29 migrations have settled, these exist only to make that day
reversible and can be dropped:

- `public.status_backup_20260729_leads` / `_jobs` / `_outcomes`
- `supabase_migrations.schema_migrations_backup_20260729`
- the now-unused `lead_status` / `job_status` / `outcome_status` enum types

---

## LAST. Stripe (BSR-497)

Deliberately last, by Evan's call 2026-07-30. It unblocks all of M4, but M4 is
not the near-term goal and everything behind it is already built and waiting —
so it costs nothing to defer, and doing it early would start a billing
relationship before the product is ready to charge for.

Pricing is decided and the public pricing page is live. The products don't
exist yet, so checkout has nothing to sell.

### Create three recurring products

| Product | Price | Interval |
|---|---|---|
| Starter | **$99** | monthly |
| Pro | **$299** | monthly |
| Scale | **$899** | monthly |

Flat, unlimited seats. Copy each **price** id (`price_…`, not the `prod_…` id).

### Set five env vars on Vercel (production)

```
STRIPE_SECRET_KEY       sk_live_…
STRIPE_PRICE_STARTER    price_…   ($99)
STRIPE_PRICE_PRO        price_…   ($299)
STRIPE_PRICE_SCALE      price_…   ($899)
STRIPE_WEBHOOK_SECRET   whsec_…   (from the endpoint below)
```

The tier↔price mapping is read from these names directly
(`src/lib/billing/stripe-plans.ts`) — no code change needed. A tier whose price
var is unset is simply not offered, so you can launch with a subset.

### Add the webhook endpoint

**URL:** `https://arc-studio.ai/api/webhooks/stripe`

**Events — these three, and only these are handled:**

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

`checkout.session.completed` is deliberately NOT needed. Checkout stamps
`subscription_data.metadata.org_id`, the customer record carries
`metadata.org_id` too, and `subscription-sync.ts` falls back to matching the
stored customer id — so the subscription events alone can always resolve the
org. Verified end to end.

### Then

Entitlement sync is live. `ARC_BILLING_ENFORCEMENT` stays **off** until
**BSR-502** (metering accuracy audit) passes — enforcement without verified
metering would bill people on numbers nobody has checked.

---
