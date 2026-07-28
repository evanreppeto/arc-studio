import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Compliance layer for outbound marketing email.
 *
 * Three things were missing from every send, and two of them are legal rather
 * than cosmetic:
 *
 * 1. A working unsubscribe. `contacts.email_unsubscribed_at` has existed since
 *    2026-07-10 but nothing ever read or wrote it — no link, no route, and no
 *    suppression check at send time. CAN-SPAM (US), CASL (CA) and PECR/GDPR
 *    (EU/UK) all require a functioning opt-out.
 * 2. A physical postal address in the body. Required by CAN-SPAM for every
 *    commercial message; it cannot be inferred, so the workspace must supply it
 *    and we refuse to send marketing mail without it.
 * 3. `List-Unsubscribe` headers. Gmail and Yahoo require these of bulk senders;
 *    without them mail is filtered regardless of content quality.
 *
 * Everything here is pure so it can be unit-tested without a database or a
 * network, and so the wrapper can't quietly depend on request state.
 */

// ————————————————————————————————————————————————————————————————
// Unsubscribe tokens
// ————————————————————————————————————————————————————————————————

/**
 * An unsubscribe link is a capability: whoever holds it can suppress that
 * contact. So the URL carries an HMAC over (contactId, orgId) rather than a
 * bare id — otherwise anyone could walk ids and unsubscribe a whole workspace,
 * and a one-click header would make that trivial to automate.
 *
 * Deliberately NOT time-limited: a recipient may act on a year-old email, and
 * an expired unsubscribe link is a compliance failure. The token is scoped to a
 * single contact, so long life costs nothing.
 */
export type UnsubscribeClaims = { contactId: string; orgId: string };

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function claimsPayload(claims: UnsubscribeClaims): string {
  return `${claims.orgId}:${claims.contactId}`;
}

export function buildUnsubscribeToken(claims: UnsubscribeClaims, secret: string): string {
  if (!secret) throw new Error("buildUnsubscribeToken: secret is required.");
  return sign(secret, claimsPayload(claims));
}

/**
 * Constant-time compare. A fast-path `===` leaks how much of the signature
 * matched, which is enough to forge one given enough attempts.
 */
