# Runbook — verify Stripe end to end on prod (BSR-499)

The billing path has **never run once in production**. `org_plans` is empty:
no Stripe customer, no subscription, no row has ever been written. Every part of
this — checkout, webhook, entitlement sync, portal — is code that has passed
tests and has never met real money.

These steps need a Stripe dashboard, real card details, and a live env change,
so they are an operator's to run, not an agent's. What follows is the sequence
and, more importantly, **what to check in the database after each step** — a
green Stripe dashboard is not evidence that our side worked.

---

## 0. Before touching anything

**Confirm the price ids match live mode.** The single most likely failure is a
`STRIPE_PRICE_*` value from test mode sitting in a live-mode deployment, or the
reverse. Checkout will simply refuse an unknown price, which is loud and fine —
but a price that exists in the *wrong* mode fails in more confusing ways.

Required env on Vercel (production):

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | API access. Live key for production. |
| `STRIPE_WEBHOOK_SECRET` | Signature verification on `/api/webhooks/stripe`. Without it every event is rejected with a 400. |
| `STRIPE_PRICE_STARTER` | $99 tier price id |
| `STRIPE_PRICE_PRO` | $299 tier price id |
| `STRIPE_PRICE_SCALE` | $899 tier price id |

Remember env changes need a **redeploy** — a running deployment never picks up
new env.

`purchasableTiers()` only offers tiers whose price is configured, so a missing
price id means the plan silently does not appear in Settings rather than
erroring. If a tier is missing from the UI, that is why.

---

## 1. Checkout

From Settings → Billing as an owner/admin, start checkout on **Starter**.

**Check afterwards:**

```sql
select org_id, plan_tier, subscription_status, stripe_customer_id, stripe_subscription_id
from public.org_plans;
```

Expect one row. `stripe_customer_id` is written when the customer is created, and
the rest arrives via the webhook.

> If `org_plans` is still empty after a completed payment, the webhook is not
> reaching us. Check Stripe → Developers → Webhooks for delivery attempts and
> response codes before assuming the sync is broken.

## 2. Webhook

Stripe should deliver `customer.subscription.created`.

**Check:**

```sql
select plan_tier, subscription_status, current_period_end
from public.org_plans;
```

Expect `plan_tier = 'starter'`, `subscription_status = 'active'`, and a
`current_period_end` about a month out.

**The failure to watch for.** If `plan_tier` comes back `free` while the customer
is genuinely paying, the subscription's price id did not match any configured
`STRIPE_PRICE_*`. That used to be silent. It now leaves the stored tier alone and
reports to Sentry under scope `billing.stripe-webhook` — so check Sentry, not
just the row.

## 3. Entitlements

```sql
select p.plan_tier, p.monthly_cap_cents,
       coalesce(sum(u.cost_estimate_cents) filter (
         where u.created_at >= date_trunc('month', now() at time zone 'utc')), 0) as used_cents
from public.org_plans p
left join public.ai_usage_events u on u.org_id = p.org_id
group by p.plan_tier, p.monthly_cap_cents;
```

The effective cap comes from `monthly_cap_cents` when set, otherwise the tier
default in `src/domain/plans.ts`. Confirm the workspace now has the paid tier's
allowance rather than the free tier's $2.

Then run:

```bash
pnpm health:billing
```

It should now report the workspace as `ok` rather than `WOULD BLOCK`. **That is
the signal `ARC_BILLING_ENFORCEMENT` can be armed** (BSR-621).

## 4. Portal

Open the Customer Portal from Settings → Billing. Change the plan, then cancel.

**Check after each action:**

```sql
select plan_tier, subscription_status from public.org_plans;
```

- Upgrade → tier follows the new price
- Cancel → `subscription_status = 'canceled'` and `plan_tier = 'free'`

Cancelling to `free` is the correct, intended downgrade — distinct from the
unmapped-price case in step 2, which must never demote anyone.

## 5. Trial expiry

`past_due` deliberately keeps the paid tier for a grace window. A lapsed trial
flips the workspace read-only. Both ride the same `ARC_BILLING_ENFORCEMENT`
flag, so neither is observable until it is armed — verify these after step 3,
not before.

---

## What is already verified, and what is not

**Verified against the real prod schema** (BEGIN/ROLLBACK harness, nothing
persisted):

- `org_plans` has `PRIMARY KEY (org_id)`, so the webhook's
  `onConflict: "org_id"` upsert is sound
- `plan_tier` has a CHECK constraint of `free|starter|pro|scale`, and every value
  the sync can produce is inside it
- Omitting `plan_tier` on the unresolved-price path leaves an existing `pro` row
  as `pro` — the fix behaves as intended on real Postgres

**Not verified, and only step 1–4 above can verify it:** that Stripe reaches us
at all, that the signature check passes with the configured secret, and that a
real payment produces a real row. Everything in this file above section 0 is
untested code paths with green unit tests — which is exactly the combination
this project has been bitten by before.
