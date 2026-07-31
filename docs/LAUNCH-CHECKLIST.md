# Launch Checklist — reopening self-serve signup (BSR-505)

**Verdict as of 2026-07-31: DO NOT FLIP.** Six of the eight preconditions are
open, two of them are hard legal/commercial blockers, and one item on the
checklist as written would break the live workspace if actioned literally.

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
| 4 | Security review, public signup in mind | ❌ | BSR-520 Todo |
| 5 | Legal live: ToS, privacy | ❌ | **No routes exist.** `/terms` and `/privacy` 307 to login; nothing in `src/app`. BSR-522 |
| 6 | Tenant isolation regression-tested in CI | ❌ | BSR-521 Todo |
| 7 | Activation path timed and passing | ❌ | BSR-504 Todo |
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

## The order to actually do this in

1. **BSR-522 legal** — ToS and privacy must exist before taking money from
   strangers. Nothing else on this list is a legal exposure.
2. **Supabase redirect URLs** — verify in the dashboard. Cheap, and it silently
   breaks every signup if wrong.
3. **BSR-499 Stripe end to end** — `org_plans` being empty means this has never
   run once. Includes creating the first real row.
4. **`org_plans` row for the live workspace**, then arm `ARC_BILLING_ENFORCEMENT`
   (precondition 3, in the safe order).
5. **BSR-520 security review** and **BSR-521 tenant-isolation CI**.
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

**Last verified:** 2026-07-31. Re-run the SQL in this document rather than
trusting the table above — the whole point of BSR-505 is that these are
confirmed, not asserted.
