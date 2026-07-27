import { describe, expect, it, vi } from "vitest";

import { type sendBrandedEmail } from "@/lib/email";

import { runTrialNotices } from "./trial-notices";

/** Typed so assertions on the mailer's arguments keep their types. */
type SendInput = Parameters<typeof sendBrandedEmail>[0];
const mailer = (ok = true, error?: string) =>
  vi.fn(async (_input: SendInput) => (ok ? { ok: true, id: "email-1" } : { ok: false, error }));

const DAY = 86_400_000;
const NOW = new Date("2026-07-27T12:00:00.000Z");

type Row = {
  org_id: string;
  plan_tier: string;
  trial_ends_at: string | null;
  subscription_status?: string | null;
  trial_notices_sent?: string[] | null;
};

/**
 * Supabase stub over a mutable row set, so "record the notice, then don't send
 * it again" is exercised for real rather than asserted from the code.
 */
function makeClient(rows: Row[]) {
  const updates: Array<{ org_id: string; trial_notices_sent: string[] }> = [];

  const client = {
    from(table: string) {
      if (table === "org_plans") {
        const chain: Record<string, unknown> = {};
        let targetOrg: string | null = null;
        chain.select = () => chain;
        chain.not = () => chain;
        chain.eq = (_col: string, value: string) => {
          targetOrg = value;
          return chain;
        };
        chain.maybeSingle = async () => ({
          data: rows.find((r) => r.org_id === targetOrg) ?? null,
          error: null,
        });
        chain.update = (patch: { trial_notices_sent?: string[] }) => ({
          eq: async (_col: string, value: string) => {
            const row = rows.find((r) => r.org_id === value);
            if (row && patch.trial_notices_sent) {
              row.trial_notices_sent = patch.trial_notices_sent;
              updates.push({ org_id: value, trial_notices_sent: patch.trial_notices_sent });
            }
            return { error: null };
          },
        });
        chain.then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve);
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;

  return { client, updates };
}

function run(rows: Row[], opts: { now?: Date; sendOk?: boolean } = {}) {
  const { client } = makeClient(rows);
  const send = mailer(opts.sendOk ?? true);
  return {
    send,
    result: runTrialNotices(
      { send, recipientsFor: async () => ["owner@example.com"], now: opts.now ?? NOW },
      client,
    ),
  };
}

describe("runTrialNotices", () => {
  it("says nothing while the trial has comfortable runway", async () => {
    const { send, result } = run([
      { org_id: "o1", plan_tier: "free", trial_ends_at: new Date(NOW.getTime() + 10 * DAY).toISOString() },
    ]);
    const summary = await result;
    expect(send).not.toHaveBeenCalled();
    expect(summary.sent).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("sends the warning once the threshold is crossed", async () => {
    const { send, result } = run([
      { org_id: "o1", plan_tier: "free", trial_ends_at: new Date(NOW.getTime() + 3 * DAY).toISOString() },
    ]);
    const summary = await result;
    expect(summary.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].subject).toContain("3 days left");
  });

  // The property that matters most: cron runs daily, and a customer must never
  // get the same notice twice.
  it("is idempotent across repeated runs", async () => {
    const rows: Row[] = [
      { org_id: "o1", plan_tier: "free", trial_ends_at: new Date(NOW.getTime() + 3 * DAY).toISOString() },
    ];
    const { client } = makeClient(rows);
    const send = mailer();
    const deps = { send, recipientsFor: async () => ["owner@example.com"], now: NOW };

    await runTrialNotices(deps, client);
    await runTrialNotices(deps, client);
    await runTrialNotices(deps, client);

    expect(send).toHaveBeenCalledTimes(1);
    expect(rows[0]!.trial_notices_sent).toEqual(["trial_t_minus_3"]);
  });

  it("sends the expiry notice once a trial lapses", async () => {
    const { send, result } = run([
      { org_id: "o1", plan_tier: "free", trial_ends_at: new Date(NOW.getTime() - DAY).toISOString() },
    ]);
    const summary = await result;
    expect(summary.sent).toBe(1);
    expect(send.mock.calls[0]![0].subject).toContain("has ended");
    // Reassurance is the point of this email — it must say nothing was lost.
    expect(send.mock.calls[0]![0].bodyBlocks.join(" ")).toContain("Nothing has been deleted");
  });

  it("never mails a workspace that converted to a paid plan", async () => {
    const { send, result } = run([
      {
        org_id: "o1",
        plan_tier: "pro",
        trial_ends_at: new Date(NOW.getTime() - 5 * DAY).toISOString(),
        subscription_status: "active",
      },
    ]);
    const summary = await result;
    expect(send).not.toHaveBeenCalled();
    expect(summary.sent).toBe(0);
  });

  it("records the notice even when there is nobody to email, so it stops retrying", async () => {
    const rows: Row[] = [
      { org_id: "o1", plan_tier: "free", trial_ends_at: new Date(NOW.getTime() - DAY).toISOString() },
    ];
    const { client } = makeClient(rows);
    const send = mailer();
    const summary = await runTrialNotices({ send, recipientsFor: async () => [], now: NOW }, client);

    expect(send).not.toHaveBeenCalled();
    expect(summary.outcomes[0]).toMatchObject({ notice: "trial_expired", sent: false, reason: "no_recipients" });
    expect(rows[0]!.trial_notices_sent).toEqual(["trial_expired"]);
  });

  it("reports a send failure without pretending it went out", async () => {
    const { client } = makeClient([
      { org_id: "o1", plan_tier: "free", trial_ends_at: new Date(NOW.getTime() - DAY).toISOString() },
    ]);
    const send = mailer(false, "resend down");
    const summary = await runTrialNotices(
      { send, recipientsFor: async () => ["owner@example.com"], now: NOW },
      client,
    );
    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(summary.outcomes[0]!.reason).toBe("resend down");
  });
});
