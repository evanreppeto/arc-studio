import { describe, expect, it } from "vitest";

import { createSupabaseQueryMock } from "@/lib/repos/__tests__/test-helpers";

import { CRM_SEARCH_LIMIT, sanitizeCrmSearch, searchCrmObjectRows } from "./read-model";

const ORG = "org-1";

/** The reproduction from BSR-633: a contact that sits past the 1,000th row. */
const DANA = {
  id: "contact-2701",
  company_id: null,
  persona: "persona_property_manager",
  status: "active",
  first_name: "Dana",
  last_name: "Whitfield",
  full_name: "Dana Whitfield",
  email: "dana.whitfield@northshore-pg.local",
  phone: null,
  title: "Portfolio Manager",
  metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  origin: "seed",
};

function mock(ids: Array<{ id: string }>, rows: unknown[] = [DANA]) {
  return createSupabaseQueryMock({
    // First read is the id lookup; the focused bundle then re-reads contacts.
    contacts: [{ data: ids, error: null }, { data: rows, error: null }],
    companies: { data: [], error: null },
    properties: { data: [], error: null },
    leads: { data: [], error: null },
    jobs: { data: [], error: null },
    outcomes: { data: [], error: null },
    pipeline_stages: { data: [], error: null },
  });
}

describe("a record past the fetch window is still findable (BSR-633)", () => {
  it("finds the 2,701st contact the board never loaded", async () => {
    // The board holds a 1,000-row recency window and filters it in the browser,
    // so this record was not in the browser at all — while the counter, a real
    // COUNT, said it existed. 63% of a 2,719-contact workspace was unreachable.
    const supabase = mock([{ id: "contact-2701" }]);
    const result = await searchCrmObjectRows("contacts", "dana.whitfield", ORG, supabase as never);

    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("expected live");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toContain("Dana Whitfield");
  });

  it("searches the record's own columns, not just its name", async () => {
    const supabase = mock([{ id: "contact-2701" }]);
    await searchCrmObjectRows("contacts", "dana.whitfield", ORG, supabase as never);
    const or = supabase.calls.find((c) => c[0] === "or")?.[1] as string;
    expect(or).toContain("full_name.ilike.*dana.whitfield*");
    expect(or).toContain("email.ilike.*dana.whitfield*");
  });

  it("is org-scoped", async () => {
    const supabase = mock([{ id: "contact-2701" }]);
    await searchCrmObjectRows("contacts", "dana", ORG, supabase as never);
    expect(supabase.calls).toContainEqual(["eq", "org_id", ORG]);
  });

  it("fetches the hits by id rather than re-taking the recency window", async () => {
    // The whole point: the window is what hid the record.
    const supabase = mock([{ id: "contact-2701" }]);
    await searchCrmObjectRows("contacts", "dana", ORG, supabase as never);
    expect(supabase.calls).toContainEqual(["in", "id", ["contact-2701"]]);
  });
});

describe("no silent caps", () => {
  it("reports when the match set itself hit the ceiling", async () => {
    // A count that is really a cap is the failure this codebase keeps repeating.
    const ids = Array.from({ length: CRM_SEARCH_LIMIT + 1 }, (_, i) => ({ id: `c-${i}` }));
    const supabase = mock(ids, [DANA]);
    const result = await searchCrmObjectRows("contacts", "smith", ORG, supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.capped).toBe(true);
  });

  it("is not capped when everything fits", async () => {
    const supabase = mock([{ id: "contact-2701" }]);
    const result = await searchCrmObjectRows("contacts", "dana", ORG, supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.capped).toBe(false);
  });
});

describe("the term is neutralised before it reaches PostgREST", () => {
  it("strips the characters that would break or inject into an .or() filter", () => {
    // `.or()` embeds the term in a comma/paren-delimited string and treats `*`
    // as the wildcard — a raw comma could add an OR condition of its own.
    expect(sanitizeCrmSearch("smith,(x)*")).toBe("smith x");
    expect(sanitizeCrmSearch("  dana   whitfield  ")).toBe("dana whitfield");
  });

  it("keeps characters that are load-bearing in real records", () => {
    expect(sanitizeCrmSearch("dana.whitfield@northshore-pg.local")).toBe("dana.whitfield@northshore-pg.local");
  });

  it("does not query on a term too short to mean anything", async () => {
    // One character matches most of the table; the caller filters its page anyway.
    const supabase = mock([{ id: "x" }]);
    const result = await searchCrmObjectRows("contacts", "d", ORG, supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.rows).toEqual([]);
    expect(supabase.calls.some((c) => c[0] === "or")).toBe(false);
  });

  it("treats an all-punctuation term as too short rather than querying for nothing", async () => {
    const supabase = mock([{ id: "x" }]);
    const result = await searchCrmObjectRows("contacts", "((,))", ORG, supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.rows).toEqual([]);
  });
});

describe("a failed search is not an empty result", () => {
  it("reports unavailable rather than claiming no matches", async () => {
    // "Nothing found" and "the search broke" are different answers, and
    // collapsing them is how an outage hides behind an empty table.
    const supabase = createSupabaseQueryMock({
      contacts: { data: null, error: { message: "column does not exist", code: "42703" } },
    });
    const result = await searchCrmObjectRows("contacts", "dana", ORG, supabase as never);
    expect(result.status).toBe("unavailable");
  });

  it("returns no rows, not an error, when nothing matches", async () => {
    const supabase = mock([]);
    const result = await searchCrmObjectRows("contacts", "nobodyhere", ORG, supabase as never);
    if (result.status !== "live") throw new Error("expected live");
    expect(result.rows).toEqual([]);
    expect(result.capped).toBe(false);
  });
});
