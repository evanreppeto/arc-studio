// Renders Arc's auth-email shell with Supabase Go-template placeholders so the
// hosted auth templates (signup confirm / magic link / recovery) stay in sync
// with the repo. Run `pnpm email:export`, then paste each file into the matching
// Supabase dashboard editor (Authentication -> Email Templates) along with the
// subject line printed beside it.
//
// Placeholders ({{ .ConfirmationURL }}) contain no HTML-escapable characters, so
// they survive the renderer's escaping unchanged.
//
// Keep {{ .ConfirmationURL }} as the link target. It round-trips through
// /auth/v1/verify?redirect_to=… and so carries the `next` intent the app passed to
// signUp/resetPasswordForEmail — password recovery in particular depends on it to
// land on /reset-password rather than dropping the user into the app. Hard-coding
// {{ .SiteURL }}/auth/confirm would throw that away AND would not fix a link that
// points at localhost: both placeholders are derived from the project's Site URL,
// so a wrong host is a dashboard setting, never a template bug. See
// docs/runbooks/email-invites-setup.md §1.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderAuthEmail } from "../src/domain/email-templates";

const APP_NAME = process.env.EMAIL_EXPORT_APP_NAME?.trim() || "Arc Studio";
const SITE_URL = (process.env.EMAIL_EXPORT_SITE_URL?.trim() || "https://arc-studio.ai").replace(/\/+$/, "");
const LOGO_URL = process.env.EMAIL_EXPORT_LOGO_URL?.trim() || `${SITE_URL}/icon.png`;

/** Supabase substitutes the verify link, preserving the app's `redirect_to`. */
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

type Template = {
  /** Supabase dashboard subject line. */
  subject: string;
  heading: string;
  preheader: string;
  bodyBlocks: string[];
  ctaLabel: string;
  metaNote: string;
};

const templates: Record<string, Template> = {
  "signup-confirm": {
    subject: `Confirm your email to finish setting up ${APP_NAME}`,
    heading: "Confirm your email",
    preheader: `One click and your ${APP_NAME} workspace is ready.`,
    bodyBlocks: [
      `Confirm this address to finish creating your ${APP_NAME} workspace. It's the last step — everything is set up and waiting on the other side.`,
    ],
    ctaLabel: "Confirm my email",
    metaNote: "This link expires in 24 hours and can only be used once.",
  },
  "magic-link": {
    subject: `Your ${APP_NAME} sign-in link`,
    heading: `Sign in to ${APP_NAME}`,
    preheader: "Your single-use sign-in link is inside.",
    bodyBlocks: ["Use the button below to sign in. No password needed."],
    ctaLabel: "Sign in",
    metaNote: "This link expires shortly and can only be used once.",
  },
  recovery: {
    subject: `Reset your ${APP_NAME} password`,
    heading: "Reset your password",
    preheader: "Choose a new password for your account.",
    bodyBlocks: [
      "We received a request to reset your password. Use the button below to choose a new one.",
      "If that wasn't you, nothing has changed — you can safely ignore this email.",
    ],
    ctaLabel: "Reset password",
    metaNote: "This link expires in 1 hour and can only be used once.",
  },
};

const outDir = resolve(process.cwd(), "docs/email-templates");
mkdirSync(outDir, { recursive: true });

for (const [name, t] of Object.entries(templates)) {
  const { html } = renderAuthEmail({
    heading: t.heading,
    preheader: t.preheader,
    bodyBlocks: t.bodyBlocks,
    cta: { label: t.ctaLabel, url: CONFIRMATION_URL },
    metaNote: t.metaNote,
    footerNote: `Sent by ${APP_NAME}. If you didn't expect this email, you can safely ignore it — no account is created until the link above is used.`,
    appName: APP_NAME,
    logoUrl: LOGO_URL,
  });
  const file = resolve(outDir, `${name}.html`);
  writeFileSync(file, html + "\n", "utf8");
  console.log(`wrote ${file}`);
  console.log(`  subject: ${t.subject}`);
}
