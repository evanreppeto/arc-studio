import { formatSupportEmail, type SupportEmailContext } from "@/domain";

import { resolveBrandEmailTheme, sendBrandedEmail } from "@/lib/email";

import { resolveSupportInbox } from "./inbox";

/**
 * Email the support inbox about a new request.
 *
 * Internal ops mail, not marketing outbound: it goes to whoever runs Arc, it's
 * triggered by the operator's own click, and it reaches no lead or customer —
 * so it deliberately does NOT consult isLiveSendEnabled() (the kill switch for
 * outbound customer sends), exactly like the workspace-invite email.
 *
 * Never throws. The DB row is the durable record; a delivery failure is
 * reported back so the UI can tell the operator to use the mailto fallback
 * instead of silently swallowing it.
 */
export async function notifySupportInbox(ctx: SupportEmailContext): Promise<{ ok: boolean; error: string | null }> {
  try {
    const inbox = resolveSupportInbox();
    const { subject, heading, bodyBlocks } = formatSupportEmail(ctx);
    const theme = await resolveBrandEmailTheme();
    const sent = await sendBrandedEmail({
      to: inbox,
      subject,
      heading,
      bodyBlocks,
      theme,
      footerNote: `Reference ${ctx.reference}`,
      product: { name: "Arc" },
    });
    return { ok: sent.ok, error: sent.ok ? null : sent.error ?? null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Support notification failed." };
  }
}
