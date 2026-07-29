# Launch setup — the operator-only steps

Everything here needs a dashboard login, so it can't be automated from the repo.
Each section is verified against the code as of 2026-07-29: the integration
exists and is wired, it is waiting on credentials and remote configuration.

Ordered by how much each unblocks.

---

## 1. Stripe — unblocks all of M4 (BSR-497)

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

## 2. Resend inbound events — M1's only Urgent item (BSR-473)

Sending already works and is prod-verified. What's missing is the **return
path**: opens, clicks, bounces and replies never reach the journey timeline, so
every campaign looks like it vanished after send.

### Add the webhook endpoint in the Resend dashboard

**URL:** `https://arc-studio.ai/api/webhooks/resend`

**Events handled:** `email.sent`, `email.delivered`, `email.opened`,
`email.clicked`, `email.bounced`, `email.complained`, `email.delivery_delayed`

### Set the signing secret on Vercel

```
RESEND_WEBHOOK_SECRET   whsec_…
```

The receiver was built in #586 and verifies the signature — without the secret
it rejects everything, which is why nothing arrives today.

---

## 3. Failure alerting (BSR-477) — this is TWO tasks, and one is entirely yours

M1's "failures page a human" criterion is not met: Sentry issues and Arc runner
failures both sit where nobody is looking.

### 3a. Sentry → Slack — no code required, do this now

Sentry ships a native Slack integration. **Settings → Integrations → Slack**,
install it, then add an **Alert Rule** routing issues to your channel. Nothing
in this repo is involved, and it covers every app-side exception including the
`degraded` events added in BSR-544.

This is the fastest win on the whole list. Ten minutes, no deploy.

### 3b. Arc runner failures → Slack — needs a webhook URL from you

The runner is a separate Cloud Run service, so Sentry's app integration doesn't
cover it. Create an **Incoming Webhook** for the same channel and hand over the
URL; `postSlackWebhook` (`src/lib/integrations/slack/notify.ts`) already exists
and is tested, so this is wiring, not building.

Note the distinction from the existing `slack-alerts` connector: that is
**per-workspace and operator-triggered** (a button posts opportunity
summaries). This is **platform-level and automatic** — a different concern that
should not reuse a tenant's webhook.

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
