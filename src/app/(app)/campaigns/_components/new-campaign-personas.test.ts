import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MODAL = readFileSync(new URL("./new-campaign-modal.tsx", import.meta.url), "utf8");
const ACTIONS = readFileSync(new URL("../actions.ts", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

/**
 * `createCampaign` validates the persona against THIS workspace's keys
 * (`getOrgPersonaKeys`). So the only personas the picker may offer are the ones
 * the page resolved for this workspace.
 *
 * The modal used to fall back to `DEFAULT_PERSONAS` when the list came back
 * empty, which undid a distinction the page had already drawn correctly: the
 * page passes `[]` for a live workspace whose persona read came back empty, and
 * the fallback filled that with keys from another taxonomy. Every one failed
 * `isAllowedPersona`, so the operator picked a persona and got back "Choose a
 * persona for this campaign." — a list where every choice was wrong, beneath a
 * message saying they hadn't chosen.
 */
describe("the persona picker offers only personas the server will accept", () => {
  it("does not substitute a starter taxonomy for an empty list", () => {
    // Code lines only — the comment explaining the removal names the constant
    // it removed, and matching that would fail for the wrong reason.
    const code = MODAL.split("\n").filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    });
    expect(code.filter((l) => l.includes("DEFAULT_PERSONAS"))).toEqual([]);
    expect(MODAL).toContain("const personaChoices = personaOptions ?? [];");
  });

  it("cannot submit when there is nothing valid to pick", () => {
    // Better a disabled button than one that fails on every choice.
    expect(MODAL).toContain("const noPersonas = personaChoices.length === 0;");
    expect(MODAL).toMatch(/canSubmit = !noPersonas &&/);
    expect(MODAL).toMatch(/disabled=\{noPersonas\}/);
  });

  it("says what to do instead of failing silently", () => {
    expect(MODAL).toMatch(/This workspace has no personas yet/);
    expect(MODAL).toMatch(/href="\/personas"/);
  });
});

describe("the server distinguishes the two ways a persona can be wrong", () => {
  it("no longer answers both with the same sentence", () => {
    // "Choose a persona" is right when nothing was picked. It is wrong — and
    // reads as the app ignoring you — when you picked one this workspace lacks.
    const picked = ACTIONS.match(/if \(!isAllowedPersona[\s\S]{0,220}?\}/)?.[0] ?? "";
    expect(picked).not.toContain("Choose a persona for this campaign.");
    expect(picked).toMatch(/isn't in this workspace/);
  });

  it("names the empty-workspace case separately", () => {
    expect(ACTIONS).toMatch(/allowedKeys\.length === 0/);
    expect(ACTIONS).toMatch(/has no personas yet/);
  });

  it("still rejects a blank persona before it reaches the workspace check", () => {
    // The cheap guard stays first: no round-trip to tell someone they left a
    // required field empty.
    const blankIdx = ACTIONS.indexOf('if (!persona) return { ok: false, error: "Choose a persona for this campaign." };');
    const allowedIdx = ACTIONS.indexOf("allowedKeys.length === 0");
    expect(blankIdx).toBeGreaterThan(-1);
    expect(blankIdx).toBeLessThan(allowedIdx);
  });
});

describe("an unreadable persona list is not reported as an empty one", () => {
  it("reports the failed read instead of swallowing it", () => {
    // Empty now BLOCKS creation rather than just emptying a dropdown, so the
    // difference between "none exist" and "we couldn't read them" is the
    // difference between "go add one" and "reload".
    expect(PAGE).toMatch(/getOrgPersonaOptions\(ctx\.orgId\)\.catch\(\(error\) => \{/);
    expect(PAGE).toContain('scope: "campaigns.getOrgPersonaOptions"');
    expect(PAGE).not.toMatch(/getOrgPersonaOptions\(ctx\.orgId\)\.catch\(\(\) => \[\]\)/);
  });
});
