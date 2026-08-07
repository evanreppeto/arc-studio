import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "./config";

/**
 * The seam between the image and the process: `ARC_RUNNER_COMMIT` is baked in by
 * the Dockerfile (`ARG` → `ENV`, fed by cloudbuild's `--build-arg`), and this is
 * where it becomes something `/health` can report.
 *
 * Worth its own test because the failure is silent in both directions — a typo
 * in the variable name yields `null`, which is a legitimate value meaning "not
 * built by the pipeline". The endpoint would then answer honestly-looking
 * nonsense forever.
 */

const REQUIRED = {
  APP_API_BASE_URL: "https://app.example",
  ARC_AGENT_API_TOKEN: "tok",
  ANTHROPIC_API_KEY: "sk-test",
};

let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, REQUIRED);
});

afterEach(() => {
  process.env = saved;
});

describe("config.commit", () => {
  it("reads the commit the image was built with", () => {
    process.env.ARC_RUNNER_COMMIT = "24080071abcdef";
    expect(loadConfig().commit).toBe("24080071abcdef");
  });

  it("is null when unset — an image that did not come from the pipeline", () => {
    delete process.env.ARC_RUNNER_COMMIT;
    expect(loadConfig().commit).toBeNull();
  });

  it("treats whitespace as unset rather than reporting a blank build", () => {
    // `--build-arg=ARC_RUNNER_COMMIT=` on a manual build produces an empty
    // string, and `commit: ""` would render as a deploy with no name instead of
    // as "unknown".
    process.env.ARC_RUNNER_COMMIT = "   ";
    expect(loadConfig().commit).toBeNull();
  });
});
