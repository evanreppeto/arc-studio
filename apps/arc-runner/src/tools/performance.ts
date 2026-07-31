import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";
import { enforce, expectList } from "./expectations";

/** Read-only performance signals so Arc can cite what's actually working. Available in all modes. */
export function performanceReadTools(client: ArcClient, step: StepFn) {
  const readPerformance = tool(
    "read_performance",
    "Read real campaign performance ('what's working') aggregated by persona, channel, or asset_type — job/win counts, leads, ROAS, CPL, CTR, and sample size. Call this BEFORE recommending a next iteration or drafting for a persona/channel you have history on, and cite the numbers. Never invent metrics; if it returns no slices, say there's no performance data yet.",
    {
      dimension: z.string().optional().describe("persona | channel | asset_type (default persona)"),
      days: z.number().optional().describe("lookback window in days (default 90)"),
      persona: z.string().optional(),
      channel: z.string().optional(),
    },
    async (args) =>
      runTool(step, "Reading performance", async () => {
        const r = await client.apiGet<{ dimension?: string; slices?: unknown[] }>("/api/v1/arc/performance", {
          dimension: args.dimension,
          days: args.days,
          persona: args.persona,
          channel: args.channel,
        });
        enforce(r, expectList("slices"));
        return { dimension: r.dimension, slices: r.slices };
      }),
  );

  return [readPerformance];
}
