import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The campaign preview can now record a decision on one image. That makes it a
 * write surface, and this file pins the four things that must stay true about
 * it — each of which this codebase has gotten wrong before, on this exact table:
 *
 *  1. It goes through the ONE asset-approval path. A second, softer route to
 *     "approved" for media is how the campaigns side ended up with a duplicate
 *     `decideApprovalItem` that silently wrote nothing for months.
 *  2. It is operator-gated and org-scoped. A storage path is guessable; the id
 *     it resolves to becomes the subject of an approval record.
 *  3. It never unlocks outbound. Approving creative readies it for a
 *     human-gated step and sends nothing.
 *  4. It refuses honestly when the picture has no Library row, rather than
 *     reporting a decision nothing recorded — the "looks wired, does nothing"
 *     failure this app keeps relapsing into.
 */
const ROOT = join(process.cwd(), "src");
const actions = readFileSync(join(ROOT, "app/(app)/campaigns/[campaignId]/actions.ts"), "utf8");
const view = readFileSync(
  join(ROOT, "app/(app)/campaigns/[campaignId]/_components/campaign-detail-view.tsx"),
  "utf8",
);

/** The action's body, so a match can't come from an unrelated neighbour. */
const action = actions.slice(actions.indexOf("export async function decideCampaignMediaAction"));

describe("campaign media decision — safety", () => {
  it("exists and writes through the one asset-approval path", () => {
    expect(action).toContain("decideAssetApproval(");
    // Not a hand-rolled insert alongside it.
    expect(action).not.toMatch(/from\("approval_items"\)/);
    expect(action).not.toMatch(/from\("approval_decisions"\)/);
  });

  it("is operator-gated and scoped to BOTH org and workspace", () => {
    expect(action).toContain("await requireOperator()");
    expect(action).toMatch(/getCurrentWorkspaceContext\(\)/);
    // Refuses rather than falling back to org-wide or to a default tenant. The
    // workspace half matters as much as the org half: `media_assets` is
    // workspace-owned and the service role bypasses RLS, so the app-layer filter
    // is the whole boundary — see src/lib/db/workspace-readers.test.ts, which
    // caught this action's resolver reading org-only on the first attempt.
    expect(action).toMatch(/if \(!ctx\.orgId \|\| !ctx\.workspaceId\) return \{ ok: false/);
    expect(action).toMatch(/ctx\.orgId,\s*\n\s*ctx\.workspaceId,/);
  });

  it("validates the decision instead of trusting the caller", () => {
    // A server action's argument is an untrusted input like any request body.
    expect(action).toMatch(/if \(!ASSET_DECISIONS\.has\(input\.decision\)\)/);
  });

  it("never unlocks outbound", () => {
    for (const forbidden of ["dispatch_locked", "launch_locked", "launchCampaign", "enqueueDispatch"]) {
      expect(action, `${forbidden} must not appear in a media decision`).not.toContain(forbidden);
    }
  });

  it("refuses when the image has no Library row rather than reporting a decision", () => {
    expect(action).toMatch(/if \(!resolved\.ok\) return \{ ok: false, error: MEDIA_RESOLVE_MESSAGE/);
    // And the refusal is reached BEFORE anything is written.
    expect(action.indexOf("if (!resolved.ok)")).toBeLessThan(action.indexOf("decideAssetApproval("));
  });

  it("resolves the image through the same rule the read-model displayed it by", () => {
    // Two different rules would let an operator approve one picture and watch a
    // different one change state.
    expect(action).toContain("resolveMediaAssetId(");
  });
});

describe("campaign media decision — UI honesty", () => {
  it("only reflects a new state after the server confirms it", () => {
    const decide = view.slice(view.indexOf("const decideMedia = useCallback"));
    // The failure path returns the error and applies nothing.
    expect(decide).toMatch(/if \(!res\.ok\) return res\.error;/);
    // And the state applied comes from the response, not from the request — an
    // optimistic pill would say "Approved" while the gate was refusing it.
    expect(decide).toMatch(/mediaReviewStateFromStatus\(res\.status\)/);
    expect(decide.indexOf("if (!res.ok)")).toBeLessThan(decide.indexOf("setLightbox("));
  });

  it("keeps the tiles and the dialog in step", () => {
    const decide = view.slice(view.indexOf("const decideMedia = useCallback"));
    // Updating only one leaves a picture reading "Approved" in the dialog and
    // "Not reviewed" on the tile behind it.
    expect(decide).toContain("setLightbox(");
    expect(decide).toContain("setAssets(");
  });
});
