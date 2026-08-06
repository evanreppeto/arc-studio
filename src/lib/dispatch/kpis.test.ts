import { describe, expect, it } from "vitest";

import { WORK_STATE_LABEL } from "@/domain";

import { buildOutboxKpis } from "./kpis";
import { type DispatchStatus, type DispatchView } from "./status";

const d = (status: DispatchStatus, audienceCount: number | null): DispatchView => ({
  id: `${status}-${audienceCount}`,
  campaignId: "c1",
  campaignName: "Referral Outreach",
  assetId: null,
  deliverable: "Email",
  channel: "email",
  status,
  scheduledFor: null,
  dispatchedAt: null,
  recipientSummary: null,
  audienceCount,
  resultNote: null,
  updatedAt: "2026-07-16T00:00:00Z",
  preview: null,
});

/** Exactly what prod held when this bug was found. */
const PROD: DispatchView[] = [
  d("queued", 2_412),
  d("queued", 8_740), // queued: 2 dispatches, 11,152 recipients
  d("scheduled", 11_200),
  d("scheduled", 430), // scheduled: 2 dispatches
  d("sent", 1_180), // sent+delivered: 2 dispatches, 4,384 recipients
  d("delivered", 3_204),
  d("failed", 96),
];

const tile = (rows: DispatchView[], label: string) => buildOutboxKpis(rows).find((k) => k.label === label)!;

describe("buildOutboxKpis", () => {
  it("counts dispatches, not people, in every tile's value", () => {
    // The bug: "Sent" showed 4,384 — the recipient sum — while its sub read
    // "recorded dispatches". Two dispatches went out, to 4,384 people.
    expect(tile(PROD, "Sent").value).toBe("2");
    expect(tile(PROD, WORK_STATE_LABEL.needs_you).value).toBe("2");
    expect(tile(PROD, "Scheduled").value).toBe("2");
    expect(tile(PROD, "Failed").value).toBe("1");
  });

  it("puts the reach in the sub, where it is labelled", () => {
    expect(tile(PROD, "Sent").sub).toBe("1 confirmed delivered · 4,384 recipients");
    expect(tile(PROD, WORK_STATE_LABEL.needs_you).sub).toBe("11,152 recipients");
  });

  it("never labels a value with a unit it isn't using", () => {
    // The literal string that made prod read "4,384 / recorded dispatches".
    for (const k of buildOutboxKpis(PROD)) {
      expect(k.sub, k.label).not.toBe("recorded dispatches");
    }
  });

  it("counts a delivered dispatch as sent — it did leave", () => {
    expect(tile([d("sent", 10), d("delivered", 5)], "Sent").value).toBe("2");
    expect(tile([d("sent", 10), d("delivered", 5)], "Sent").sub).toBe("1 confirmed delivered · 15 recipients");
  });

  it("says nothing sent yet rather than '0 recipients'", () => {
    expect(tile([d("queued", 5)], "Sent").sub).toBe("nothing sent yet");
    expect(tile([], WORK_STATE_LABEL.needs_you).sub).toBe("in the send queue");
    expect(tile([], "Scheduled").sub).toBe("none scheduled");
  });

  it("alerts only where a human decision is outstanding, and on failures", () => {
    // An alerting tile is a claim on the operator's attention; "Sent" has none.
    const kpis = buildOutboxKpis(PROD);
    expect(kpis.filter((k) => k.alert).map((k) => k.label)).toEqual([WORK_STATE_LABEL.needs_you, "Failed"]);
    // No failures, no tile: a "0 failed" tile is a claim on attention that has
    // earned nothing.
    expect(buildOutboxKpis([d("delivered", 1)]).map((k) => k.label)).not.toContain("Failed");
  });

  it("treats a missing audience count as zero reach, not NaN", () => {
    expect(tile([d("sent", null)], "Sent").value).toBe("1");
    // It DID go out; we just have no audience count for it.
    expect(tile([d("sent", null)], "Sent").sub).toBe("reach not recorded");
  });

  it("is empty-safe", () => {
    // Three tiles, not four: no failures means no Failed tile.
    expect(buildOutboxKpis([]).map((k) => k.value)).toEqual(["0", "0", "0"]);
    expect(buildOutboxKpis([]).some((k) => k.alert)).toBe(false);
  });
});
