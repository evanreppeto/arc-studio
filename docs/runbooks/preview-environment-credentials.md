# What a preview deployment is allowed to reach

A preview build runs **unreviewed code from a branch**. Anything it holds, that
code can use. So the rule is:

> A preview gets nothing that writes to the outside world, spends money, or
> pages a human. If a preview genuinely needs a value, it gets its **own**, not
> production's.

## Why this needed doing (BSR-635)

On 2026-07-31 the Supabase vars were scoped to production, which stopped
previews reaching the prod database. Everything else was left in place — **39
variables were scoped to Preview, 37 of them the same record as Production.**

A preview could drive the production Cloud Run runner, trigger cron endpoints,
spend on Gemini and the Claude subscription, and publish to **BSR's real Meta,
X and LinkedIn accounts**.

That last one is worth stating plainly. The product's non-negotiable is *no
outbound publish without human approval*. A preview holding live publishing
tokens left that guarantee resting on nothing but the app's own gates — on a
deployment that by definition runs code nobody reviewed.

It was tempting to argue this was already unreachable, since previews lost the
database and most paths resolve a workspace first. That argument was not taken:
it makes isolation a **side effect** of a different change, and it does not
cover paths that fire outbound without tenant context (webhook receivers, cron
endpoints, health pings).

## What was done

24 credentials re-scoped to `["production"]` on 2026-07-31.

| group | variables |
| --- | --- |
| Social publishing | `META_APP_ID` `META_APP_SECRET` `META_IG_USER_ID` `META_PAGE_ACCESS_TOKEN` `META_PAGE_ID` `X_API_KEY` `X_API_SECRET` `X_ACCESS_TOKEN` `X_ACCESS_TOKEN_SECRET` `LINKEDIN_ACCESS_TOKEN` `LINKEDIN_ORG_URN` |
| Agent / runner control | `ARC_AGENT_API_TOKEN` `ARC_AGENT_KEY` `ARC_RUNNER_URL` `ARC_RUNNER_URL_LOCAL` `ARC_WEBHOOK_SECRET` `HERMES_AGENT_API_TOKEN` |
| Metered spend | `GEMINI_API_KEY` `CLAUDE_CODE_OAUTH_TOKEN` |
| Email | `RESEND_API_KEY` `RESEND_WEBHOOK_SECRET` |
| Cron / scan | `CRON_SECRET` `OPPORTUNITY_SCAN_CRON_ENABLED` |
| Paging humans | `ALERT_SLACK_WEBHOOK_URL` `MARK_WEBHOOK_URL` |

## How to do this safely — read before touching env vars

**Never `vercel env rm NAME preview`.** Most of these are ONE record with two
targets, so removing the preview target deletes the record for **production
too**. That happened on 2026-07-31 and turned prod sending off.

It is worse than it sounds: 22 of these are `type: sensitive`, which
`vercel env pull` returns **blank**. Deleting one destroys the production value
with no local copy — recoverable only from the upstream provider's dashboard.

`PATCH` changes scope and **cannot destroy a value**. That is the whole safety
argument: use it, and never call DELETE.

```bash
TOKEN=$(node -e "console.log(require(process.env.HOME+'/Library/Application Support/com.vercel.cli/auth.json').token)")
PRJ=prj_1V1nV2MVIJFuYCx11zZFognot31N; TEAM=team_tGGE0Jx59AkFAdeQUsxaf3gI

# 1. Snapshot ids + targets FIRST — this is the rollback.
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v9/projects/$PRJ/env?teamId=$TEAM&limit=200" > snapshot.json

# 2. Scope one record to production. Value untouched.
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"target":["production"]}' "https://api.vercel.com/v9/projects/$PRJ/env/$ENV_ID?teamId=$TEAM"
```

Rollback is the same call with the original `target` from the snapshot.

Verify **by record id**, not by name — several names exist more than once across
targets, and keying on the name silently collapses them into one:

```
records by id — before: 50  after: 50
RECORDS DESTROYED: NONE
lost production scope: none
```

## What is still preview-scoped, and why

| variable | why it stays |
| --- | --- |
| `ARC_AUTH_MODE` `ARC_DISPLAY_NAME` `ARC_MEDIA_ENABLED` `OPERATOR_EMAIL` | Configuration and labels, not credentials. No outbound reach, no spend. |
| `ARC_SEND_ENABLED` | Already preview-only, and it is the gate that keeps sending **off** in preview. Removing it would be the wrong direction. |
| `GOOGLE_DRIVE_*` (6) | The reference-image picker: a user-initiated file pick in the browser. It does not write to BSR systems or spend. See the open item below. |
| `NEXT_PUBLIC_SENTRY_DSN` | Removing it blinds preview error reporting entirely. See below. |
| `APP_API_BASE_URL` | The app's own API base — the preview needs it to serve. See below. |

## Open, and deliberately not fixed here

Three want a **preview-specific value**, which means creating one rather than
deleting production's. None of them can write to the outside world or spend, so
they were left working rather than broken:

1. **`NEXT_PUBLIC_SENTRY_DSN`** — preview errors currently land in the
   production Sentry project, mixed in with real incidents. Wants its own
   preview DSN.
2. **`APP_API_BASE_URL`** — if this points at the production origin, a preview
   calls prod's API. Wants a value pointing at the preview's own origin.
3. **`GOOGLE_DRIVE_*`** — ideally a preview OAuth client. The redirect URI
   differs per environment anyway, so this is likely already half-broken in
   preview rather than dangerous.

## Re-running the inventory

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.vercel.com/v9/projects/$PRJ/env?teamId=$TEAM&limit=200" \
| python3 -c "
import json,sys
for e in sorted(json.load(sys.stdin)['envs'], key=lambda e: e['key']):
    if 'preview' in (e.get('target') or []):
        print(f\"{e['key']:<34} {','.join(e['target']):<22} {e.get('type')}\")"
```

Anything new in that list that can act on the outside world is a regression.
