# Email Invites — Delivery Setup

This runbook covers the Supabase and SMTP configuration required for `POST /api/auth/workspace-invites` to deliver invite emails reliably in production.

## 1. Supabase URL Configuration

In the Supabase dashboard for your project, go to **Authentication → URL Configuration**:

- **Site URL**: set to your production domain, e.g. `https://app.example.com`.
- **Redirect URLs**: add **both**
  - `https://app.example.com/auth/confirm` — the `redirectTo` value sent by `inviteUserByEmail` (email-link verification), and
  - `https://app.example.com/auth/callback` — used by Google OAuth sign-in.

Without this, Supabase will reject the `redirectTo` parameter and the invite link in the email will not work.

### 1b. Symptom: the confirmation link points at `localhost`

If a link in a **production** email opens `http://localhost:3000/...`, the cause is
always this section — never the email template. Both `{{ .ConfirmationURL }}` and
`{{ .SiteURL }}` are derived from the project's **Site URL**, and Supabase silently
falls back to Site URL whenever the app's `emailRedirectTo` isn't on the **Redirect
URLs** allow-list. So a stale Site URL produces a localhost link *and* swallows the
app's own redirect, in one move.

Fix, in the Supabase dashboard → **Authentication → URL Configuration**:

1. **Site URL** → `https://arc-studio.ai` (it ships defaulted to `http://localhost:3000`).
2. **Redirect URLs** → must contain `https://arc-studio.ai/auth/callback` and
   `https://arc-studio.ai/auth/confirm`. Keep `http://localhost:3000/**` as a
   separate entry for local dev — extra entries are harmless, a missing one is not.

The app pins its side of this: `authEmailRedirectOrigin` (`src/lib/auth/email-redirect.ts`)
builds `emailRedirectTo` from `NEXT_PUBLIC_APP_URL` rather than the incoming request
host, so per-deployment `*.vercel.app` hosts and apex/www variants can't each need
their own allow-list entry. **`NEXT_PUBLIC_APP_URL` must be set on the Vercel
production environment** for that to hold; unset, it falls back to the request origin.

Verify after changing: sign up with a throwaway address and confirm the link's host
is `arc-studio.ai`. Existing unconfirmed sign-ups keep their old (bad) link — they
need a fresh email via **Resend the email** on the confirmation screen.

### 1a. Invite email template (OPTIONAL — only with custom SMTP)

You do **not** need to touch the template for invites to work. `/auth/confirm` accepts
**both** token shapes:

- the default template's `?code` (Supabase `{{ .ConfirmationURL }}` → `/auth/v1/verify` →
  redirects to our `redirect_to` with `?code`, which we exchange for a session), and
- a customized template's `?token_hash` + `type` (verified via OTP).

Supabase **locks template editing behind custom SMTP** (which needs a verified domain), so
until you set that up the default plain email is used — and it works via the `?code` path
as long as `/auth/confirm` is in **Redirect URLs** (below). Once you add custom SMTP and a
domain, switch the **Invite user** template link to a branded design pointing at
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`.

## 2. Custom SMTP (Resend) for Reliable Delivery

Supabase's built-in email sender is rate-limited (2 emails/hour on the free tier, low limits on Pro). For team invites that need to reach teammates reliably, configure a custom SMTP provider:

1. Sign up at [resend.com](https://resend.com) and create an API key.
2. In Supabase dashboard go to **Project Settings → Auth → SMTP Settings**.
3. Enable **Custom SMTP** and fill in:
   - **Host**: `smtp.resend.com`
   - **Port**: `465` (SSL) or `587` (STARTTLS)
   - **Username**: `resend`
   - **Password**: your Resend API key
   - **Sender email**: a verified domain address, e.g. `invites@yourdomain.com`
4. Save and send a test email to confirm delivery.

## 2a. Where each setting lives (config matrix)

| Setting | Vercel (app) | local `.env.local` | Supabase dashboard | Cloud Run (runner) |
|---|---|---|---|---|
| `RESEND_API_KEY` | yes | yes | — | NO — runner sends no email |
| `RESEND_FROM` (branded, on the verified domain) | yes | yes | — | NO |
| Custom SMTP (`smtp.resend.com`, user `resend`, pass = Resend key, sender = branded addr) | — | — | yes (Auth -> SMTP) | — |
| Site URL + Redirect URLs (`/auth/confirm`, `/auth/callback`) | — | — | yes (Auth -> URL Config) | — |
| DKIM / SPF / DMARC | — | — | — (DNS / registrar) | — |

**Cloud Run runner — verify, don't change.** The runner (`apps/arc-runner`) reads no
Resend vars and needs no change for email. Only confirm its shared Arc secrets still
match Vercel:

```bash
gcloud run services describe arc-runner --region us-central1 \
  --format='value(spec.template.spec.containers[0].env)'
