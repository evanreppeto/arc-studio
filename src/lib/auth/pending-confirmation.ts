import type { NextResponse } from "next/server";

/**
 * The address a just-submitted sign-up is waiting on.
 *
 * Carried in a short-lived httpOnly cookie rather than a query string: the
 * "check your inbox" screen needs to show the operator *which* address the mail
 * went to (and offer a resend), but an email address in a URL leaks into
 * referrers, server logs, and browser history. The cookie is read by the
 * sign-up page and by the resend route, which is also why resend never has to
 * trust an address supplied by the caller.
 */
export const PENDING_CONFIRMATION_COOKIE = "arc_pending_confirmation";

/** Long enough to read the screen and hit resend; short enough not to linger. */
const MAX_AGE_SECONDS = 30 * 60;

export function setPendingConfirmationEmail(response: NextResponse, email: string): NextResponse {
  response.cookies.set(PENDING_CONFIRMATION_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export function clearPendingConfirmationEmail(response: NextResponse): NextResponse {
  response.cookies.set(PENDING_CONFIRMATION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

/**
 * Accept a cookie value only if it still looks like the address we wrote. Cheap
 * defence against a hand-edited cookie being echoed back onto the page.
 */
export function readPendingConfirmationEmail(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim();
  if (!value || value.length > 254) return null;
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * Split an address for display: "evan@example.com" → local "evan", domain
 * "example.com". Used to offer a one-click jump to the right webmail inbox.
 */
export function inboxProviderUrl(email: string): { label: string; url: string } | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return { label: "Open Gmail", url: "https://mail.google.com/mail/u/0/#search/from%3Aarc-studio.ai" };
  }
  if (domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com" || domain === "msn.com") {
    return { label: "Open Outlook", url: "https://outlook.live.com/mail/0/inbox" };
  }
  if (domain === "yahoo.com" || domain === "ymail.com") {
    return { label: "Open Yahoo Mail", url: "https://mail.yahoo.com/d/folders/1" };
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return { label: "Open iCloud Mail", url: "https://www.icloud.com/mail" };
  }
  // Work domains: no reliable webmail URL, so the screen just omits the shortcut.
  return null;
}
