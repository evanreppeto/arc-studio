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
  { action: "updateBrandPalette", claims: /palette|colou?rs?\b/i, label: "palette editing" },
  { action: "updateBrandTypography", claims: /typography|font|typeface/i, label: "typeface selection" },
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
   * The other half of honesty. Palette and typography both used to be asserted
   * here as *correctly* marked coming-soon; both moved to SHIPPED_CAPABILITIES
   * as their write paths landed. The claim is about the write path, so when one
   * appears the assertion flips rather than being deleted.
   *
   * Nothing on /brand is unbuilt now, so this asserts the page carries no
   * coming-soon marks at all. Add one back only alongside a genuine gap — and
   * put it in SHIPPED_CAPABILITIES the moment it stops being a gap.
   */
  it("carries no coming-soon marks, because nothing on the page is unbuilt", () => {
    expect(comingSoonMessages(BRAND_VIEW)).toEqual([]);
  });

  /**
   * Typeface selection is only honest because the renderer can draw every font
   * the picker offers. `loadCreativeFonts` used to pick between exactly two
   * files via a serif/sans guess on the name, which meant every workspace's
   * creative rendered as Inter or one serif whatever their brand kit said.
   *
   * The catalog is now the shared source of truth for both sides, and
   * brand-fonts.test.ts checks the static files are actually on disk. This
   * guards the wiring: the renderer must resolve through the catalog, never
   * back to a two-file guess.
   */
  it("renders creative through the font catalog, not a serif/sans guess", () => {
    const loader = readFileSync(new URL("../../../../lib/media/compose/fonts.ts", import.meta.url), "utf8");
    expect(loader).toMatch(/resolveBrandFont/);
    expect(loader, "the renderer fell back to the old two-file heuristic").not.toMatch(/resolveFontRole/);
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
