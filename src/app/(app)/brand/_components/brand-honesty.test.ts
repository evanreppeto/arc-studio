import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const BRAND_VIEW = readFileSync(new URL("./brand-view.tsx", import.meta.url), "utf8");
const BRAND_ACTIONS = readFileSync(new URL("../actions.ts", import.meta.url), "utf8");

/** Every `data-soon="..."` message left in the view. */
function comingSoonMessages(source: string): string[] {
  return [...source.matchAll(/data-soon=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? "");
}

/**
 * The capability each shipped action delivers, as words a "coming soon" label
 * would use for the same thing.
 *
 * This is the guard for the bug, not for the wording. `/brand` shipped with
 * "Logo & images — Coming soon" and "Brand notes are coming soon" on cards whose
 * capabilities were already wired: `saveBrandLogo` was imported AND called by the
 * header's Add logo button ~400px above the dead drop zone, and
 * `updateBrandIdentity` (name, tagline, website, voice guidance) was called by
 * Edit identity. An operator reading those cards concluded Arc could not use
 * their logo or learn their voice. It could.
 *
 * So: if the action exists and the view calls it, the view may not also tell the
 * operator that the same capability is unavailable.
 */
const SHIPPED_CAPABILITIES: Array<{ action: string; claims: RegExp; label: string }> = [
  { action: "saveBrandLogo", claims: /logo|image/i, label: "logo upload" },
  { action: "updateBrandIdentity", claims: /note|voice|tone|identity|tagline|field/i, label: "brand identity & voice editing" },
  { action: "uploadBrandDocuments", claims: /document|\bfiles?\b/i, label: "document upload" },
  { action: "analyzeBrandWebsite", claims: /website|url/i, label: "website analysis" },
];

describe("brand page tells the truth about what it can do", () => {
  it.each(SHIPPED_CAPABILITIES)(
    "does not mark $label coming soon while $action is wired",
    ({ action, claims, label }) => {
      // Guard the premise: if the action is gone or no longer called, this test
      // is asserting nothing and should be revisited rather than passing quietly.
      expect(BRAND_ACTIONS, `${action} should still exist in brand/actions.ts`).toContain(`export async function ${action}`);
      expect(BRAND_VIEW, `${action} should still be called by the view`).toMatch(new RegExp(`${action}\\s*\\(`));

      const offenders = comingSoonMessages(BRAND_VIEW).filter((message) => claims.test(message));
      expect(
        offenders,
        `${label} is wired via ${action}, so the view must not advertise it as coming soon. Found: ${offenders.join(" | ")}`,
      ).toEqual([]);
    },
  );

  /**
   * The other half of honesty: what IS still unbuilt must keep saying so. There
   * is no palette or typography editor — `upsertBusinessProfile` writes those
   * columns, but nothing in the UI or actions layer sets them — so those two
   * labels are correct and must not be removed just to make the page look
   * finished.
   */
  it("keeps the coming-soon marker on palette and typography, which have no write path", () => {
    const messages = comingSoonMessages(BRAND_VIEW);
    expect(messages.some((m) => /palette/i.test(m))).toBe(true);
    expect(messages.some((m) => /typography/i.test(m))).toBe(true);
    expect(BRAND_ACTIONS).not.toMatch(/export async function (updateBrandPalette|updateBrandTypography)/);
  });

  it("routes every logo entry point through the one write path", () => {
    // Three ways in — the header button, the card's browse button, and dropping a
    // file on the card — and all of them must reach `saveBrandLogo`. The picker
    // paths share `onLogoPicked`; the drop path is its own handler. A fourth
    // uploader that wrote the logo somewhere else is the thing to prevent.
    expect(BRAND_VIEW).toContain('onLogoPicked(e.target.files?.[0] ?? null, e, "header")');
    expect(BRAND_VIEW).toContain('onLogoPicked(e.target.files?.[0] ?? null, e, "card")');
    expect(BRAND_VIEW).toContain("onDrop={onLogoDropped}");
    // Exactly two: the shared picker handler, and the drop handler.
    expect([...BRAND_VIEW.matchAll(/saveBrandLogo\(formData\)/g)]).toHaveLength(2);
  });
});
