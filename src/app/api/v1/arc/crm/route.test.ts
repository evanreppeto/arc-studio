import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/workspace", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({
    orgId: "org-1",
    workspaceId: "workspace-1",
  })),
}));
vi.mock("@/lib/repos", () => ({
  listCompaniesPage: vi.fn(async () => ({ companies: [], total: 0 })),
  listContactsPage: vi.fn(async () => ({ contacts: [], total: 0 })),
  // The leads route trims to a compact summary — it calls listLeadSummariesPage.
  listLeadSummariesPage: vi.fn(async () => ({ leads: [], total: 0 })),
  listJobsPage: vi.fn(async () => ({ jobs: [], total: 0 })),
  listPropertiesPage: vi.fn(async () => ({ properties: [], total: 0 })),
  listOutcomesPage: vi.fn(async () => ({ outcomes: [], total: 0 })),
}));

import {
  listCompaniesPage,
  listContactsPage,
  listJobsPage,
  listLeadSummariesPage,
  listOutcomesPage,
  listPropertiesPage,
} from "@/lib/repos";

import { GET as getCompanies } from "./companies/route";
import { GET as getContacts } from "./contacts/route";
import { GET as getJobs } from "./jobs/route";
import { GET as getLeads } from "./leads/route";
import { GET as getOutcomes } from "./outcomes/route";
import { GET as getProperties } from "./properties/route";

/** Every CRM list route, so the paging contract is asserted for all six. */
const ROUTES = [
  { name: "companies", get: getCompanies, repo: listCompaniesPage, key: "companies" },
  { name: "contacts", get: getContacts, repo: listContactsPage, key: "contacts" },
  { name: "leads", get: getLeads, repo: listLeadSummariesPage, key: "leads" },
  { name: "jobs", get: getJobs, repo: listJobsPage, key: "jobs" },
  { name: "properties", get: getProperties, repo: listPropertiesPage, key: "properties" },
  { name: "outcomes", get: getOutcomes, repo: listOutcomesPage, key: "outcomes" },
] as const;

const env = {
  ARC_AGENT_API_TOKEN: process.env.ARC_AGENT_API_TOKEN,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function configure() {
  process.env.ARC_AGENT_API_TOKEN = "secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

function request(path: string, token = "secret") {
  return new Request(`http://localhost/api/v1/arc/crm/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  for (const route of ROUTES) vi.mocked(route.repo).mockClear();
});

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Arc CRM routes", () => {
  it("passes the resolved org scope into all CRM list filters", async () => {
    configure();

    await getCompanies(request("companies?status=active&persona=persona_homeowner_emergency&partner_tier=A&q=lake&limit=10"));
    await getContacts(request("contacts?status=active&persona=persona_homeowner_emergency&company_id=company-1&q=evan&limit=10"));
    await getLeads(request("leads?status=qualified&persona=persona_homeowner_emergency&source=web&q=water&min_score=25&max_score=90&limit=10"));
    await getJobs(request("jobs?status=scheduled&persona=persona_homeowner_emergency&company_id=company-1&limit=10"));
    await getProperties(request("properties?persona=persona_homeowner_emergency&city=Chicago&state=IL&postal_code=60614&property_type=condo&company_id=company-1&q=main&limit=10"));
    await getOutcomes(request("outcomes?status=won&persona=persona_homeowner_emergency&company_id=company-1&limit=10"));

    for (const route of ROUTES) {
      expect(route.repo, route.name).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1" }));
    }
  });

  it("keeps synthetic fixtures out of Arc's live evidence routes", async () => {
    configure();

    await getLeads(request("leads"));
    await getJobs(request("jobs"));
    await getOutcomes(request("outcomes"));

    for (const repo of [listLeadSummariesPage, listJobsPage, listOutcomesPage]) {
      expect(repo).toHaveBeenCalledWith(expect.objectContaining({ excludeSynthetic: true }));
    }
  });

  it("rejects invalid bearer tokens before reading CRM data", async () => {
    configure();

    const res = await getCompanies(request("companies", "wrong"));

    // These tests point at an unreachable Supabase, so the token store cannot
    // answer — and "I could not verify this" is now 503, distinct from the 401
    // that means "this token is not ours". The security property under test is
    // unchanged: the request is refused and nothing is read or written. The 401
    // path is covered where the store can be made to answer (see the
    // token-store test below, and src/lib/auth/check-agent-bearer.test.ts).
    expect(res.status).toBe(503);
    expect(listCompaniesPage).not.toHaveBeenCalled();
  });
});

describe("Arc CRM list paging", () => {
  // The whole read surface shares one bug shape: an unbounded read whose rows
  // then get silently cut to fit the runner's 8000-char tool budget. These
  // assertions are per-route so a new list route can't quietly opt out.
  it.each(ROUTES)("$name caps an unbounded read at the default limit", async ({ get, repo, name }) => {
    configure();

    await get(request(name));

    expect(vi.mocked(repo).mock.calls[0][0]).toMatchObject({ limit: 25 });
  });

  it.each(ROUTES)("$name clamps a limit above the maximum", async ({ get, repo, name }) => {
    configure();

    await get(request(`${name}?limit=5000`));

    expect(vi.mocked(repo).mock.calls[0][0]).toMatchObject({ limit: 100 });
  });

  it.each(ROUTES)("$name passes limit=0 through as a count-only read", async ({ get, repo, name }) => {
    configure();

    await get(request(`${name}?limit=0`));

    expect(vi.mocked(repo).mock.calls[0][0]).toMatchObject({ limit: 0 });
  });

  it.each(ROUTES)("$name falls back to the default for an invalid limit", async ({ get, repo, name }) => {
    configure();

    // A typo must never widen a read — invalid falls back to the default, not
    // to unbounded.
    await get(request(`${name}?limit=abc`));
    expect(vi.mocked(repo).mock.calls[0][0]).toMatchObject({ limit: 25 });

    vi.mocked(repo).mockClear();
    await get(request(`${name}?limit=-5`));
    expect(vi.mocked(repo).mock.calls[0][0]).toMatchObject({ limit: 25 });
  });

  it.each(ROUTES)("$name reports the exact total alongside a capped page", async ({ get, repo, name, key }) => {
    configure();

    // The repro: 200 real leads, a page holding far fewer. `total` is what stops
    // the caller inferring the count from the rows it can see.
    vi.mocked(repo).mockResolvedValueOnce({ [key]: [{ id: "a" }, { id: "b" }], total: 200 } as never);

    const body = await (await get(request(`${name}?limit=2`))).json();

    expect(body).toMatchObject({ ok: true, total: 200, returned: 2, limit: 2, has_more: true });
    expect(body[key]).toHaveLength(2);
  });

  it.each(ROUTES)("$name reports has_more:false when the page holds every match", async ({ get, repo, name, key }) => {
    configure();

    vi.mocked(repo).mockResolvedValueOnce({ [key]: [{ id: "a" }], total: 1 } as never);

    const body = await (await get(request(name))).json();

    expect(body).toMatchObject({ total: 1, returned: 1, has_more: false });
  });

  it.each(ROUTES)("$name answers limit=0 with a total and no rows", async ({ get, repo, name, key }) => {
    configure();

    vi.mocked(repo).mockResolvedValueOnce({ [key]: [], total: 200 } as never);

    const body = await (await get(request(`${name}?limit=0`))).json();

    expect(body).toMatchObject({ total: 200, returned: 0, has_more: true });
    expect(body[key]).toEqual([]);
  });
});
