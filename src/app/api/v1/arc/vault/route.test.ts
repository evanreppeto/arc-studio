import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/vault/read-model", () => ({ getVaultNotes: vi.fn(), getVaultNote: vi.fn() }));
vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ orgId: "org-1", workspaceId: "workspace-1" })),
}));
import { getVaultNotes, getVaultNote } from "@/lib/vault/read-model";
import { GET } from "./route";

const notesMock = vi.mocked(getVaultNotes);
const noteMock = vi.mocked(getVaultNote);
function req(auth: string | undefined, slug?: string) {
  const u = new URL("http://localhost/api/v1/arc/vault"); if (slug) u.searchParams.set("slug", slug);
  return new Request(u, { headers: { ...(auth ? { authorization: auth } : {}) } });
}
const env = { ARC_AGENT_API_TOKEN: process.env.ARC_AGENT_API_TOKEN, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
function configure() { process.env.ARC_AGENT_API_TOKEN = "secret"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k"; }
beforeEach(() => {
  notesMock.mockReset(); noteMock.mockReset();
  notesMock.mockResolvedValue({ status: "live", notes: [{ slug: "n1", title: "Note 1" }] } as never);
  noteMock.mockResolvedValue({ slug: "n1", title: "Note 1" } as never);
});
afterEach(() => { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("GET /api/v1/arc/vault", () => {
  it("401s without a valid token", async () => {
    process.env.ARC_AGENT_API_TOKEN = "secret";
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(notesMock).not.toHaveBeenCalled();
  });
  it("lists notes when no slug, scoped to the token org AND workspace", async () => {
    configure();
    expect(await (await GET(req("Bearer secret"))).json()).toMatchObject({ ok: true, notes: [{ slug: "n1" }] });
    // Both, not just the org: the read-model uses the service-role client, which
    // bypasses RLS, so the org filter alone would span every workspace (BSR-729).
    expect(notesMock).toHaveBeenCalledWith("org-1", "workspace-1");
  });
  it("returns a single note for ?slug=, scoped to the token org AND workspace", async () => {
    configure();
    const res = await GET(req("Bearer secret", "n1"));
    expect(await res.json()).toMatchObject({ ok: true, note: { slug: "n1" } });
    expect(noteMock).toHaveBeenCalledWith("n1", "org-1", "workspace-1");
  });
  it("404s when the slug is not found", async () => {
    configure(); noteMock.mockResolvedValue(null as never);
    expect((await GET(req("Bearer secret", "missing"))).status).toBe(404);
  });
});
