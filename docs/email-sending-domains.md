# Per-workspace email sending domains

Status: **proposal, not built.** Written 2026-07-29.

## The problem

Every workspace currently sends through the **platform's** Resend account.
`connections.env_var = "RESEND_API_KEY"` points at the deployment's key, and
`connections.config.fromEmail` names the address. Big Shoulders Restoration sends
as `arc@bigshouldersrestoration.com` — a domain that had to be verified inside
*our* Resend account.

That has three consequences, in increasing order of seriousness:

1. **Onboarding is manual.** Someone with access to our Resend account has to add
   and verify each customer's domain by hand.
2. **Reputation pools.** All tenants share one account's sending reputation. One
   customer mailing a stale list degrades deliverability for every other customer,
   and they have no way to see it or fix it.
3. **Abuse is our liability.** Complaints, blocklistings and suspension land on
   the platform account, taking every tenant down together.

For a product whose value proposition is "we send your marketing," deliverability
*is* the product. This is the multi-tenant correctness gap, not a polish item.

## What already exists

More than it looks like. `connections` is keyed on `(org_id, provider)` and
already carries, per workspace:

| Column | Purpose |
| --- | --- |
| `credential_ref` | uuid of a Resend API key **stored in the Vault** |
| `env_var` | fallback to a deployment key when no credential is stored |
| `config.fromEmail` | per-workspace sender address |
| `enabled` | operator kill switch |

`src/app/(app)/settings/connections-actions.ts` already writes all four, and the
executor already prefers a stored credential over the env var. So "a workspace
uses its own Resend account" is **already supported end to end** — BSR simply
isn't using it.

What's missing is everything around the *domain*: adding it, showing the DNS
records, tracking verification state, and refusing to send until it's real.

## Two models

**A — Bring your own key.** The workspace creates a Resend account, verifies its
own domain there, and pastes an API key into Settings → Connections.

- Reputation, billing, rate limits and abuse liability sit with the customer.
- Essentially built already.
- Cost: real onboarding friction. They need a Resend account before they can send
  anything, which is a poor first-run experience for a Starter customer.

**B — Platform-managed domain.** We create the domain in the platform Resend
account via API, show the customer the DNS records to paste into their registrar,
and poll until Resend reports `verified`.

- Onboarding is "add four DNS records," which is the industry-standard flow.
- **Open and click tracking can be enabled at creation** (`open_tracking` and
  `click_tracking` are create-time parameters), so the toggles that are currently
  a manual dashboard step become automatic.
- Cost: reputation still pools, and we carry the abuse risk.

### Recommendation

**B by default, A as an escape hatch**, which maps onto the pricing tiers:
Starter and Pro get the five-minute managed setup; Scale can supply their own key
and fully isolate their reputation. This also gives a concrete, honest reason for
the Scale tier beyond volume.

## The Resend API surface

Verified against Resend's docs on 2026-07-29.

`POST /domains` accepts `name`, `region`, `custom_return_path`,
**`open_tracking`**, **`click_tracking`**, `tracking_subdomain`, `tls` and
`capabilities`. It returns `id`, `name`, `status`, `records[]` (each with `type`,
`name`, `value`, `priority`, `ttl`, `status`) and the tracking flags.

Domain statuses:

| Status | Meaning |
| --- | --- |
| `not_started` | Added, but verification never triggered |
| `pending` | Resend is checking DNS |
| `verified` | Sending is live |
| `partially_verified` | One capability verified, the other pending |
| `failed` | DNS not detected **within 72 hours** |
| `temporary_failure` | A previously verified domain whose records stopped resolving |

Two of these matter more than they look:

- **`failed` is terminal after 72 hours.** The UI has to say so, and offer a retry
  that recreates the domain rather than leaving someone staring at "pending"
  forever.
- **`temporary_failure` happens to working domains.** Someone edits DNS at the
  registrar and a previously fine domain silently degrades. This must alert the
  workspace, not just sit in a settings page nobody opens.

## Schema

One new table, because a workspace may eventually hold more than one domain and
because verification state is not connection state:

```sql
create table public.workspace_email_domains (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  domain            text not null,
  -- Resend's domain id, so we can re-check status without re-creating.
  provider_domain_id text not null,
  status            text not null default 'not_started',
  -- The DNS records to show the customer. Snapshotted at creation so the setup
  -- screen renders without an API round-trip, refreshed on every status poll.
  dns_records       jsonb not null default '[]',
  open_tracking     boolean not null default true,
  click_tracking    boolean not null default true,
  last_checked_at   timestamptz,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, domain)
);
```

`connections.config.fromEmail` stays the sender address; this table governs
whether that address is *allowed* to send.

## Send-path gate

`executeResendDispatch` already refuses on: not queued, no approval, unapproved,
asset still dispatch-locked, suppressed recipient, and missing postal address
(see `docs/` and `src/lib/dispatch/execute-resend.ts`). Add one more, in the same
style — refuse with a message that names the fix:

```
The sending domain for <address> isn't verified yet.
Finish setup in Settings → Email → Sending domain.
```

Refusing is correct rather than falling back to a platform address: mail that
silently goes out as `arc-studio.ai` when the customer configured their own
domain is a surprise they'd discover from a recipient.

## Resolving the from-address mess

There are currently three sources and the precedence is not obvious:

```
campaign  connections.config.fromEmail  →  else RESEND_FROM
system    RESEND_FROM                   →  else RESEND_FROM_EMAIL
```

That is how deleting `RESEND_FROM` would have broken waitlist alerts, invites,
support and billing notices while leaving campaigns working — a failure nobody
would notice, because nothing tells you an alert didn't fire.

This work should collapse it to one rule:

- **Marketing mail** — the workspace's verified domain. No fallback; refuse.
- **System mail** (waitlist, invites, support, billing) — always the platform
  domain, because it must work even for a workspace that has configured nothing.

Keeping those deliberately separate is right: system mail should not depend on a
customer's DNS, and marketing reputation should not accrue to the product domain.

## Templates

Deliberately out of scope here. `src/domain/email-compliance.ts` already wraps
every send in the workspace's logo and accent and appends the compliance footer,
which is the load-bearing part. Template customisation is a smaller, separable
piece and is easier to design once the domain story is settled — a customer who
can't send yet doesn't need a template editor.

## Build order

1. Table + Resend domain client (`create`, `get`, `list`) with tracking enabled at
   creation.
2. Settings → Email → Sending domain: add a domain, render DNS records with
   copy-to-clipboard, poll status.
3. The send-path gate.
4. Alerting on `temporary_failure`, reusing the billing-notices job — it already
   has the idempotency-key pattern for "email this once per period."
5. BYO-key path (mostly wiring the existing `credential_ref` into the same UI).

## Open questions

- **Do we verify a subdomain instead?** `mail.customer.com` is easier to get
  approved internally at larger customers and keeps the apex domain's reputation
  separate from marketing. Probably the default we should suggest.
- **What happens to already-sent mail when a domain later fails?** Nothing
  technically, but the customer should be told, because their in-flight campaigns
  stop.
- **Who pays for the platform Resend account as tenant count grows?** Model B
  means our bill scales with customer send volume. Worth checking against the
  plan caps before this ships.
