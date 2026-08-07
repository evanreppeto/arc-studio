import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { stageOrder, summarizeFunnel, type Journey, type JourneyStageKey } from "@/domain";

import { getJourneysReadModel } from "./read-model";

const READ_MODEL = readFileSync(new URL("./read-model.ts", import.meta.url), "utf8");
const VIEW = readFileSync(new URL("../../app/(app)/journeys/_components/journeys-view.tsx", import.meta.url), "utf8");

/**
 * /journeys read seven tables at `.limit(1000)` with no ORDER BY, and said
 * nothing about it.
 *
 * The file was already careful about the *other* two ways this screen can
 * mislead. A failed read throws with every failing table named, because an empty
 * page is indistinguishable from an outage (BSR-542/544). The 60-row list cap is
 * restated in the UI so a short list doesn't read as the whole book. Between
 * those two sat a third: a read that succeeded and was incomplete, feeding the
 * funnel, the KPI tiles and all five attribution lenses — which are computed
 * from the rows, not queried as aggregates. Over the ceiling, a journey loses
 * touches and comes back with the wrong current stage, the wrong first touch,
 * and revenue credited to the wrong channel, stated exactly as confidently as a
 * complete read.
 *
 * Unreachable on the live workspace today (243 customers, and every other source
 * at zero) — but `engagement_events` grows per send, not per customer, so it is
 * the first to cross and it crosses without anyone doing anything unusual.
 */
describe("a truncated read is ordered", () => {
  it("orders every capped query before limiting it", () => {
    // Without ORDER BY, LIMIT returns an arbitrary thousand — so the same
    // workspace could show a different funnel on each reload. Each `.limit(
    // MAX_ROWS)` must be immediately preceded by an `.order(`.
    const limits = [...READ_MODEL.matchAll(/\.limit\(MAX_ROWS\)/g)];
    expect(limits.length).toBe(7);
    for (const match of limits) {
      const before = READ_MODEL.slice(Math.max(0, match.index - 120), match.index);
      expect(before).toMatch(/\.order\("[a-z_]+", \{ ascending: false \}\)\s*$/);
    }
  });

  it("orders on columns that are NOT NULL, so nulls-ordering cannot bite", () => {
    // Verified against prod's information_schema: created_at, occurred_at,
    // received_at and last_seen_at are all NOT NULL on their tables. A nullable
    // column here would sort nulls first under PostgREST's default and truncate
    // to exactly the rows carrying no timestamp.
    const columns = [...READ_MODEL.matchAll(/\.order\("([a-z_]+)", \{ ascending: false \}\)/g)].map(([, c]) => c);
    expect(new Set(columns)).toEqual(new Set(["created_at", "occurred_at", "received_at", "last_seen_at"]));
  });
});

describe("a truncated read says so", () => {
  it("flags any source that came back exactly full", () => {
    expect(READ_MODEL).toContain(".filter(([, rows]) => rows.length >= MAX_ROWS)");
  });

  it("carries the flag out on the live model", () => {
    expect(READ_MODEL).toContain("partialSources: partialSources.length > 0 ? partialSources : undefined,");
  });

  it("stays absent when nothing was truncated", async () => {
    // The common case must not grow a permanent warning: `undefined`, not `[]`.
    const model = await getJourneysReadModel(stubClient(3), "org-1", Date.parse("2026-08-07T00:00:00Z"));
    expect(model.status).toBe("live");
    if (model.status !== "live") return;
    expect(model.partialSources).toBeUndefined();
  });

  it("names the truncated source when one comes back full", async () => {
    const model = await getJourneysReadModel(stubClient(1000), "org-1", Date.parse("2026-08-07T00:00:00Z"));
    expect(model.status).toBe("live");
    if (model.status !== "live") return;
    expect(model.partialSources).toContain("customers");
  });

  it("names sources in the operator's words, never the table's", () => {
    // src/app/(app)/plumbing-vocabulary.test.ts bans database identifiers in
    // rendered text, and this string is rendered. `engagement_events` and
    // `journey_touchpoints` mean nothing to an owner-operator.
    const labels = [...READ_MODEL.matchAll(/\["([a-z ]+)", \w+Rows\]/g)].map(([, l]) => l);
    expect(labels).toEqual(["customers", "email and message activity", "leads", "jobs", "outcomes", "site visitors", "site activity"]);
  });
});

