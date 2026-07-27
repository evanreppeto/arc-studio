// Pure, I/O-free transactional email renderer. Produces an email-safe HTML body
// (inline styles, no external CSS) plus a plaintext alternative. The single brand
// shell used by both app-driven sends and the hosted-template export script.

export type BrandEmailTheme = {
  appName: string;
  logoUrl?: string | null;
  /** Initials fallback (e.g. "BS") shown as a monogram when there's no logo. */
  shortMark?: string | null;
  /** Hex color for the CTA button + heading accent. */
  accentColor: string;
};

export type EmailCta = { label: string; url: string };

export type BrandedEmailInput = {
  heading: string;
  bodyBlocks: string[];
  cta?: EmailCta;
  theme: BrandEmailTheme;
  footerNote?: string;
  /** Product ("powered by") co-branding shown in the footer, e.g. Arc. */
  product?: { name: string; logoUrl?: string | null };
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeAccent(value: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : "#0B0B0C";
}

// ---------------------------------------------------------------------------
// Arc's own auth emails (confirm signup / magic link / password recovery).
//
// Deliberately a SEPARATE shell from `renderBrandedEmail` above: that one is
// co-branded with the *customer's* workspace (their logo, their accent) because
// it's their teammate being invited. These are Arc speaking as the product, so
// they carry Arc's obsidian-and-gold identity instead. Same email-safety rules:
// tables, inline styles, no external CSS, absolute image URLs.
// ---------------------------------------------------------------------------

export type AuthEmailInput = {
  /** Editorial headline — the one serif moment, mirroring the auth screens. */
  heading: string;
  /** Inbox preview line. Shown in list view; hidden inside the message body. */
  preheader: string;
  bodyBlocks: string[];
  cta: EmailCta;
  /** Expiry / single-use note rendered under the button in muted type. */
  metaNote?: string;
  footerNote: string;
  appName?: string;
  /** Absolute URL to the square Arc mark. */
  logoUrl?: string | null;
};

export function renderAuthEmail(input: AuthEmailInput): { html: string; text: string } {
  const { heading, preheader, bodyBlocks, cta, metaNote, footerNote } = input;
  const appName = input.appName?.trim() || "Arc Studio";
  const sans = "-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif";
  // Fraunces isn't available to mail clients; a Georgia-led serif stack is the
  // closest widely-installed stand-in for the editorial headline.
  const serif = "Georgia,'Times New Roman',Times,serif";

  const canvas = "#0e0e11"; // outer canvas-deep
  const panel = "#16161a"; // card surface
  const hairline = "#292930";
  const accent = "#c8a24a";
  const onAccent = "#16161a";
  const textPrimary = "#f4f1ea";
  const textSecondary = "#b5b1a8";
  const textMuted = "#83807a";

  // Preheader: the inbox preview line. The trailing whitespace run stops clients
  // from pulling body copy in after it.
  const preheaderBlock = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${escapeHtml(preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`;

  const header = input.logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><img src="${escapeHtml(input.logoUrl)}" alt="" width="28" height="28" style="width:28px;height:28px;display:block;border-radius:6px" /></td><td valign="middle" style="padding-left:10px;font-family:${sans};font-size:15px;font-weight:600;letter-spacing:0.01em;color:${textPrimary}">${escapeHtml(appName)}</td></tr></table>`
    : `<span style="font-family:${sans};font-size:15px;font-weight:600;color:${textPrimary}">${escapeHtml(appName)}</span>`;

  const paragraphs = bodyBlocks
    .map(
      (block) =>
        `<p style="margin:0 0 14px;font-family:${sans};font-size:15px;line-height:1.65;color:${textSecondary}">${escapeHtml(block)}</p>`,
    )
    .join("");

  // Bulletproof-ish button: a padded anchor inside its own table cell so Outlook
  // keeps the fill rather than collapsing to bare link text.
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${accent}" style="border-radius:8px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 26px;font-family:${sans};font-size:15px;font-weight:600;color:${onAccent};text-decoration:none;border-radius:8px">${escapeHtml(cta.label)}</a></td></tr></table>`;

  const meta = metaNote
    ? `<p style="margin:18px 0 0;font-family:${sans};font-size:12.5px;line-height:1.55;color:${textMuted}">${escapeHtml(metaNote)}</p>`
    : "";

  // Copy/paste fallback for clients that strip or mangle the button.
  const fallback = `<p style="margin:22px 0 0;font-family:${sans};font-size:12.5px;line-height:1.55;color:${textMuted}">Or paste this link into your browser:<br /><a href="${escapeHtml(cta.url)}" style="color:${accent};text-decoration:underline;word-break:break-all">${escapeHtml(cta.url)}</a></p>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta name="color-scheme" content="dark light" /><meta name="supported-color-schemes" content="dark light" /></head>
<body style="margin:0;padding:0;background:${canvas};font-family:${sans}">
${preheaderBlock}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${canvas}" style="background:${canvas}"><tr><td align="center" style="padding:32px 20px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%;background:${panel};border:1px solid ${hairline};border-radius:14px">
<tr><td style="padding:26px 32px 0">${header}</td></tr>
<tr><td style="padding:26px 32px 0">
<h1 style="margin:0 0 16px;font-family:${serif};font-size:27px;font-weight:400;line-height:1.2;color:${textPrimary}">${escapeHtml(heading)}</h1>
${paragraphs}
<div style="margin:24px 0 0">${button}</div>
${meta}
${fallback}
</td></tr>
<tr><td style="padding:26px 32px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${hairline};padding-top:16px">
<p style="margin:0;font-family:${sans};font-size:12px;line-height:1.55;color:${textMuted}">${escapeHtml(footerNote)}</p>
</td></tr></table>
</td></tr>
</table>
</td></tr></table></body></html>`;

  const text = [
    heading,
    "",
    ...bodyBlocks,
    "",
    `${cta.label}: ${cta.url}`,
    ...(metaNote ? ["", metaNote] : []),
    "",
    footerNote,
  ].join("\n");

  return { html, text };
}

export function renderBrandedEmail(input: BrandedEmailInput): { html: string; text: string } {
  const { heading, bodyBlocks, cta, theme, footerNote, product } = input;
  const accent = safeAccent(theme.accentColor);
  const sans = "-apple-system,Segoe UI,Helvetica,Arial,sans-serif";

  // Header shows the inviting workspace's brand: its logo, or a monogram badge
  // built from its short mark (initials), or its name as a last resort.
  const mark = (theme.shortMark ?? "").trim().slice(0, 3).toUpperCase();
  const workspaceHeader = theme.logoUrl
    ? `<img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.appName)}" height="36" style="height:36px;display:block" />`
    : mark
      ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;background:${escapeHtml(accent)};border-radius:10px;color:#ffffff;font-size:15px;font-weight:700;font-family:${sans}">${escapeHtml(mark)}</td><td style="padding-left:12px;font-size:16px;font-weight:600;color:#0B0B0C;font-family:${sans}">${escapeHtml(theme.appName)}</td></tr></table>`
      : `<strong style="font-size:18px;color:#0B0B0C">${escapeHtml(theme.appName)}</strong>`;

  const paragraphs = bodyBlocks
    .map((block) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f1f23">${escapeHtml(block)}</p>`)
    .join("");

  const button = cta
    ? `<a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${escapeHtml(accent)};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600">${escapeHtml(cta.label)}</a>`
    : "";

  const footer = footerNote
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8a8a8f">${escapeHtml(footerNote)}</p>`
    : "";

  // Footer: "Powered by <product>" co-branding — always show the name as text
  // (survives image-blocking clients / spam) with the logo mark beside it when
  // images load. alt="" so a blocked image collapses instead of showing a broken
  // placeholder next to the wordmark.
  const productMark = product
    ? `${product.logoUrl ? `<img src="${escapeHtml(product.logoUrl)}" alt="" width="16" height="16" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:6px" />` : ""}<strong style="font-size:13px;color:#0B0B0C;font-family:${sans};vertical-align:middle">${escapeHtml(product.name)}</strong>`
    : "";
  const productFooter = product
    ? `<tr><td style="padding-top:24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #ececeb;padding-top:16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="font-size:12px;color:#8a8a8f;padding-right:7px;font-family:${sans}">Powered by</td><td valign="middle">${productMark}</td></tr></table></td></tr></table></td></tr>`
    : "";

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f5f5f4;padding:24px;font-family:${sans}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="padding-bottom:24px">${workspaceHeader}</td></tr>
<tr><td><h1 style="margin:0 0 16px;font-size:20px;color:#0B0B0C">${escapeHtml(heading)}</h1>${paragraphs}${button ? `<div style="margin:24px 0">${button}</div>` : ""}${footer}</td></tr>
${productFooter}
</table></td></tr></table></body></html>`;

  const textLines = [heading, "", ...bodyBlocks];
  if (cta) textLines.push("", `${cta.label}: ${cta.url}`);
  if (footerNote) textLines.push("", footerNote);
  if (product) textLines.push("", `Powered by ${product.name}`);
  const text = textLines.join("\n");

  return { html, text };
}
