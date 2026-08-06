import { describe, expect, it } from "vitest";

import { ImageEditUnsupportedError } from "../types";

/**
 * Editing an image is a different act from generating one, and the difference is
 * the reason this exists.
 *
 * `MediaProvider` could only `generateImage`. So when an operator asked to put
 * their logo on the van door, the app had nothing to call — and answered with a
 * principle ("your logo goes on top of the picture, not into it") that was really
 * a missing capability wearing a rule's clothes.
 *
 * The genuine constraint is narrower and survives: NO_TEXT_DIRECTIVE stops the
 * model INVENTING a brand mark when generating a scene from nothing, because what
 * it invents is a garbled counterfeit. An edit points at a picture that exists and
 * says what to change — so the directive is deliberately NOT applied there, or the
 * request would be stripped and the same image handed back.
 */
describe("image editing capability", () => {
  it("names the model and the reason when it cannot edit", () => {
    // Imagen has no edit endpoint. "Failed" would send someone hunting a bug;
    // this sends them to the setting that fixes it.
    const err = new ImageEditUnsupportedError("imagen-4.0-generate-001");
    expect(err.message).toContain("imagen-4.0-generate-001");
    expect(err.message).toMatch(/Settings/);
    expect(err.name).toBe("ImageEditUnsupportedError");
  });

  it("is its own type, so a caller can tell it from a call that failed", () => {
    // A capability gap is actionable; a network error is not the same thing and
    // must not be reported as one.
    expect(new ImageEditUnsupportedError("m")).toBeInstanceOf(Error);
    expect(new ImageEditUnsupportedError("m")).toBeInstanceOf(ImageEditUnsupportedError);
  });
});

/**
 * Source assertions on the wiring. The provider call itself needs a live Gemini
 * key, so what is checkable here is that the edit path exists, is reachable, and
 * does NOT harden the instruction — the one mistake that would make this feature
 * silently do nothing.
 */
describe("edit wiring", () => {
  const gemini = readSource("src/lib/media/gemini.ts");
  const action = readSource("src/app/(app)/studio/actions.ts");
  const view = readSource("src/app/(app)/studio/_components/studio-view.tsx");

  it("sends the picture alongside the instruction", () => {
    expect(gemini).toMatch(/inlineData: \{ data: input\.bytes\.toString\("base64"\)/);
    expect(gemini).toMatch(/\{ text: input\.instruction \}/);
  });

  it("does NOT harden the edit instruction", () => {
    // hardenImagePrompt appends "render no logos/text" — correct for generating a
    // scene, fatal for an edit whose entire request is often to place a logo.
    const editFn = gemini.match(/async editImage\([\s\S]*?\n    \},/)?.[0] ?? "";
    expect(editFn).not.toBe("");
    expect(editFn).not.toMatch(/hardenImagePrompt/);
  });

  it("refuses a generate-only model by type, not by a generic failure", () => {
    expect(gemini).toMatch(/throw new ImageEditUnsupportedError\(model\)/);
  });

  it("guards the operator-supplied source URL before fetching it", () => {
    // The URL arrives from a client; the compositor guards its own fetch the
    // same way and this one must not be the exception.
    const branch = action.match(/if \(input\.engine === "edit"\)[\s\S]*?assertPublicHttpUrl\(sourceUrl\);/)?.[0];
    expect(branch).toBeTruthy();
  });

  it("lands the edit in the approval gate like every other output", () => {
    // It rejoins the shared tail — metering, Library record, promoteAssetToCampaign
    // — rather than carrying a second, looser path to the same place.
    expect(action).toMatch(/context: \{ surface: "studio", engine: "edit" \}/);
    expect(action).toMatch(/EDITED_RISK/);
  });

  it("is reachable from the UI, not just callable", () => {
    expect(view).toMatch(/engine: "edit"/);
    expect(view).toMatch(/Change this image/);
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  return readFileSync(join(process.cwd(), rel), "utf8");
}
