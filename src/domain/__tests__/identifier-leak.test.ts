import { describe, expect, it } from "vitest";

import { findIdentifierLeak, stripIdentifiers } from "../identifier-leak";

/**
 * BSR-709. The cases below are not invented — the "catches" are the exact
 * strings that reached customers in BSR-655, the pipeline-stage leak, and
 * BSR-693, and the "ignores" are real UI copy from the same screens.
 *
 * The false-positive half matters more than the true-positive half. A check that
 * fires on correct code gets muted, and then it is worth less than nothing
 * because it looks like coverage.
 */

const leak = (text: string) => findIdentifierLeak(text)?.match ?? null;

describe("catches what actually shipped", () => {
  it("BSR-655: database identifiers in a badge", () => {
    expect(leak("wired · media_assets")).toBe("media_assets");
    expect(leak("wired · tone · voice_guidance")).toBe("voice_guidance");
  });

  it("the pipeline-stage and custom-field keys", () => {
    expect(leak("needs_review")).toBe("needs_review");
    expect(leak("needs_review · 2 records")).toBe("needs_review");
    expect(leak("proof_point")).toBe("proof_point");
  });

  it("BSR-693: run-page recall kinds and tool names", () => {
    expect(leak("crm_lead")).toBe("crm_lead");
    expect(leak("campaign_ref")).toBe("campaign_ref");
    expect(leak("mcp__arc__search_contacts")).toBe("mcp__arc__search_contacts");
  });

  it("reports which shape matched, so the warning can say why", () => {
    expect(findIdentifierLeak("mcp__arc__emit_card")?.shape).toBe("MCP tool name");
    expect(findIdentifierLeak("crm_lead")?.shape).toBe("snake_case");
    // Not an env var — those are allowlisted below, because naming the variable
    // is the instruction. A stray code constant is not.
    expect(findIdentifierLeak("DEFAULT_PIPELINE_STAGES")?.shape).toBe("CONSTANT_CASE");
  });
});

describe("ignores real copy from the same screens", () => {
  it.each([
    "Needs review",
    "No records",
    "Something Arc learned",
    "Rename these to match how your team actually works.",
    "Arc keeps leads up to date, and keeps their lead scores current",
    "142 accounts hit pricing repeatedly and still haven't booked a demo.",
    "Counts as won",
    "image",
    "Finished",
    "Answering a question · Standard model",
  ])("leaves %j alone", (text) => {
    expect(leak(text)).toBeNull();
  });

  it("does not flag an email address or a URL", () => {
    // Real demo data: these are full of dots and underscores and are not ours.
    expect(leak("daniel.harper@larkfield_partners.example")).toBeNull();
    expect(leak("https://cdn.example.com/driveway_photo.png")).toBeNull();
  });

  it("does not flag an env var the operator is being told to set", () => {
    // The health screen names the variable on purpose — that IS the instruction.
    expect(leak("SUPABASE_SERVICE_ROLE_KEY is not set")).toBeNull();
    expect(leak("Set ARC_AGENT_API_TOKEN to enable the agent")).toBeNull();
  });

  it("does not flag a filename in a developer-facing string", () => {
    expect(leak("see src/domain/vocabulary.ts")).toBeNull();
  });

  /**
   * Found by running the check against the app rather than by reasoning about
   * it: the Library lists uploads by their original filename, and customers name
   * files in snake_case. Their naming is data we display, not vocabulary we
   * chose — warning here would send someone to "fix" a customer's file.
   */
  it("does not flag a customer's uploaded filename", () => {
    expect(leak("midjourney_grid_03.png")).toBeNull();
    expect(leak("canva_export_banner.png")).toBeNull();
    expect(leak("Q3_field_photos.zip")).toBeNull();
    expect(leak("site_walkthrough.mp4")).toBeNull();
  });

  it("is quiet on empty and whitespace nodes", () => {
    expect(leak("")).toBeNull();
    expect(leak("   \n  ")).toBeNull();
  });
});

describe("shape boundaries", () => {
  it("needs two segments — a single lowercase word is just a word", () => {
    expect(leak("qualified")).toBeNull();
    expect(leak("converted")).toBeNull();
  });

  it("does not treat a hyphenated phrase as an identifier", () => {
    // Real copy: "org-scoped" was banned as vocabulary, but hyphens are how
    // English compounds, so the shape check must not claim them.
    expect(leak("high-intent accounts")).toBeNull();
    expect(leak("pricing-page surge")).toBeNull();
  });

  it("finds an identifier embedded mid-sentence", () => {
    expect(leak("Records still in needs_review will move")).toBe("needs_review");
  });
});

/**
 * BSR-732. A live audit found primary keys on the front page — the Home hero
 * card cited two campaigns by UUID, and the Opportunities evidence panel
 * answered "Active flood advisories" with two bare UUIDs.
 *
 * None of the shapes above could see them: a UUID is neither snake_case nor
 * CONSTANT_CASE, so this check passed on every one of those screens while the
 * ids shipped.
 */
describe("primary keys", () => {
  const UUID = "0bd41cb3-ff30-4548-92e6-4ba431b61c8d";

  it("catches a uuid alone and mid-sentence", () => {
    expect(leak(UUID)).toBe(UUID);
    expect(leak(`"Suburban Home Background Asset" (campaign ${UUID})`)).toBe(UUID);
  });

  it("does not claim ordinary hyphenated or hex-ish copy", () => {
    // The false-positive half again: these must all read as language.
    expect(leak("high-intent accounts")).toBeNull();
    expect(leak("Cook, DuPage, Will — IL")).toBeNull();
    expect(leak("2026-08-04")).toBeNull();
    expect(leak("60613-1204")).toBeNull();
    expect(leak("#c8a24a")).toBeNull();
  });
});

describe("stripIdentifiers", () => {
  it("removes the parenthetical citation Arc writes, and nothing else", () => {
    const summary =
      'Arc generated two reusable homeowner-facing background creatives on Jul 31 that are still sitting in draft, unused: ' +
      '"Suburban Home Background Asset" (campaign 0bd41cb3-ff30-4548-92e6-4ba431b61c8d) and ' +
      '"Service Van — Driveway Morning" (campaign 02a05c97-5f0d-4ab7-8440-8d1c213fa847), both tagged persona emergency-homeowner.';

    expect(stripIdentifiers(summary)).toBe(
      'Arc generated two reusable homeowner-facing background creatives on Jul 31 that are still sitting in draft, unused: ' +
        '"Suburban Home Background Asset" and "Service Van — Driveway Morning", both tagged persona emergency-homeowner.',
    );
  });

  it("removes a loose id and tidies the seam", () => {
    expect(stripIdentifiers("See 0bd41cb3-ff30-4548-92e6-4ba431b61c8d for details.")).toBe("See for details.");
  });

  it("leaves prose with no identifiers untouched", () => {
    const clean = "Flood Advisory in effect for Cook, IL / Will, IL. Damage-response demand typically spikes within days.";
    expect(stripIdentifiers(clean)).toBe(clean);
  });

  it("leaves nothing a leak check would still flag", () => {
    const out = stripIdentifiers("Asset (campaign 0bd41cb3-ff30-4548-92e6-4ba431b61c8d) is ready.");
    expect(findIdentifierLeak(out)).toBeNull();
  });
});
