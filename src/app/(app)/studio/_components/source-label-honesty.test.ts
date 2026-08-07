import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { assetSourceLabel } from "@/domain/vocabulary";

const VIEW = readFileSync(new URL("./studio-view.tsx", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

/**
 * Studio's library source was titled "Approved media" and is not one.
 *
 * The query behind it filters on kind and a present url — nothing else. On the
 * live workspace that panel offered 16 assets under the word "Approved" while
 * /library graded the same 16 as **Arc-ready 0**: 13 carrying a risk flag and 3
 * never reviewed. Approval is the load-bearing idea in this product — the whole
 * outbound posture rests on it — and a panel must not assert it on the strength
 * of a url being non-null.
 *
 * The fix is deliberately the LABEL and not the filter. `isArc` means "Arc may
 * use this on its own", which is a different question from "the operator may
 * compose with it"; Studio is operator-driven, so the full library belongs
 * there. Filtering to Arc-ready would have emptied the panel on the live
 * workspace — a worse answer to a labelling problem.
 */
describe("the Studio source panel does not claim approval it never checked", () => {
  it("no longer titles the library source 'Approved media'", () => {
    const claims = VIEW.split("\n").filter(
      (l) => l.includes('title: "Approved media"') && !l.trim().startsWith("//"),
    );
    expect(claims).toEqual([]);
  });

  it("uses the vocabulary's own word for this source", () => {
    // `library: "From your library"` already existed in ASSET_SOURCE_LABEL —
    // the term was there, the panel just wasn't using it.
    expect(VIEW).toContain('title: "From your library"');
  });

  it("still shows the whole library, not an approval-filtered subset", () => {
    // The panel must keep offering everything: the operator composing by hand is
    // entitled to their own media regardless of what Arc may use unattended.
    expect(PAGE).toContain('.filter((a) => (a.kind === "image" || a.kind === "video") && a.url && a.url !== "pending")');
    expect(PAGE).not.toMatch(/isArcReady|arc_ready|approved_at/);
  });

  it("leaves the campaign provenance label alone", () => {
    // "Approved media" is a legitimate SOURCE value on a campaign asset — that
    // one records where a deliverable came from, and is a different claim.
    expect(assetSourceLabel("approved_media")).toBe("Approved media");
    expect(assetSourceLabel("library")).toBe("From your library");
  });
});
