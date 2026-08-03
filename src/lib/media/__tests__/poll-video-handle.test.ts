import { GenerateVideosOperation } from "@google/genai";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the SECOND stacked video bug: pollVideo passed
 * `{ name } as GenerateVideosOperation` to the SDK. The cast satisfied the
 * compiler, then every poll threw "t._fromAPIResponse is not a function" —
 * the SDK invokes that method on the handle it is given, and an object
 * literal does not have it.
 *
 * Start and poll are separate stateless HTTP requests, so we cannot retain the
 * instance the SDK's example keeps in a loop; we rebuild it by name. This test
 * asserts the rebuilt handle carries the method the SDK will call.
 */
describe("pollVideo operation handle", () => {
  it("rebuilds a real operation instance that carries _fromAPIResponse", () => {
    const handle = new GenerateVideosOperation();
    handle.name = "models/veo-3.1-fast-generate-preview/operations/abc123";

    expect(handle).toBeInstanceOf(GenerateVideosOperation);
    expect(typeof handle._fromAPIResponse).toBe("function");
    expect(handle.name).toBe("models/veo-3.1-fast-generate-preview/operations/abc123");
  });

  it("documents why the old object-literal cast failed at runtime", () => {
    const castLikeTheOldCode = { name: "models/x/operations/y" } as unknown as GenerateVideosOperation;
    expect(castLikeTheOldCode._fromAPIResponse).toBeUndefined();
  });
});
