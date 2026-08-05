import { describe, expect, it } from "vitest";

import { persistableAssetBody, screenableAssetText } from "../create";

/**
 * The rule these two encode: creative must be SCREENED on its prompt, and must
 * never be PERSISTED as though the prompt were its copy.
 *
 * Before this, `screenDraftCopy` was handed the body and only the body, so an
 * image — which has none — returned UNSCREENED. Verified on prod: all 6
 * `image_prompt` assets carry an empty `prompt_inputs`, no `guardrail` entry in
 * `audit_payload`, and no draft-critic run. Three review layers, none of which
 * applied, because the one piece of text that existed was discarded at write
 * time.
 */
describe("screenableAssetText", () => {
  it("screens the body when the asset has one", () => {
    expect(screenableAssetText("Hi {{first_name}}, …", "a prompt")).toBe("Hi {{first_name}}, …");
  });

  it("falls back to the prompt for creative with no body", () => {
    expect(screenableAssetText(null, "service van in a driveway, bright morning")).toBe(
      "service van in a driveway, bright morning",
    );
  });

  /** The point of the fallback: a banned phrase in a prompt is now reachable by
   *  the screen. The brand kit's list is legal-risk language, and a prompt
   *  asking for a text overlay can carry it as easily as an email body can. */
  it("makes a banned phrase in a prompt screenable at all", () => {
    const prompt = 'billboard reading "we guarantee your insurance claim will be approved"';
    expect(screenableAssetText(null, prompt)).toBe(prompt);
  });

  it("treats blank or whitespace text as absent", () => {
    expect(screenableAssetText(null, "   ")).toBeNull();
    expect(screenableAssetText(null, null)).toBeNull();
    expect(screenableAssetText(null, undefined)).toBeNull();
    expect(screenableAssetText("", null)).toBeNull();
    // A blank body with a real prompt still screens the prompt.
    expect(screenableAssetText("  ", "real prompt")).toBe("real prompt");
  });
});

describe("persistableAssetBody", () => {
  it("never persists a prompt as the body", () => {
    // The whole trap: screening the prompt must not turn it into the copy every
    // surface renders. A bodiless asset stays bodiless.
    expect(persistableAssetBody(null, null)).toBeNull();
    expect(persistableAssetBody(null, "cta-resolved rewrite")).toBeNull();
  });

  it("prefers the screen's CTA-resolved rewrite for a real body", () => {
    expect(persistableAssetBody("Book at {{cta}}", "Book at https://x.test/b")).toBe("Book at https://x.test/b");
  });

  it("keeps the original body when the screen rewrote nothing", () => {
    expect(persistableAssetBody("Plain copy", null)).toBe("Plain copy");
  });
});
