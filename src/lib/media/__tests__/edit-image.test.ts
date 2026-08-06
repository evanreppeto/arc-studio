import { readFileSync } from "node:fs";

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
    // `provider` was added when Higgsfield became executable app-side: the
    // meter has to record WHICH engine ran, not only which surface asked.
    expect(action).toMatch(/context: \{ surface: "studio", engine: "edit", provider: engine\.engine \}/);
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

/**
 * An edit on a job-based engine renders for longer than one request may live
 * (a real Higgsfield image measured ~75s), so Studio submits and polls. What
 * matters is that the polled result rejoins the SAME landing sequence as the
 * synchronous one — a second, looser route to "the asset exists" is how Studio
 * once wrote to the bucket without ever writing a media_assets row (BSR-634).
 */
describe("Studio edit: start-then-poll", () => {
  const actions = readFileSync(new URL("../../../app/(app)/studio/actions.ts", import.meta.url), "utf8");
  const view = readFileSync(new URL("../../../app/(app)/studio/_components/studio-view.tsx", import.meta.url), "utf8");

  it("submits before downloading anything, on an engine that imports the URL itself", () => {
    // Fetching the bytes for a provider that only wants a URL is pure waste,
    // and it happens on the operator's clock.
    const branch = actions.match(/if \(input\.engine === "edit"\)[\s\S]*?const sourceRes = await fetch\(sourceUrl\);/)?.[0] ?? "";
    // Guard the guard: a regex that stops matching would make every assertion
    // below vacuously true, which is the failure mode of every source-grep test.
    expect(branch.length).toBeGreaterThan(300);
    expect(branch.indexOf("engine.provider.startImage")).toBeGreaterThan(-1);
    expect(branch.indexOf("engine.provider.startImage")).toBeLessThan(branch.indexOf("await fetch(sourceUrl)"));
  });

  it("lands a polled edit through the same helper as a synchronous one", () => {
    // Both paths call landStudioAsset — Library row, campaign draft, approval
    // gate — rather than one of them reimplementing it.
    expect(actions.match(/await landStudioAsset\(/g)?.length).toBe(2);
    const poll = actions.match(/export async function pollStudioEdit[\s\S]*?\n}/)?.[0] ?? "";
    expect(poll.length).toBeGreaterThan(500);
    expect(poll).toMatch(/landStudioAsset\(/);
    expect(poll).toMatch(/EDITED_RISK/);
  });

  it("binds the poll to the engine that started it, through the signed ticket", () => {
    const poll = actions.match(/export async function pollStudioEdit[\s\S]*?\n}/)?.[0] ?? "";
    expect(poll).toMatch(/verifyVideoTicket\(input\.ticket, input\.operationName, tenant\.workspace_id \?\? "", engineKey\)/);
  });

  it("does not meter the poll — the submit already paid", () => {
    const poll = actions.match(/export async function pollStudioEdit[\s\S]*?\n}/)?.[0] ?? "";
    expect(poll.length).toBeGreaterThan(500);
    expect(poll).not.toMatch(/meterConnectorCall/);
  });

  it("is actually driven from the UI, not merely callable", () => {
    expect(view).toMatch(/pollStudioEdit\(/);
    expect(view).toMatch(/res\.status === "running"/);
    // A button that looks idle for a minute gets pressed again, and that pays twice.
    expect(view).toMatch(/setEditNote\(/);
  });

  it("tells the truth when the render outlives the poll budget", () => {
    // The edit is real and paid for; "failed" would be a false statement about
    // the operator's credits.
    const loop = view.match(/if \(res\.status === "running"\)[\s\S]*?\n      \}/)?.[0] ?? "";
    expect(loop.length).toBeGreaterThan(300);
    expect(loop).toMatch(/Still rendering/);
    expect(loop).toMatch(/Library/);
  });
});
