import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signVideoTicket, verifyVideoTicket } from "../video-ticket";

const OP = "models/veo-3.1-fast-generate-preview/operations/vpu7b35khsis";
const WS_A = "840470d3-8b4a-49e7-bd5f-5e52bdc62cf7";
const WS_B = "0d2ddb28-2582-41b6-9c50-a001bd2ee9a6";

describe("video poll ticket", () => {
  const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
  beforeAll(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });
  afterAll(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
  });

  it("verifies a ticket for the workspace that started the render", () => {
    expect(verifyVideoTicket(signVideoTicket(OP, WS_A), OP, WS_A)).toBe(true);
  });

  it("refuses another workspace's ticket for the same operation", () => {
    // The point of the binding: the Gemini key is shared across workspaces, so
    // the operation name alone must never be enough to claim a render.
    expect(verifyVideoTicket(signVideoTicket(OP, WS_A), OP, WS_B)).toBe(false);
  });

  it("refuses a ticket minted for a different operation", () => {
    const other = "models/veo-3.1-fast-generate-preview/operations/someoneelse";
    expect(verifyVideoTicket(signVideoTicket(other, WS_A), OP, WS_A)).toBe(false);
  });

  it("refuses a forged or empty ticket", () => {
    expect(verifyVideoTicket("", OP, WS_A)).toBe(false);
    expect(verifyVideoTicket("deadbeef", OP, WS_A)).toBe(false);
    expect(verifyVideoTicket("0".repeat(64), OP, WS_A)).toBe(false);
  });

  it("refuses an empty workspace id, so the binding can't be no-opped", () => {
    // A caller with no resolved workspace must fail closed rather than get a
    // ticket that happens to verify against the same empty string.
    expect(verifyVideoTicket(signVideoTicket(OP, ""), OP, "")).toBe(false);
  });
});