```

`APP_API_BASE_URL` should point at the prod app; `ARC_AGENT_API_TOKEN` and
`ARC_WEBHOOK_SECRET` (Secret Manager) must resolve to the same values Vercel holds.
Do not add `RESEND_*` here.

## 2b. Branded invite emails (in-app)

Invites are no longer sent by Supabase. `POST /api/auth/workspace-invites` calls
`auth.admin.generateLink({ type: 'invite' })` to mint the action link WITHOUT sending,
then renders the branded invite (shared shell in `src/domain/email-templates.ts`) and
sends it via Resend with `RESEND_FROM`. The code-only fallback is unchanged: any link or
send failure still returns `ok:true` with the shareable `code` and `emailed:false`.

## 2c. Branded hosted templates (signup confirm / magic link / recovery)

These remain Supabase-sent, so until they're pasted in, **new signups get Supabase's
default "Confirm Your Signup / Follow this link to confirm your user" email**. That's
the plain email in the wild today — it isn't a bug in the app, it's an uninstalled
template. Template editing unlocks once custom SMTP (§2) is on, which it is.

Run `pnpm email:export` to regenerate `docs/email-templates/*.html` from Arc's auth-email
shell (`renderAuthEmail` in `src/domain/email-templates.ts` — obsidian card, gold CTA,
serif headline, preheader, expiry note, copy/paste fallback link). The script prints the
subject line to use beside each file. Then, in **Authentication → Email Templates**, for
each of the three, replace the body with the file's contents and set the subject:

| Dashboard template | File | Subject |
|---|---|---|
| Confirm signup | `signup-confirm.html` | Confirm your email to finish setting up Arc Studio |
| Magic Link | `magic-link.html` | Your Arc Studio sign-in link |
| Reset Password | `recovery.html` | Reset your Arc Studio password |

Also set **Sender name** to `Arc Studio` (it currently sends as `Arc`).

Keep `{{ .ConfirmationURL }}` as the link target. It carries the `next` intent the app
passed to `signUp` / `resetPasswordForEmail` — password recovery depends on it to land on
`/reset-password` instead of dropping the user into the app. Hard-coding
`{{ .SiteURL }}/auth/confirm` would throw that away and would *not* fix a localhost link
(§1b). Re-run + re-paste whenever the shell changes; set `EMAIL_EXPORT_APP_NAME` /
`EMAIL_EXPORT_SITE_URL` / `EMAIL_EXPORT_LOGO_URL` first to override the defaults.

## 3. How Acceptance Works

When an invited user clicks the link in their email:

1. The link (carrying `token_hash` + `type=invite`) lands on `/auth/confirm`.
2. `/auth/confirm/route.ts` calls `supabase.auth.verifyOtp({ type, token_hash })` to establish the session, then `provisionAuthenticatedUser(user)`.
3. `provisionAuthenticatedUser` reads `user.user_metadata.pending_invite_code` (seeded into the invite by `inviteUserByEmail({ data: { pending_invite_code } })`).
4. The code is redeemed: the user is joined to the org and workspace with the role that was set when the code was issued, then routed to `/welcome`.
5. No separate code entry is needed — the link does everything.

> Google OAuth sign-in uses the separate `/auth/callback` route (`exchangeCodeForSession`). The two flows are intentionally kept apart.

## 4. Code Fallback

If the email send fails (e.g. SMTP misconfigured, recipient already registered, Supabase rate limit hit), the route still returns `ok: true` with the issued `code` and `emailed: false`. The invite form displays "Couldn't email them — share this code instead." and shows the code + Copy button, so the operator can send it manually. The code remains valid until it expires.

## 5. Local Development

Leave SMTP unconfigured locally. The form will show the code-only path (no `invitedEmail` in the request, or send will fail gracefully). Use `pnpm seed:arc-demo` to seed demo data; invite codes work independently of email delivery.

## 6. Front-door checklist (do this on every deploy)

Sign-in silently disables itself if the auth mode can't resolve. Verify, in order:

1. **Vercel env** — confirm all are set on the production deployment:
   `ARC_AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. **Supabase URL config** — Site URL = prod domain; Redirect URLs include both
   `/auth/confirm` and `/auth/callback` (§1).
3. **Invite template** — uses the `/auth/confirm?token_hash=…&type=invite` form (§1a).
4. **Verify live** — hit `GET https://<prod>/api/auth/status`. You want:
   ```json
   { "requested": "supabase", "resolved": "supabase", "supabaseConfigured": true }
   ```
   If `resolved` is `"open"` while `requested` is `"supabase"`, the Supabase URL/anon
   key are missing — sign-in is disabled and the server logs an
   `[auth] ARC_AUTH_MODE=supabase requested but …` warning. Fix env and redeploy.
