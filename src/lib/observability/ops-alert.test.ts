import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


// Static, not `await import(…)` inside each test: `vi.mock` is hoisted above
// imports, so the mocks apply either way. The dynamic form bought nothing and
// charged this file's module transform to whichever test ran first (BSR-739).
import { __resetOpsAlertCooldown, alertOpsFailure, isOpsAlertingConfigured } from "./ops-alert";

const postSlackWebhook = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/integrations/slack/notify", () => ({
  postSlackWebhook: (...args: unknown[]) => postSlackWebhook(...(args as [])),
}));


const URL_VAR = "ALERT_SLACK_WEBHOOK_URL";
const WEBHOOK = "https://hooks.slack.com/services/T/B/xxx";

beforeEach(() => {
  postSlackWebhook.mockClear();
  __resetOpsAlertCooldown();
  process.env[URL_VAR] = WEBHOOK;
});
afterEach(() => {
  delete process.env[URL_VAR];
});

describe("alertOpsFailure", () => {
  it("posts when the webhook is configured", async () => {
    const sent = await alertOpsFailure({ scope: "campaigns.list", message: "column does not exist" });

    expect(sent).toBe(true);
    expect(postSlackWebhook).toHaveBeenCalledOnce();
    const [url, message] = postSlackWebhook.mock.calls[0] as unknown as [string, { text: string }];
    expect(url).toBe(WEBHOOK);
    expect(message.text).toContain("campaigns.list");
    expect(message.text).toContain("column does not exist");
  });

  it("is a no-op when the webhook is not configured", async () => {
    delete process.env[URL_VAR];

    expect(await alertOpsFailure({ scope: "x", message: "y" })).toBe(false);
    expect(postSlackWebhook).not.toHaveBeenCalled();
  });

  it("mutes a repeating scope — one broken query must not flood the channel", async () => {
    // The failure this exists for breaks on EVERY request. Without a cooldown
    // that is 10,000 identical messages, which is how real alerts get ignored.
    const now = 1_000_000;
    await alertOpsFailure({ scope: "campaigns.list", message: "boom" }, { now });
    await alertOpsFailure({ scope: "campaigns.list", message: "boom" }, { now: now + 60_000 });
    await alertOpsFailure({ scope: "campaigns.list", message: "boom" }, { now: now + 5 * 60_000 });

    expect(postSlackWebhook).toHaveBeenCalledOnce();
  });

  it("alerts again once the cooldown passes", async () => {
    const now = 1_000_000;
    await alertOpsFailure({ scope: "campaigns.list", message: "boom" }, { now });
    await alertOpsFailure({ scope: "campaigns.list", message: "boom" }, { now: now + 16 * 60_000 });

    expect(postSlackWebhook).toHaveBeenCalledTimes(2);
  });

  it("mutes per scope, so one noisy failure cannot hide a different one", async () => {
    const now = 1_000_000;
    await alertOpsFailure({ scope: "campaigns.list", message: "boom" }, { now });
    await alertOpsFailure({ scope: "crm.leads", message: "different failure" }, { now: now + 1000 });

    expect(postSlackWebhook).toHaveBeenCalledTimes(2);
  });

  it("never throws when Slack fails — alerting must not become the outage", async () => {
    postSlackWebhook.mockRejectedValueOnce(new Error("slack down"));

    await expect(alertOpsFailure({ scope: "x", message: "y" })).resolves.toBe(false);
  });

  it("renders detail as key=value and drops empties", async () => {
    await alertOpsFailure({
      scope: "s",
      message: "m",
      detail: { orgId: "org_1", rows: 0, missing: null, blank: "" },
    });

    const [, message] = postSlackWebhook.mock.calls[0] as unknown as [string, { text: string }];
    expect(message.text).toContain("orgId=org_1");
    expect(message.text).toContain("rows=0");
    expect(message.text).not.toContain("missing=");
    expect(message.text).not.toContain("blank=");
  });

  it("reports whether alerting is configured", () => {
    expect(isOpsAlertingConfigured()).toBe(true);
    delete process.env[URL_VAR];
    expect(isOpsAlertingConfigured()).toBe(false);
  });
});