describe("the screen renders the warning", () => {
  it("shows it above the numbers it qualifies", () => {
    expect(VIEW).toContain("const partial = model.partialSources ?? [];");
    expect(VIEW).toMatch(/partial\.length > 0 && \(/);
    expect(VIEW).toContain("This is a partial view.");
    // Placed before <header>, so it is read before the KPI strip it applies to.
    expect(VIEW.indexOf("This is a partial view.")).toBeLessThan(VIEW.indexOf("<KpiStrip"));
  });

  it("does not call a partial read an error", () => {
    // The failed-read banner above it is role="alert" and says the data is
    // missing. This one is role="status": the numbers are real, just a floor.
    // Sliced forward by a fixed window, not to the next <header>: `jr-head`
    // appears earlier in the file too (the not-live branch has its own), so
    // slicing to it ran backwards and silently compared an empty string.
    const start = VIEW.indexOf("partial.length > 0 &&");
    expect(start).toBeGreaterThan(-1);
    const block = VIEW.slice(start, start + 500);
    expect(block).toContain('role="status"');
    expect(block).not.toContain('role="alert"');
  });
});

/**
 * Each funnel bar is a button. It carries a count and it sets the list filter,
 * so those two have to be the same question — and they were not.
 *
 * Measured on the demo workspace, funnel count vs rows after clicking:
 * Reached 6→0, Engaged 6→1, Identified 5→1, Nurtured 4→1, Converted 3→2,
 * Retained 1→1. Both numbers were individually correct: `FunnelStage.count` is
 * documented as "journeys that reached at least this stage", while the filter
 * matched `currentStage === stage` — a disjoint partition, which is why the six
 * row counts summed to exactly the 6 journeys. The visible result was a button
 * reading 6 that opened onto "No journeys in this stage."
 */
describe("a funnel bar shows the journeys it counted", () => {
  it("filters by the same rule summarizeFunnel counts by", () => {
    expect(VIEW).toContain("const floor = stageOrder(stageFilter);");
    expect(VIEW).toContain("return list.filter((j) => stageOrder(j.currentStage) >= floor);");
    expect(VIEW).not.toContain("j.currentStage === stageFilter");
  });

  it("agrees stage by stage, for every shape of ladder", () => {
    // The invariant itself, run against the domain rather than asserted about
    // the source: for each stage, the funnel's count must equal the number of
    // journeys the view's predicate keeps. If summarizeFunnel ever stops being
    // cumulative, this fails here instead of in the UI.
    const ladders: JourneyStageKey[][] = [
      ["reached", "engaged", "identified", "nurtured", "converted", "retained"],
      ["converted", "converted", "reached"],
      ["retained"],
      [],
    ];
    for (const ladder of ladders) {
      const journeys = ladder.map((currentStage) => ({ currentStage }) as Journey);
      for (const stage of summarizeFunnel(journeys)) {
        const kept = journeys.filter((j) => stageOrder(j.currentStage) >= stageOrder(stage.key)).length;
        expect(kept).toBe(stage.count);
      }
    }
  });

  it("says the filter is cumulative, since that is not the obvious reading", () => {
    expect(VIEW).toContain("including those now further along");
    expect(VIEW).toContain('"No journeys have reached this stage."');
  });
});

describe("the empty list names the right emptiness", () => {
  it("does not blame a stage filter that is not set", () => {
    // What the live workspace actually showed: zero journeys, no stage picked,
    // and the words "No journeys in this stage."
    expect(VIEW).toContain('stageFilter === "all"');
    expect(VIEW).toContain("No journeys yet — one appears as soon as a customer has a recorded touch.");
  });

  it("keeps stage-specific wording for when a stage IS picked", () => {
    expect(VIEW).toContain('"No journeys have reached this stage."');
  });
});

/** Minimal PostgREST-shaped stub: every table returns `rows` empty contact rows. */
function stubClient(rows: number) {
  const data = Array.from({ length: rows }, (_, i) => ({
    id: `c${i}`,
    full_name: `Contact ${i}`,
    email: null,
    persona: null,
    created_at: "2026-08-01T00:00:00Z",
  }));
  const builder = (table: string) => {
    const result = { data: table === "contacts" ? data : [], error: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve(result),
      then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  return { from: builder } as unknown as Parameters<typeof getJourneysReadModel>[0];
}
