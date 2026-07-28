import {
  buildResendEmailPayload,
  renderBrandedEmail,
  type BrandEmailTheme,
  type EmailCta,
  type ResendEmailPayload,
} from "@/domain";

import { resolveBrandIdentity } from "@/lib/brand-kit/identity";
import { sendResendEmail } from "@/lib/connections/resend-client";

const DEFAULT_THEME: BrandEmailTheme = { appName: "Arc", accentColor: "#0B0B0C" };

/** Per-org email theme from the Brand Kit; safe defaults when unavailable. */
export async function resolveBrandEmailTheme(): Promise<BrandEmailTheme> {
  try {
    const identity = await resolveBrandIdentity();
    return {
      appName: identity.displayName || DEFAULT_THEME.appName,
      logoUrl: identity.logoUrl || undefined,
      shortMark: identity.shortMark || undefined,
      accentColor: DEFAULT_THEME.accentColor,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export type SendBrandedEmailResult = { ok: boolean; id?: string; error?: string };

export type SendBrandedEmailDeps = {
  send?: (apiKey: string, payload: ResendEmailPayload) => Promise<{ id: string }>;
  apiKey?: string;
  from?: string;
};

export async function sendBrandedEmail(
  input: {
    to: string | string[];
    subject: string;
    heading: string;
    bodyBlocks: string[];
    cta?: EmailCta;
    theme: BrandEmailTheme;
    footerNote?: string;
    product?: { name: string; logoUrl?: string | null };
  },
  deps: SendBrandedEmailDeps = {},
): Promise<SendBrandedEmailResult> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY;
  // Production is configured as RESEND_FROM_EMAIL; .env.example documents
  // RESEND_FROM. Accept either rather than making one of them silently right —
  // this helper fails closed, so a name mismatch meant transactional mail
  // (invites, waitlist notifications) returned "not configured" and sent
  // nothing, with no error surfaced anywhere.
  // `||` not `??`: an env var set to an empty string is as unconfigured as a
  // missing one, and `??` would accept "" and then fail the check below.
  const from = deps.from || process.env.RESEND_FROM || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    return { ok: false, error: "Resend isn't configured (RESEND_API_KEY / RESEND_FROM)." };
  }

  const send = deps.send ?? sendResendEmail;
  const { html, text } = renderBrandedEmail({
    heading: input.heading,
    bodyBlocks: input.bodyBlocks,
    cta: input.cta,
    theme: input.theme,
    footerNote: input.footerNote,
    product: input.product,
  });

  try {
    const payload = buildResendEmailPayload({ from, to: input.to, subject: input.subject, html, text });
    const { id } = await send(apiKey, payload);
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Resend send failed." };
  }
}
