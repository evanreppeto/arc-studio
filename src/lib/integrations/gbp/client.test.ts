import { describe, expect, it, vi } from "vitest";

import { gbpGet, toBusinessInformationName } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Typed so `mock.calls[n]` carries the fetch arguments the assertions inspect. */
const stubFetch = (body: unknown, status = 200) =>
  vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => jsonResponse(body, status));

describe("toBusinessInformationName", () => {
  // REGRESSION GUARD: config.gbpLocation is stored account-scoped because the v4
  // reviews endpoint keys on it, but Business Information v1 keys on the bare
  // form. Passing the stored string straight through 404s — and the reviews
  // connector renders a 404 as "location not found — check the location resource
  // name", blaming the operator for a format mismatch they did not cause.
  it("translates the stored account-scoped name to the bare form", () => {
    expect(toBusinessInformationName("accounts/1234567890/locations/9876543210")).toBe("locations/9876543210");
  });

  it("passes an already-bare name through", () => {
    expect(toBusinessInformationName("locations/9876543210")).toBe("locations/9876543210");
  });

  it("returns null rather than a doomed request for anything else", () => {
    expect(toBusinessInformationName("")).toBeNull();
    expect(toBusinessInformationName(null)).toBeNull();
    expect(toBusinessInformationName("9876543210")).toBeNull();
    expect(toBusinessInformationName("accounts/123")).toBeNull();
    expect(toBusinessInformationName("accounts/1/locations/2/reviews")).toBeNull();
  });
});

describe("gbpGet", () => {
  // REGRESSION GUARD: the OAuth scope behind these credentials (business.manage)
  // permits PATCHing a customer's live public storefront. Read-only must be a
  // property of the door, not a convention at each call site — there is no
  // argument a caller can pass to make this write.
  it("can only ever issue a GET, with no body", async () => {
    const fetchImpl = stubFetch({ ok: true });
    await gbpGet("https://example.com/v1/locations/1", "token", { fetchImpl: fetchImpl as unknown as typeof fetch });

    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("sends the bearer token", async () => {
    const fetchImpl = stubFetch({});
    await gbpGet("https://example.com/x", "tok-123", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("reports the status so a probe can say why, rather than looking empty", async () => {
    const fetchImpl = stubFetch({}, 403);
    const result = await gbpGet("https://example.com/x", "t", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("surfaces a transport failure as a result rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await gbpGet("https://example.com/x", "t", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ ok: false, status: null, error: "network down" });
  });
});
