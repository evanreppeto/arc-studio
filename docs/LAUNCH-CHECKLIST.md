# Launch Checklist — reopening self-serve signup (BSR-505)

**Verdict as of 2026-07-31: DO NOT FLIP.** Still open, by name: **Stripe verified
end to end** (1b), **quota enforcement** (3, and actioning it literally today
would break the live workspace), **security review** (4), **legal in effect** (5
— pages are live but labelled draft), **activation timed** (7), and **support**
(8). Done: pricing published (1a), trial lifecycle (2), tenant-isolation CI (6),
and rollback.

Nothing remaining is an engineering problem. Every open item needs a Stripe
dashboard, a real card, a lawyer, a dashboard setting, or a stopwatch — which is
also why none of it can be closed by reading the code.

BSR-505 asks for each precondition to be *"confirmed with evidence — not
asserted."* This document is that evidence. Every claim below was checked
against production or the codebase on the date given, and the check is written
down so it can be re-run rather than re-believed.

---

## Status at a glance

| # | Precondition | State | Evidence |
| --- | --- | --- | --- |
| 1a | Pricing decided + published | ✅ | BSR-497 / BSR-498; `/pricing` returns 200 |
| 1b | Stripe verified end to end on prod | ❌ | **`org_plans` has 0 rows.** No customer, no subscription, ever. BSR-499 |
| 2 | Trial lifecycle complete | ✅ | BSR-500 Done; `trial_started_at` / `trial_ends_at` / `trial_notices_sent` columns exist |
| 3 | Quota enforcement on, warnings working | ⚠️ | BSR-501 Done, but **arming it today blocks the live tenant** — see the trap below |
| 4 | Security review, public signup in mind | ❌ | BSR-520 Todo — worth doing *after* the Stripe run, so there is a real payment path to review |
| 5 | Legal live: ToS, privacy | ⚠️ | **Pages shipped and live** (`/legal/terms`, `/legal/privacy`, `/legal/subprocessors`) but they render a "Draft — not yet in effect" notice: entity name, registered address and jurisdiction are still placeholders, and counsel has not reviewed. BSR-522 |
| 6 | Tenant isolation regression-tested in CI | ✅ | **BSR-521 DONE.** Route census fails CI on an unclassified route or unguarded API; RLS cross-tenant denial runs against real Postgres in the Migrations workflow. Both proven to fail when isolation is deliberately broken. |
| 7 | Activation path timed and passing | ❌ | Checklist correctness fixed (it was marking unapproved drafts complete), but the **timed ten-minute run has not happened**. BSR-504 |
| 8 | Support channel staffed, expectation set | ❌ | BSR-598 Backlog |
| — | Rollback tested first | ✅ | Covered at the API level — see Rollback below |

---

## The trap inside precondition 3

Precondition 3 says *"Quota enforcement confirmed **on**."* Actioning that
literally, today, **would immediately block the live BSR workspace.**

Measured on prod, 2026-07-31:

| Org | Month-to-date AI spend | Free-tier cap | Blocked if enforced? |
| --- | --- | --- | --- |
| `big-shoulders-restoration-2` (live) | 255¢ | 200¢ | **yes** |
| `big-shoulders-restoration` (archived) | 1223¢ | 200¢ | **yes** |

The mechanism: `org_plans` has **zero rows**, so every org falls through to
`DEFAULT_PLAN_TIER = "free"`, whose cap is $2/month (`src/domain/plans.ts`).
Both orgs are already past it. `ARC_BILLING_ENFORCEMENT` ships dark, which is
the only reason nothing is broken right now.

**Correct order:** create an `org_plans` row granting the live workspace a real
tier (or a negotiated `monthly_cap_cents` override) *before* arming enforcement.
Arming first breaks the tenant that pays the bills. Tracked separately.

Note also that these caps are **reasoned, not measured** — BSR-502 has never
reconciled the meter against a real provider bill, and the plan catalog says so
in its own header. Do not arm enforcement against unvalidated numbers.

---

## What is genuinely ready

