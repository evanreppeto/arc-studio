import { type SupabaseClient } from "@supabase/supabase-js";

import {
  TRIAL_EXPIRED_NOTICE,
  dueTrialWarning,
  formatTrialEndsOn,
  dueUsageNotice,
  formatResetDate,
  isExpiryNoticeDue,
  normalizePlanTier,
  noticeKey,
  pctOfCap,
  resolveTrialState,
  usageNoticeKey,
  trialCountdownLabel,
  type TrialState,
} from "@/domain";
import { sendBrandedEmail } from "@/lib/email";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { getMonthToDateUsageCents, resolveOrgPlan } from "./entitlements";
import { markTrialNoticeSent, markUsageNoticeSent } from "./trial";

// The billing mailer, driven by cron: trial warnings + expiry, and usage
// warnings at 80% / 100% of the monthly allowance.
//
// These are TRANSACTIONAL notices about the recipient's own account, not
// marketing — so they don't pass through the campaign approval gate, exactly
// like an invite or a password reset. They also carry no suppression risk,
// because they only ever go to workspace owners about their own workspace.
//
// Idempotent by construction: every notice records its key on the org row before
// it can be sent again, so a cron that runs twice cannot email a customer twice.

export type TrialNoticeOutcome = {
  orgId: string;
  notice: string;
  sent: boolean;
  reason?: string;
};

export type TrialNoticeRunSummary = {
  scanned: number;
  sent: number;
  skipped: number;
  failed: number;
  outcomes: TrialNoticeOutcome[];
};

type TrialRow = {
  org_id: string;
  plan_tier: string;
  trial_ends_at: string | null;
  subscription_status: string | null;
  trial_notices_sent: string[] | null;
};

type UsageRow = {
  org_id: string;
  usage_notices_sent: string[] | null;
};

export type TrialNoticeDeps = {
  /** Injected in tests; defaults to the real branded transactional mailer. */
  send?: typeof sendBrandedEmail;
  /** Resolve the owner addresses for an org. Injected in tests. */
  recipientsFor?: (orgId: string, client: SupabaseClient) => Promise<string[]>;
  now?: Date;
};

/**
 * Org owners/admins — the people who can actually act on a trial notice.
 *
 * Two-step rather than a join: memberships carry `user_id` and an
 * `invited_email` (which is only the address an invite went to), while the
 * member's real address lives on `profiles`. Falls back to `invited_email` when
 * a profile row hasn't been created yet, so a brand-new workspace whose owner
 * signed up moments ago is still reachable.
 */
async function defaultRecipients(orgId: string, client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("user_id,invited_email,role,status")
    .eq("org_id", orgId)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  if (error || !data) return [];

  const rows = data as Array<{ user_id: string | null; invited_email: string | null }>;
  const userIds = rows.map((r) => r.user_id).filter((id): id is string => Boolean(id));

  const byId = new Map<string, string | null>();
  if (userIds.length) {
    const { data: profiles } = await client.from("profiles").select("id,email").in("id", userIds);
    for (const p of (profiles ?? []) as Array<{ id: string; email: string | null }>) byId.set(p.id, p.email);
  }

  const emails = rows
    .map((r) => (r.user_id ? byId.get(r.user_id) ?? null : null) ?? r.invited_email)
    .filter((email): email is string => Boolean(email));

  return [...new Set(emails)];
}

function warningCopy(state: TrialState, days: number) {
  return {
    subject: `${trialCountdownLabel(state)} in your Arc Studio trial`,
    heading: days === 1 ? "Your trial ends tomorrow" : `${trialCountdownLabel(state)} in your trial`,
    bodyBlocks: [
      `Your Arc Studio trial ends on ${formatTrialEndsOn(state)}.`,
      "When it does, your workspace becomes read-only: everything you've built stays exactly where it is and stays readable, but Arc stops working and outbound pauses.",
      "Adding a plan keeps it running — Arc picks up where it left off.",
    ],
  };
}

