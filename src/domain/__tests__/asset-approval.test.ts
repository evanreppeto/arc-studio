import { describe, expect, it } from "vitest";

import { buildDecisionNote, checkAssetApproval, isAssetApproved } from "../asset-approval";

const FLAG = "Provenance unverified — origin not recorded";

describe("checkAssetApproval", () => {
  it("allows approving a clean asset with no acknowledgement", () => {
    const v = checkAssetApproval({ decision: "approved", riskFlags: [] });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.requiresAcknowledgement).toBe(false);
  });

  // The rule this ticket exists for: risk flags are there so a reviewer weighs
  // something specific. If approval sails past them they are decoration.
  it("refuses to approve a flagged asset without an acknowledgement", () => {
    const v = checkAssetApproval({ decision: "approved", riskFlags: [FLAG] });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toBe("acknowledgement_required");
      expect(v.message).toContain(FLAG);
    }
  });

  it("allows approving a flagged asset once acknowledged", () => {
    const v = checkAssetApproval({
      decision: "approved",
      riskFlags: [FLAG],
      acknowledgement: "Confirmed with the crew this is our own site photo.",
    });
    expect(v.allowed).toBe(true);
    if (v.allowed) expect(v.requiresAcknowledgement).toBe(true);
  });

  it("does not accept a click-through as an acknowledgement", () => {
    expect(checkAssetApproval({ decision: "approved", riskFlags: [FLAG], acknowledgement: "  " }).allowed).toBe(false);
    expect(checkAssetApproval({ decision: "approved", riskFlags: [FLAG], acknowledgement: "ok" }).allowed).toBe(false);
  });

  // Gating the decline path would be backwards — it would make approving the
  // path of least resistance, the exact opposite of what a risk flag is for.
  it("never gates declining, revising, or archiving", () => {
    for (const decision of ["declined", "needs_revision", "archived"] as const) {
      expect(checkAssetApproval({ decision, riskFlags: [FLAG, "another"] }).allowed).toBe(true);
    }
  });

  it("ignores blank flags rather than gating on whitespace", () => {
    expect(checkAssetApproval({ decision: "approved", riskFlags: ["", "   "] }).allowed).toBe(true);
  });

  it("counts multiple flags in the refusal message", () => {
    const v = checkAssetApproval({ decision: "approved", riskFlags: [FLAG, "Embedded text"] });
    if (!v.allowed) expect(v.message).toContain("2 risk flags");
  });
});

describe("buildDecisionNote", () => {
  // The audit trail must answer "what did they know when they approved it?",
  // not merely "they approved it".
  it("records the flags alongside the acknowledgement on approval", () => {
    const note = buildDecisionNote(
      { decision: "approved", riskFlags: [FLAG], acknowledgement: "Verified with the crew." },
      "Looks good",
    );
    expect(note).toContain("Looks good");
    expect(note).toContain(`Acknowledged: ${FLAG}`);
    expect(note).toContain("Verified with the crew.");
  });

  it("returns just the note when nothing was flagged", () => {
    expect(buildDecisionNote({ decision: "approved", riskFlags: [] }, "Fine")).toBe("Fine");
    expect(buildDecisionNote({ decision: "declined", riskFlags: [FLAG] }, "")).toBeNull();
  });
});

describe("isAssetApproved", () => {
  it("treats only an explicit approval as approved", () => {
    expect(isAssetApproved("approved")).toBe(true);
    for (const s of ["draft", "pending_approval", "declined", "needs_revision", null, undefined]) {
      expect(isAssetApproved(s)).toBe(false);
    }
  });
});
