import { sendBrandedEmail } from "@/lib/email";

import { parsePlatformAdmins } from "./admin";

export type NotifyResult =
  | { ok: true; notified: string[] }
  | { ok: false; reason: "no_recipients" | "send_failed"; error?: string };

/**
 * Tells the platform operators when someone joins the waitlist.
 *
 * Recipients are the same allowlist that gates the Settings viewer
 * (ARC_PLATFORM_ADMIN_EMAILS) — one place to configure who is "us". Unset means
 * no notification, which is why this returns a reason instead of throwing.
 *
 * This is an internal transactional email to the operators, not outbound to a
 * prospect, so it doesn't touch the campaign approval gate — same class as the
 * existing workspace-invite email.
 *
 * Never throws: a delivery failure must not fail the signup that triggered it.
 */
export async function notifyWaitlistSignup(params: {
  email: string;
  source: string;
  total?: number | null;
}): Promise<NotifyResult> {
  const recipients = parsePlatformAdmins(process.env.ARC_PLATFORM_ADMIN_EMAILS);
  if (recipients.length === 0) return { ok: false, reason: "no_recipients" };

  try {
    const countLine =
      typeof params.total === "number" && params.total > 0
        ? `That makes ${params.total.toLocaleString()} ${params.total === 1 ? "signup" : "signups"} so far.`
        : null;

    const sent = await sendBrandedEmail({
      to: recipients,
      subject: `Waitlist signup — ${params.email}`,
      heading: "New waitlist signup",
      bodyBlocks: [
        `${params.email} just joined the Arc Studio waitlist.`,
        `Source: ${params.source}`,
        ...(countLine ? [countLine] : []),
      ],
      theme: { appName: "Arc Studio", accentColor: "#c8a24a" },
      footerNote: "You're receiving this because your address is on ARC_PLATFORM_ADMIN_EMAILS.",
      product: { name: "Arc Studio" },
    });
    if (!sent.ok) return { ok: false, reason: "send_failed", error: sent.error ?? undefined };
    return { ok: true, notified: recipients };
  } catch (error) {
    return { ok: false, reason: "send_failed", error: error instanceof Error ? error.message : String(error) };
  }
}