**Rollback.** This is the item BSR-505 says to test *first*, and it holds up.
Closing signup is enforced server-side in `src/app/api/auth/sign-up/route.ts`,
not merely hidden in the UI, and the behaviour is covered by tests in
`sign-up/route.test.ts`:

- closed + no invite → refused, Supabase never touched
- closed + expired/used/unknown invite → refused
- closed + **valid invite → still admitted** ("the one path that must keep working")

So unsetting the flag closes the front door without harming existing invited
workspaces, which is exactly the acceptance criterion.

**One caveat on rollback speed.** `ARC_SELF_SERVE_SIGNUP` is a Vercel env var,
and a running deployment never picks up new env — so flipping it in either
direction requires a **redeploy**, not just a dashboard toggle. Rollback time is
therefore a deploy cycle (~2–4 min), not instant. That is survivable, but it
must be written into the runbook as the real RTO rather than assumed to be
seconds. The public marketing pages additionally read the flag at build time, so
their CTAs only change on that same redeploy.

---

## Not on the checklist, and it should be

**Supabase Site URL / Redirect URLs.** The signup route correctly sets
`emailRedirectTo` to `/auth/callback` on the request origin. But Supabase only
honours a redirect that is allowlisted in the project's auth settings; otherwise
it falls back to the project Site URL. If those are unset or still pointing at
localhost, **every confirmation email a stranger receives is a dead link** — the
signup completes, the account exists, and the user can never get in.

Current prod `auth.users`: 4 users, 4 confirmed, 0 unconfirmed, newest
2026-07-27 — all invited/admin accounts, so this flow has **never been exercised
by a self-serve stranger**. Zero unconfirmed users is therefore not evidence
that it works.

**This cannot be checked from code or SQL** — it is a dashboard setting. Confirm
it visually in Supabase → Authentication → URL Configuration before the flag
moves, and add a real end-to-end confirmation test to BSR-499's scope.

---

## What changed since this audit was written

Same-day follow-ups, so the table above is current rather than a snapshot:

* **BSR-521 closed.** Route exposure census (#776) and cross-tenant RLS on real Postgres (#780), both demonstrated failing when isolation is broken on purpose.
* **Legal pages shipped** (#765) — live, footer-linked, in the sitemap, and honestly labelled as a draft until the entity details land.
* **A paying customer was being silently written as free-tier** (#772). `planUpdateForSubscription` fell back to `free` when a Stripe price id mapped to no configured tier — Stripe got a 200 and nothing logged. Relevant here because it sat directly on the path this checklist gates.
* **Billing-enforcement pre-flight** (`pnpm health:billing`, #767) — refuses to let precondition 3 be actioned blind. **It has still never been run with real credentials.**
* **BSR-626, found and fixed** (#786, #788): the nightly opportunity scan resolved its tenant from an ambient request the cron does not have, so it would have silently stopped finding opportunities for *every* tenant the day a second one signed up — which is precisely the event this checklist gates. All three cron stages now scope explicitly and fan out per workspace.

## The order to actually do this in

1. **BSR-522 legal** — ToS and privacy must exist before taking money from
   strangers. Nothing else on this list is a legal exposure.
2. **Supabase redirect URLs** — verify in the dashboard. Cheap, and it silently
   breaks every signup if wrong.
3. **BSR-499 Stripe end to end** — `org_plans` being empty means this has never
   run once. Includes creating the first real row.
4. **`org_plans` row for the live workspace**, then arm `ARC_BILLING_ENFORCEMENT`
   (precondition 3, in the safe order).
5. **BSR-520 security review.** (BSR-521's CI suites are done.)
6. **BSR-504 activation** — a stranger reaching a first approved campaign
   unaided. This is also what makes directory listings (BSR-587) worth
   publishing.
7. **BSR-598 support** — a documented channel and a response expectation.
8. Only then: flip the flag, and immediately create a workspace as an outside
   user would.

**Downstream:** BSR-587 (directory listings) is blocked on this ticket, because
a listing published into a waitlist funnel burns category ranking history against
a page that cannot convert.

---

**Last verified:** 2026-07-31 (revised the same day — see "What changed" above). Re-run the SQL in this document rather than
trusting the table above — the whole point of BSR-505 is that these are
confirmed, not asserted.
