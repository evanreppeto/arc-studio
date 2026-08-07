import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const QUICK = readFileSync(new URL("./quick-actions.tsx", import.meta.url), "utf8");
const CAMPAIGNS_PAGE = readFileSync(new URL("../../campaigns/page.tsx", import.meta.url), "utf8");
const CAMPAIGNS_BOARD = readFileSync(new URL("../../campaigns/_components/campaigns-board.tsx", import.meta.url), "utf8");
const CRM_PAGE = readFileSync(new URL("../../crm/page.tsx", import.meta.url), "utf8");
const CRM_BOARD = readFileSync(new URL("../../crm/_components/crm-board.tsx", import.meta.url), "utf8");

/**
 * "Quick actions" that only navigated NEAR the action.
 *
 * "New campaign" pointed at `/campaigns` and stopped, so you still had to find
 * and press the real button; "Add a lead" pointed at `/crm`, which lands on
 * Contacts — the wrong tab, and nothing open. Two of the three were signposts
 * wearing the name of the thing they pointed at.
 *
 * Each half is asserted at both ends, because a link is only as good as the
 * destination's willingness to honour it: a correct href into a page that
 * ignores the parameter is the same dead action with a longer URL.
 */
describe("each quick action performs its action", () => {
  it("opens the New-campaign modal rather than the board", () => {
    expect(QUICK).toContain('href: "/campaigns?new=1"');
  });

  it("lands on Leads with the Add modal open", () => {
    // Both halves matter: `add=1` alone would open Contacts' add form.
    expect(QUICK).toContain('href: "/crm?o=leads&add=1"');
  });

  it("leaves Ask Arc alone — /arc IS the destination", () => {
    expect(QUICK).toContain('href: "/arc"');
  });
});

describe("the destinations honour what the links ask for", () => {
  it("campaigns reads ?new and seeds the modal open", () => {
    expect(CAMPAIGNS_PAGE).toMatch(/searchParams: Promise<\{ new\?: string \}>/);
    expect(CAMPAIGNS_PAGE).toContain('openNew={openNewParam === "1"}');
    expect(CAMPAIGNS_BOARD).toContain("const [newOpen, setNewOpen] = useState(openNew);");
  });

  it("crm reads ?o and ?add, and seeds both", () => {
    expect(CRM_PAGE).toMatch(/searchParams: Promise<\{ o\?: string; add\?: string \}>/);
    expect(CRM_PAGE).toContain('openAdd={openAddParam === "1"}');
    expect(CRM_PAGE).toContain("defaultKey={defaultKey}");
    expect(CRM_BOARD).toContain("const [addOpen, setAddOpen] = useState(openAdd);");
  });

  it("refuses an object key this workspace does not have", () => {
    // A bad `?o=` must not land on a blank board. Validated against the objects
    // actually built for this workspace, so a tenant-defined type is as valid a
    // target as the built-in six.
    expect(CRM_PAGE).toContain('objects.some((o) => o.key === requestedObject) ? (requestedObject as string) : "contacts"');
  });

  it("clears the marker on close so a reload does not reopen it", () => {
    // replaceState, not push — dismissing a modal is not a step to go back to.
    for (const src of [CAMPAIGNS_BOARD, CRM_BOARD]) {
      expect(src).toContain("window.history.replaceState");
      expect(src).toMatch(/params\.delete\("(new|add)"\)/);
    }
  });

  it("routes every add-modal close through the clearing handler", () => {
    // The CRM board mounts two of them (built-in objects and tenant-defined
    // ones); one left on the bare setter would strip the marker for some
    // objects and not others.
    expect(CRM_BOARD).not.toMatch(/onClose=\{\(\) => setAddOpen\(false\)\}/);
    expect([...CRM_BOARD.matchAll(/onClose=\{closeAdd\}/g)].length).toBe(2);
  });
});
