import { describe, expect, it } from "vitest";

import { splitStudioContext } from "./_components/studio-view";

/**
 * askArc appends "(From Studio · …)" to the body it SENDS so Arc knows the canvas
 * state. Rendering it inside the operator's own bubble put machine preamble in
 * their words — and because the optimistic copy never had it, the message visibly
 * rewrote itself the moment the canonical thread arrived.
 */
describe("splitStudioContext", () => {
  it("splits the appended Studio context off the message", () => {
    const { body, context } = splitStudioContext(
      'add our logo to the side of the truck\n\n(From Studio · Draft · image · 1:1)',
    );
    expect(body).toBe("add our logo to the side of the truck");
    expect(context).toBe("From Studio · Draft · image · 1:1");
  });

  it("keeps the headline variant intact", () => {
    const { body, context } = splitStudioContext(
      'make it warmer\n\n(From Studio · Act · video · 16:9 · headline: "Ready before the storm")',
    );
    expect(body).toBe("make it warmer");
    expect(context).toBe('From Studio · Act · video · 16:9 · headline: "Ready before the storm"');
  });

  it("leaves a message with no context untouched", () => {
    const { body, context } = splitStudioContext("just a plain question");
    expect(body).toBe("just a plain question");
    expect(context).toBeNull();
  });

  it("does not strip an unrelated trailing parenthetical", () => {
    const { body, context } = splitStudioContext("use the wide shot (the one from Tuesday)");
    expect(body).toBe("use the wide shot (the one from Tuesday)");
    expect(context).toBeNull();
  });

  it("only strips the suffix, never a mention mid-message", () => {
    const input = "(From Studio · Draft · image · 1:1) is what you said last time";
    expect(splitStudioContext(input).context).toBeNull();
  });
});