export function verifyUnsubscribeToken(
  claims: UnsubscribeClaims,
  token: string,
  secret: string,
): boolean {
  if (!secret || !token) return false;
  const expected = Buffer.from(sign(secret, claimsPayload(claims)));
  const actual = Buffer.from(token);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function buildUnsubscribeUrl(
  siteUrl: string,
  claims: UnsubscribeClaims,
  secret: string,
): string {
  const base = siteUrl.replace(/\/+$/, "");
  const token = buildUnsubscribeToken(claims, secret);
  const params = new URLSearchParams({ c: claims.contactId, o: claims.orgId, t: token });
  return `${base}/api/unsubscribe?${params.toString()}`;
}

// ————————————————————————————————————————————————————————————————
// Sender identity
// ————————————————————————————————————————————————————————————————

export type EmailSenderIdentity = {
  /** Display name in the footer, e.g. the workspace or business name. */
  senderName: string;
  /** Physical postal address. Legally required; no default is possible. */
  postalAddress: string;
  /** Optional line explaining why the recipient is hearing from you. */
  permissionReminder?: string;
};

export type SenderIdentityProblem = "missing_sender_name" | "missing_postal_address";

/**
 * Marketing mail without a postal address is not sendable, so this is a gate
 * rather than a warning. Returning the specific problem lets the caller tell an
 * operator exactly which Settings field to fill instead of "send failed".
 */
export function checkSenderIdentity(
  identity: Partial<EmailSenderIdentity> | null | undefined,
): SenderIdentityProblem[] {
  const problems: SenderIdentityProblem[] = [];
  if (!identity?.senderName?.trim()) problems.push("missing_sender_name");
  if (!identity?.postalAddress?.trim()) problems.push("missing_postal_address");
  return problems;
}

export function describeSenderIdentityProblem(problem: SenderIdentityProblem): string {
  switch (problem) {
    case "missing_sender_name":
      return "Set a sender name in Settings → Email before sending marketing email.";
    case "missing_postal_address":
      return "Add your physical postal address in Settings → Email. Commercial email legally requires one.";
  }
}

// ————————————————————————————————————————————————————————————————
// Rendering
// ————————————————————————————————————————————————————————————————

export type EmailBrand = {
  /** Absolute URL. Relative paths don't resolve in a mail client. */
  logoUrl?: string | null;
  /** Hex accent used for links and the rule above the footer. */
  accentHex?: string | null;
};

const DEFAULT_ACCENT = "#c8a24a";

/** Mail clients don't sanitize for us, and a stray `<` in a business name breaks layout. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Accept only a plain hex colour; anything else is untrusted input in a style attribute. */
function safeAccent(hex: string | null | undefined): string {
  return hex && /^#[0-9a-fA-F]{3,8}$/.test(hex.trim()) ? hex.trim() : DEFAULT_ACCENT;
}

export type WrapEmailInput = {
  html?: string | null;
  text?: string | null;
  identity: EmailSenderIdentity;
  brand?: EmailBrand;
  unsubscribeUrl: string;
};

export type WrappedEmail = { html: string | null; text: string | null };

/**
 * Wrap a drafted body in the workspace's brand and the compliance footer.
 *
 * Table-based layout with inline styles on purpose: Outlook still renders with
 * Word's HTML engine, which ignores most of flexbox, grid, and `<style>` blocks.
 * This is the boring shape that survives it.
 *
 * The body is inserted as-is. Arc's drafts are already HTML and the operator can
 * edit them, so escaping here would render tags as literal text.
 */
export function wrapMarketingEmail(input: WrapEmailInput): WrappedEmail {
  const accent = safeAccent(input.brand?.accentHex);
  const senderName = escapeHtml(input.identity.senderName.trim());
  const address = escapeHtml(input.identity.postalAddress.trim());
  const reminder = input.identity.permissionReminder?.trim();

  const html = input.html?.trim()
    ? [
        `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;">`,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 12px;">`,
        `<tr><td align="center">`,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1c21;font-size:15px;line-height:1.6;">`,
        input.brand?.logoUrl
          ? `<tr><td style="padding-bottom:24px;"><img src="${escapeHtml(input.brand.logoUrl)}" alt="${senderName}" height="28" style="height:28px;width:auto;border:0;display:block;"/></td></tr>`
          : `<tr><td style="padding-bottom:24px;font-weight:600;font-size:16px;">${senderName}</td></tr>`,
        `<tr><td>${input.html}</td></tr>`,
        `<tr><td style="padding-top:28px;"><div style="height:1px;background:${accent};opacity:0.35;"></div></td></tr>`,
        `<tr><td style="padding-top:16px;color:#6b6b73;font-size:12px;line-height:1.55;">`,
        reminder ? `<p style="margin:0 0 8px;">${escapeHtml(reminder)}</p>` : "",
        `<p style="margin:0 0 8px;">${senderName}<br/>${address.replace(/\n/g, "<br/>")}</p>`,
        `<p style="margin:0;"><a href="${input.unsubscribeUrl}" style="color:${accent};">Unsubscribe from these emails</a></p>`,
        `</td></tr>`,
        `</table></td></tr></table></body></html>`,
      ]
        .filter(Boolean)
        .join("")
    : null;

  const text = input.text?.trim()
    ? [
        input.text.trim(),
        "",
        "—",
        ...(reminder ? [reminder, ""] : []),
        input.identity.senderName.trim(),
        input.identity.postalAddress.trim(),
        "",
        `Unsubscribe: ${input.unsubscribeUrl}`,
      ].join("\n")
    : null;

  return { html, text };
}

/**
 * `List-Unsubscribe` plus `List-Unsubscribe-Post` is what makes Gmail render its
 * native one-click unsubscribe. The Post header is required for one-click — with
 * the URL alone, Gmail may treat the link as an ordinary hyperlink and some
 * scanners will GET it, which would unsubscribe people who never asked. That's
 * why the route only acts on POST.
 */
export function buildListUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  if (!unsubscribeUrl) return {};
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
