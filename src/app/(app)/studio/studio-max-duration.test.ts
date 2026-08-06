import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A page whose server actions call a model must raise its function budget.
 *
 * Found by clicking "Change this image…" on prod. The edit ran, the model
 * returned a picture, and writing it died with "media upload failed: This
 * operation was aborted" — the deadline landing mid-upload, not a storage fault.
 * The message named the last thing in flight rather than the thing that killed
 * it, which is why it read as a Supabase problem.
 *
 * It hid because nothing on this page had called a slow provider from the browser
 * before: "Generate creative" is `compose`, which renders locally in
 * milliseconds, and video is start-then-poll precisely so no request stays open.
 * `edit` is the first, and it inherited the default.
 *
 * A source assertion because the budget is a deploy-time property — there is no
 * way to observe it from a test run, and the environment that enforces it is the
 * one this suite cannot execute.
 */
describe("studio function budget", () => {
  const page = readFileSync(join(__dirname, "page.tsx"), "utf8");

  it("raises maxDuration, or a model call dies mid-write", () => {
    const declared = page.match(/export const maxDuration = (\d+)/)?.[1];
    expect(declared, "studio/page.tsx must declare maxDuration").toBeTruthy();
    // Long enough for an image edit plus the upload of the result.
    expect(Number(declared)).toBeGreaterThanOrEqual(60);
  });

  it("keeps video on start-then-poll, which is why IT never needed the budget", () => {
    // If video ever became a single blocking call it would blow any budget —
    // the split is the design, not an accident of how it was written.
    const actions = readFileSync(join(__dirname, "actions.ts"), "utf8");
    expect(actions).toMatch(/export async function startStudioVideo/);
    expect(actions).toMatch(/export async function pollStudioVideo/);
  });
});
