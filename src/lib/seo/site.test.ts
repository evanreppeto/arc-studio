import { describe, expect, it, vi } from "vitest";

import { isIndexableDeployment } from "./site";

describe("isIndexableDeployment", () => {
  it("indexes production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isIndexableDeployment()).toBe(true);
  });

  it("does NOT index preview or development deployments", () => {
    // A branch preview serving the same marketing page would compete with the
    // real domain in search results.
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isIndexableDeployment()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "development");
    expect(isIndexableDeployment()).toBe(false);
  });

  it("treats an absent VERCEL_ENV as indexable (local dev, CI, self-hosted)", () => {
    vi.stubEnv("VERCEL_ENV", "");
    expect(isIndexableDeployment()).toBe(true);
  });
});
