import { describe, expect, it } from "vitest";

import { buildLaunchState, type CampaignWorkspaceAsset } from "./read-model";

/**
 * Two counts, two questions, and they are not the same question.
 *
 *   pendingCount          — is this piece resolved? gates Ready and Launch.
 *   awaitingOperatorCount — is this piece waiting on YOU? drives every
 *                           "needs you" surface, and the rail badge's rule.
 *
 * They were one number. A deliverable sent back for revision is unresolved but
 * is Arc's to rework, so counting it in both told the operator that 19 assets
 * needed them while the rail — which has used the narrower rule since the
 * approvals desk was built — said 15. On the live workspace the gap was exactly
 * the four `revision_requested` deliverables.
 *
 * The dangerous half of this fix is the other direction: if `revision_requested`
 * had simply been made "decided", a campaign with nothing but sent-back pieces
 * would have gone Ready, lit its Launch button, and been refused by the server
 * ("Approve every piece before launching"). These tests pin both directions.
 */
const asset = (status: string, id = status): CampaignWorkspaceAsset =>
  ({ id, status, approval: null, dispatchLocked: true }) as unknown as CampaignWorkspaceAsset;

const withApproval = (status: string, id = status): CampaignWorkspaceAsset =>
  ({ id, status: "draft", approval: { status }, dispatchLocked: true }) as unknown as CampaignWorkspaceAsset;

describe("the operator's queue excludes what Arc is reworking", () => {
  it("counts a sent-back deliverable as unresolved but not as waiting on you", () => {
    const state = buildLaunchState([withApproval("revision_requested")], true);
    expect(state.pendingCount).toBe(1);
    expect(state.awaitingOperatorCount).toBe(0);
  });

  it("still counts the ones genuinely waiting on a decision", () => {
    const state = buildLaunchState(
      [withApproval("pending_approval", "a"), withApproval("needs_compliance", "b")],
      true,
    );
    expect(state.awaitingOperatorCount).toBe(2);
  });

  it("reproduces the live workspace's split", () => {
    // 14 pending_approval + 4 revision_requested, as measured on production.
    const assets = [
      ...Array.from({ length: 14 }, (_, i) => withApproval("pending_approval", `p${i}`)),
      ...Array.from({ length: 4 }, (_, i) => withApproval("revision_requested", `r${i}`)),
    ];
    const state = buildLaunchState(assets, true);
    expect(state.pendingCount).toBe(18);
    expect(state.awaitingOperatorCount).toBe(14);
  });

  it("keeps `blocked` on the operator's desk", () => {
    // Unlike a revision request, a blocked piece needs a person to clear it.
    expect(buildLaunchState([withApproval("blocked")], true).awaitingOperatorCount).toBe(1);
  });
});

describe("launch readiness is unmoved by the narrower count", () => {
  it("does not go Ready while a deliverable is out for revision", () => {
    // The failure this guards: had `revision_requested` been folded into
    // "decided", Ready and the Launch button would light up on a campaign the
    // server then refuses to launch.
    const state = buildLaunchState([withApproval("approved", "ok"), withApproval("revision_requested", "rr")], true);
    expect(state.awaitingOperatorCount).toBe(0);
    expect(state.pendingCount).toBe(1);
    expect(state.ready).toBe(false);
    expect(state.lifecycle).toBe("In review");
  });

  it("goes Ready once everything really is decided", () => {
    const state = buildLaunchState([withApproval("approved", "a"), withApproval("declined", "b")], true);
    expect(state.pendingCount).toBe(0);
    expect(state.ready).toBe(true);
    expect(state.lifecycle).toBe("Ready");
  });

  it("ignores archived pieces in both counts", () => {
    const state = buildLaunchState([asset("archived"), withApproval("pending_approval", "p")], true);
    expect(state.requiredCount).toBe(1);
    expect(state.pendingCount).toBe(1);
    expect(state.awaitingOperatorCount).toBe(1);
  });
});
