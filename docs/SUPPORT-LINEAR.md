# Support feedback → Linear tickets

In-app feedback (Help & support, `/support`) is filed as a labelled Linear issue
in addition to being stored in Postgres and emailed to the support inbox.

## Why the destination is ours, not the tenant's

Linear here is **our** engineering tracker, exactly like `ARC_SUPPORT_INBOX` is
our inbox. Every workspace's feedback lands in one Linear team. A tenant never
sees or configures it, and the Linear columns on `support_requests` are
deliberately not selected by the tenant-facing read model
(`src/lib/support/read-model.ts`) — a workspace has no business seeing our issue
tracker's internals.

## What a ticket looks like

| Support form | Linear |
| --- | --- |
| Every in-app request | label `user-feedback` + label `app › Arc Studio` |
| Something's broken | label `Bug` |
| How do I… | label `Question` |
| Feature request | label `Feature` |
| Billing & account | label `Billing` |
| Something else | *(no type label — the marker is enough)* |
| Blocking me | priority Urgent (1) |
| Slowing me down | priority High (2) |
| Minor | priority Low (4) |

`user-feedback` is the filter that answers **"did a human in the product report
this, or did we write it ourselves?"** — it goes on every ticket unconditionally,
so `label:user-feedback` in Linear is the complete inbox.

## Which app it came from

The BSR Linear team holds tickets for **both** Arc Studio and the BSR Manager
App, and both file in-app feedback into it. `app` is a Linear **label group**, so
membership is exclusive — a ticket carries exactly one of:

| Label | Colour | Filed by |
| --- | --- | --- |
| `app › Arc Studio` | teal `#26b5ce` | `SUPPORT_APP_LABEL` in `src/domain/support-linear.ts` |
| `app › Manager App` | magenta `#d648a8` | `lib/linear.ts` in the Manager App repo |

This is deliberately **not** derived from `LINEAR_PROJECT_ID`. The project field
is optional here and unset on ~19% of recent team tickets, and a Slack feed
filtered on a field nobody remembered to set drops reports silently. A ticket
that reaches Linear at all now says where it came from.

The two Slack feeds are Linear **view subscriptions**, one per app, each
filtering `label:user-feedback AND label:app › <app>`. Views fire on issue
added/completed/cancelled only — see the `linear-slack-feed-wiring` note for why
the project bell and team notifications are the wrong tools.

The title is the operator's own one-line summary. The description leads with
their report, then a context table: reference code, workspace, who filed it,
type/impact, the page they were on (deep-linked when `NEXT_PUBLIC_APP_URL` is
set), build sha, viewport, timezone, browser, and org id.

The reference code (`ARC-A1B2C3`) appears verbatim in the description, so
searching Linear for a code quoted in an email thread finds the ticket. That code
is derived from the `support_requests` row id, which is the join between the DB
row, the notification email and the Linear issue.

## Configuration

| Var | |
| --- | --- |
| `LINEAR_API_KEY` | required. Personal API key (Linear → Settings → API → Personal API keys) sent raw; anything else is sent as `Bearer`. |
| `LINEAR_TEAM_ID` | required. Team **UUID**, not the team key. |
| `LINEAR_PROJECT_ID` | optional. Without it, tickets land in the team backlog with no project. |
| `LINEAR_SUPPORT_SYNC` | optional. `0` switches filing off without pulling the key. |

Unset is a normal state, not a broken one — local dev and CI run without it, and
`fileSupportRequestInLinear` returns `skipped` rather than an error so a deploy
with no Linear key doesn't look like a failing one.

Readiness is reported by the **Support triage** capability in Settings → Health
and `pnpm diagnose:env`.

## Failure behaviour

A Linear failure can never fail a submit. The Postgres row is the durable record
and the email is the human path; someone reporting that Arc is broken must not be
blocked by a second thing being broken. So:

- The email and the ticket are created **in parallel**; neither waits on the other.
- A failure is reported through `reportDegraded` (Sentry + server log). The
  operator sees nothing, because the ticket is our triage, not theirs — which is
  exactly why it has to be loud on our side.
- The failure is also written to `support_requests.linear_sync_error`, and the
  sweep query is:

```sql
select created_at, subject, category, linear_sync_error
from support_requests
where linear_issue_id is null
order by created_at desc;
```

`linear_sync_error` is null both when the ticket succeeded and when the
integration is switched off — check `linear_issue_id` to tell those apart.

- A label name that doesn't resolve to an id is **dropped**, not fatal. Losing a
  bug report is a worse outcome than an untagged ticket. If tickets start
  arriving unlabelled, the label was renamed or deleted in Linear.

Label ids are looked up once per process and memoized. An *empty* lookup is not
cached — that is far more likely a transient API failure than a workspace
genuinely holding none of our labels.

## Where the code lives

- `src/domain/support-linear.ts` — pure: labels, priority, title, description.
- `src/lib/support/linear.ts` — the Linear GraphQL client. Never throws.
- `src/app/(app)/support/actions.ts` — the wiring, after the row is stored.
- `supabase/migrations/20260803120000_support_requests_linear.sql` — the columns.