function usageCopy(threshold: 80 | 100, capCents: number, pct: number, now: Date) {
  const cap = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    capCents / 100,
  );
  const resetsOn = formatResetDate(now);
  if (threshold === 100) {
    return {
      subject: `You've used this month's ${cap} Arc allowance`,
      heading: "Arc has paused new work",
      bodyBlocks: [
        `Your workspace has used its ${cap} allowance for this billing period.`,
        `Arc won't start new work until it resets on ${resetsOn}. Your data, approved campaigns and scheduled sends are unaffected — nothing has been paused except new agent work.`,
        "Upgrading lifts the limit straight away.",
      ],
    };
  }
  return {
    subject: `${pct}% of this month's Arc allowance used`,
    heading: `You've used ${pct}% of this month's allowance`,
    bodyBlocks: [
      `Your workspace has used ${pct}% of its ${cap} allowance for this billing period.`,
      `At 100% Arc pauses new work until it resets on ${resetsOn}. Nothing stops before then.`,
      "If you expect to keep going at this rate, upgrading now avoids the interruption.",
    ],
  };
}

function expiredCopy() {
  return {
    subject: "Your Arc Studio trial has ended",
    heading: "Your trial has ended",
    bodyBlocks: [
      "Your workspace is now read-only. Nothing has been deleted — your records, campaigns, personas and history are all still there, and you can still read all of it.",
      "Arc has stopped working and outbound is paused until you add a plan.",
      "Add a plan whenever you're ready and everything resumes where it left off.",
    ],
  };
}

/**
 * Send any due trial warnings and expiry notices.
 *
 * Read-only with respect to the trial itself — it never changes a trial's dates
 * or a workspace's access. Expiry is a function of the clock (see
 * `resolveTrialState`), not of this job having run, so a missed cron delays an
 * email, never a customer's access in either direction.
 */
