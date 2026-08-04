"use server";

import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { alertOpsFailure, isOpsAlertingConfigured } from "@/lib/observability/ops-alert";
import { isPlatformAdmin } from "@/lib/waitlist/admin";

/**
 * Send a test alert to the platform ops channel (BSR-477).
 *
 * Alerting you cannot test is alerting you do not trust. The whole point of
 * this channel is the 2am case, and the worst possible discovery is finding out
 * during one that the webhook was wrong, the channel was archived, or the env
 * var never took after a redeploy.
 *
 * Same platform-admin gate as the health console it lives in — this posts to an
 * internal channel, so a workspace operator must not be able to fire it.
 *
 * Deliberately routes through the real `alertOpsFailure`, not a bespoke poster:
 * a test that exercises a different code path proves nothing about the one that
 * runs at 2am. The only difference is the scope, which is uniquified so the
 * 15-minute per-scope mute can't swallow a second attempt.
 */
export type TestAlertResult = { ok: true; message: string } | { ok: false; error: string };

export async function sendTestOpsAlert(): Promise<TestAlertResult> {
  const user = await getSupabaseAuthenticatedUser().catch(() => null);
  if (!isPlatformAdmin(user?.email)) {
    return { ok: false, error: "Not permitted." };
  }

  if (!isOpsAlertingConfigured()) {
    return {
      ok: false,
      error: "ALERT_SLACK_WEBHOOK_URL isn't set on this deployment. Set it in Vercel and redeploy.",
    };
  }

  // Unique per attempt so the per-scope cooldown never makes a retry look like
  // a silent failure — the one thing a test button must never do.
  const stamp = new Date().toISOString();
  const sent = await alertOpsFailure({
    scope: `ops.test-alert.${stamp}`,
    message: "Test alert — platform alerting is wired correctly. Nothing is wrong.",
    detail: { triggeredBy: user?.email ?? "unknown", at: stamp },
    source: "app",
  });

  if (!sent) {
    // isOpsAlertingConfigured() already passed, so reaching here means the POST
    // itself failed — a wrong URL, a deleted webhook, or an archived channel.
    return {
      ok: false,
      error: "The webhook is set but Slack didn't accept the message. Check the URL is current and the channel still exists.",
    };
  }

  return { ok: true, message: "Test alert sent — check the channel." };
}
