import { NextResponse } from "next/server";

import { verifyUnsubscribeToken } from "@/domain";
import { getUnsubscribeSecret } from "@/lib/dispatch/email-identity";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Email unsubscribe. Public by design — a recipient has no account and must
 * never need one to opt out.
 *
 * Authenticated by an HMAC over (orgId, contactId) rather than a session, so the
 * link works from any mail client but can't be used to suppress a contact the
 * sender didn't address.
 *
 * GET  — renders a confirmation page. Deliberately does NOT unsubscribe:
 *        mail scanners and link-preview bots follow every URL in a message, and
 *        a GET that mutated would silently opt people out who never clicked.
 * POST — performs the unsubscribe. This is also what `List-Unsubscribe-Post`
 *        triggers for Gmail's native one-click control.
 */

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/><title>${title}</title></head>
<body style="margin:0;background:#16161a;color:#f1ede2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;">
<main style="max-width:440px;text-align:center;">${body}</main></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function readClaims(request: Request) {
  const url = new URL(request.url);
  return {
    contactId: url.searchParams.get("c") ?? "",
    orgId: url.searchParams.get("o") ?? "",
    token: url.searchParams.get("t") ?? "",
  };
}

const BTN =
  "display:inline-block;background:#c8a24a;color:#16161a;font-weight:600;padding:12px 24px;border-radius:8px;border:0;font-size:15px;cursor:pointer;";

export async function GET(request: Request): Promise<NextResponse> {
  const { contactId, orgId, token } = readClaims(request);
  const secret = getUnsubscribeSecret();

  if (!secret || !verifyUnsubscribeToken({ contactId, orgId }, token, secret)) {
    return page(
      "Link not valid",
      `<h1 style="font-size:20px;margin:0 0 12px;">This unsubscribe link isn't valid</h1>
       <p style="color:#a5a096;line-height:1.6;margin:0;">It may have been altered in transit. Reply to the email you received and we'll remove you manually.</p>`,
      400,
    );
  }

  // The form POSTs to this same URL, so the confirmation click is the mutation.
  const action = new URL(request.url).pathname + new URL(request.url).search;
  return page(
    "Unsubscribe",
    `<h1 style="font-size:20px;margin:0 0 12px;">Unsubscribe from these emails?</h1>
     <p style="color:#a5a096;line-height:1.6;margin:0 0 24px;">You'll stop receiving marketing email from this sender. This can't be undone from here.</p>
     <form method="post" action="${action}"><button type="submit" style="${BTN}">Unsubscribe me</button></form>`,
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const { contactId, orgId, token } = readClaims(request);
  const secret = getUnsubscribeSecret();

  if (!secret || !verifyUnsubscribeToken({ contactId, orgId }, token, secret)) {
    return page("Link not valid", `<h1 style="font-size:20px;margin:0;">This unsubscribe link isn't valid.</h1>`, 400);
  }

  if (!isSupabaseAdminConfigured()) {
    return page("Unavailable", `<h1 style="font-size:20px;margin:0;">We couldn't process this right now. Please reply to the email instead.</h1>`, 503);
  }

  const { error } = await getSupabaseAdminClient()
    .from("contacts")
    .update({ email_unsubscribed_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("org_id", orgId)
    // Idempotent: Gmail's one-click may fire more than once, and re-POSTing
    // must not move the original opt-out timestamp.
    .is("email_unsubscribed_at", null);

  if (error) {
    return page("Something went wrong", `<h1 style="font-size:20px;margin:0;">We couldn't complete that. Please reply to the email instead.</h1>`, 500);
  }

  return page(
    "Unsubscribed",
    `<h1 style="font-size:20px;margin:0 0 12px;">You're unsubscribed</h1>
     <p style="color:#a5a096;line-height:1.6;margin:0;">You won't receive further marketing email from this sender.</p>`,
  );
}