export async function runTrialNotices(
  deps: TrialNoticeDeps = {},
  client?: SupabaseClient,
): Promise<TrialNoticeRunSummary> {
  const summary: TrialNoticeRunSummary = { scanned: 0, sent: 0, skipped: 0, failed: 0, outcomes: [] };
  if (!client && !isSupabaseAdminConfigured()) return summary;

  const db = client ?? getSupabaseAdminClient();
  const send = deps.send ?? sendBrandedEmail;
  const recipientsFor = deps.recipientsFor ?? defaultRecipients;
  const now = deps.now ?? new Date();

  const { data, error } = await db
    .from("org_plans")
    .select("org_id,plan_tier,trial_ends_at,subscription_status,trial_notices_sent")
    .not("trial_ends_at", "is", null);
  if (error || !data) return summary;

  for (const row of data as TrialRow[]) {
    summary.scanned += 1;
    const sentAlready = row.trial_notices_sent ?? [];
    const state = resolveTrialState({
      trialEndsAt: row.trial_ends_at,
      planTier: normalizePlanTier(row.plan_tier),
      subscriptionStatus: row.subscription_status,
      now,
    });

    const warningDays = dueTrialWarning(state, sentAlready);
    const expiryDue = isExpiryNoticeDue(state, sentAlready);
    if (warningDays === null && !expiryDue) {
      summary.skipped += 1;
      continue;
    }

    const key = expiryDue ? TRIAL_EXPIRED_NOTICE : noticeKey(warningDays!);
    const copy = expiryDue ? expiredCopy() : warningCopy(state, warningDays!);

    const to = await recipientsFor(row.org_id, db);
    if (!to.length) {
      // Nobody to tell. Mark it anyway — otherwise every future run retries a
      // notice that can never be delivered, and the log fills with noise.
      await markTrialNoticeSent({ orgId: row.org_id, noticeKey: key }, db);
      summary.skipped += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: false, reason: "no_recipients" });
      continue;
    }

    // Record BEFORE sending. A duplicate charge-free email is still a trust
    // problem, and a crash between send and record would repeat it on the next
    // run; this way the worst case is a missed notice, which is recoverable.
    const marked = await markTrialNoticeSent({ orgId: row.org_id, noticeKey: key }, db);
    if (!marked.ok) {
      summary.failed += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: false, reason: marked.reason });
      continue;
    }

    const result = await send({
      to,
      subject: copy.subject,
      heading: copy.heading,
      bodyBlocks: copy.bodyBlocks,
      cta: { label: "Choose a plan", url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings/billing` },
      theme: { appName: "Arc Studio", accentColor: "#c8a24a" },
      footerNote: "You're receiving this because you own an Arc Studio workspace.",
    });

    if (result.ok) {
      summary.sent += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: true });
    } else {
      summary.failed += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: false, reason: result.error });
    }
  }

  return summary;
}

/**
 * Send any due usage warnings (80% / 100% of the monthly allowance).
 *
 * Separate pass from the trial mail because the two answer different questions
 * and re-arm on different clocks. A workspace whose trial has lapsed is skipped:
 * it already got the more actionable "your trial ended" message, and telling
 * someone they're at 80% of an allowance they can no longer spend is noise.
 */
export async function runUsageNotices(
  deps: TrialNoticeDeps = {},
  client?: SupabaseClient,
): Promise<TrialNoticeRunSummary> {
  const summary: TrialNoticeRunSummary = { scanned: 0, sent: 0, skipped: 0, failed: 0, outcomes: [] };
  if (!client && !isSupabaseAdminConfigured()) return summary;

  const db = client ?? getSupabaseAdminClient();
  const send = deps.send ?? sendBrandedEmail;
  const recipientsFor = deps.recipientsFor ?? defaultRecipients;
  const now = deps.now ?? new Date();

  const { data, error } = await db.from("org_plans").select("org_id,usage_notices_sent");
  if (error || !data) return summary;

  for (const row of data as UsageRow[]) {
    summary.scanned += 1;

    // Resolve the effective plan per org so the trial allowance (not the tier
    // default) is what a trialling workspace is measured against.
    const [plan, usedCents] = await Promise.all([
      resolveOrgPlan(row.org_id, db),
      getMonthToDateUsageCents(row.org_id, db),
    ]);

    if (plan.trial.readOnly) {
      summary.skipped += 1;
      continue;
    }

    const threshold = dueUsageNotice(
      { usedCents, capCents: plan.capCents, now },
      row.usage_notices_sent ?? [],
    );
    if (threshold === null) {
      summary.skipped += 1;
      continue;
    }

    const key = usageNoticeKey(threshold, now);
    const copy = usageCopy(threshold, plan.capCents, pctOfCap(usedCents, plan.capCents), now);

    const to = await recipientsFor(row.org_id, db);
    if (!to.length) {
      await markUsageNoticeSent({ orgId: row.org_id, noticeKey: key }, db);
      summary.skipped += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: false, reason: "no_recipients" });
      continue;
    }

    // Record before sending, same as the trial mail: a missed notice is
    // recoverable, a duplicate is a trust problem.
    const marked = await markUsageNoticeSent({ orgId: row.org_id, noticeKey: key }, db);
    if (!marked.ok) {
      summary.failed += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: false, reason: marked.reason });
      continue;
    }

    const result = await send({
      to,
      subject: copy.subject,
      heading: copy.heading,
      bodyBlocks: copy.bodyBlocks,
      cta: { label: "See plans", url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings/billing` },
      theme: { appName: "Arc Studio", accentColor: "#c8a24a" },
      footerNote: "You're receiving this because you own an Arc Studio workspace.",
    });

    if (result.ok) {
      summary.sent += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: true });
    } else {
      summary.failed += 1;
      summary.outcomes.push({ orgId: row.org_id, notice: key, sent: false, reason: result.error });
    }
  }

  return summary;
}
