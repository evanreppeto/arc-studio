import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Spend is recorded where the money leaves, not where the work finishes.
 *
 * Observed on prod: an edit whose upload died on the function budget (#1034) left
 * `connector_usage_events` holding a row for the call and `ai_usage_events`
 * holding none. The provider had already returned an image — it bills for that —
 * but `recordUsageEvent` sat AFTER the upload, so the failure took the ledger
 * write with it. One spend, two books, one entry.
 *
 * The consequence is quiet and cumulative: the usage total understates reality by
 * exactly the failed calls, and the caps measured against it protect by that much
 * less. BSR-502 is the same disease.
 *
 * Source assertions on ORDER, because order is the whole property and no unit
 * test can observe a serverless deadline landing mid-write.
 */
describe("spend is recorded before storage", () => {
  const source = readFileSync(join(__dirname, "actions.ts"), "utf8");

  /**
   * Scoped to the branch, deliberately.
   *
   * The first version of this searched forward from `recordSpend` for the next
   * `storeGeneratedImage` — and passed even with the call moved after the store,
   * because it found the OTHER branch's store further down the file. A guard that
   * cannot fail is worse than none: it reports the property is held while it is
   * being violated. Caught by reverting the fix and watching the test stay green.
   */
  const branch = (engine: string): string => {
    const start = source.indexOf(`if (input.engine === "${engine}")`);
    expect(start, `${engine} branch not found`).toBeGreaterThan(-1);
    // Up to the next branch, so a later engine's calls cannot satisfy this one.
    const next = source.indexOf("} else if (input.engine ===", start + 1);
    const end = next > start ? next : source.indexOf("\n    // Land the approval-gated draft", start);
    return source.slice(start, end > start ? end : undefined);
  };

  it.each([
    ["edit", "studio_edit"],
    ["image", "studio_generate"],
  ])("records the %s engine's spend before it tries to store", (engine, route) => {
    const block = branch(engine);
    const spendAt = block.indexOf(`recordSpend(ctx.orgId, tenant.workspace_id, gen, "${route}"`);
    const storeAt = block.indexOf("storeGeneratedImage(objectPath");
    expect(spendAt, `${route} must call recordSpend inside its own branch`).toBeGreaterThan(-1);
    expect(storeAt, `${engine} must store inside its own branch`).toBeGreaterThan(-1);
    expect(storeAt).toBeGreaterThan(spendAt);
  });

  it("degrades rather than throwing — the money is already gone", () => {
    const fn = source.match(/async function recordSpend[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toMatch(/\.catch\(/);
    expect(fn).toMatch(/reportDegraded/);
    // Silent is how metering stops matching the invoice.
    expect(fn).not.toMatch(/catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
  });

  it("is one helper, so the two image engines cannot drift apart", () => {
    // They had separate inline copies; fixing one would have left the other.
    expect((source.match(/await recordSpend\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Exactly one place actually writes an image usage row.
    expect((source.match(/service: "gemini_image",\n/g) ?? []).length).toBe(1);
  });

  /** Video had the same shape — store, then record — and is metered at START,
   *  so a failed store on the final poll loses the row for work already billed. */
  it("records the video before storing it too", () => {
    const recordAt = source.indexOf('service: "gemini_video"');
    const storeAt = source.indexOf("storeGeneratedMedia(objectPath, result.bytes", recordAt);
    expect(recordAt).toBeGreaterThan(-1);
    expect(storeAt).toBeGreaterThan(recordAt);
  });
});

/**
 * "Animate" means animate THIS picture.
 *
 * Studio has offered "Add gentle motion to this image" since the quick-ask row
 * existed, and `startStudioVideo` had no way to send an image — so Veo invented a
 * clip from the words and the photo the operator was pointing at was discarded.
 * Same shape as the missing image edit: point at something you have, get
 * something unrelated generated from scratch.
 *
 * Veo takes a starting image OR a source video, never both; only the image case
 * is wired, because extending an existing clip is a different feature and
 * pretending otherwise is how "video editing" would get claimed without existing.
 */
describe("animate uses the picture on the canvas", () => {
  const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
  const view = readFileSync(join(__dirname, "_components", "studio-view.tsx"), "utf8");
  const gemini = readFileSync(join(__dirname, "..", "..", "..", "lib", "media", "gemini.ts"), "utf8");

  it("passes the selected photo as the start frame", () => {
    expect(view).toMatch(/sourceImageUrl: bg\?\.url/);
    expect(actions).toMatch(/image: startFrame/);
  });

  it("hands Veo the image, not just the prompt", () => {
    const startVideo = gemini.match(/async startVideo[\s\S]*?\n    \},/)?.[0] ?? "";
    expect(startVideo).toMatch(/input\.image/);
    expect(startVideo).toMatch(/imageBytes/);
  });

  it("fetches the frame before metering — a bad URL must cost nothing", () => {
    const fetchAt = actions.indexOf("const frameUrl = (input.sourceImageUrl");
    const meterAt = actions.indexOf("estimatedUnits: MEDIA_UNITS.video");
    expect(fetchAt).toBeGreaterThan(-1);
    expect(meterAt).toBeGreaterThan(fetchAt);
  });

  it("guards the operator-supplied frame URL", () => {
    const block = actions.slice(actions.indexOf("const frameUrl = (input.sourceImageUrl"), actions.indexOf("estimatedUnits: MEDIA_UNITS.video"));
    expect(block).toMatch(/assertPublicHttpUrl\(frameUrl\)/);
  });

  it("stops promising the photo is ignored", () => {
    expect(view).not.toMatch(/it does not use the selected photo/);
  });
});
