import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { ArcClient } from "../arc-client";
import { runTool, type StepFn } from "./helpers";
import { expectList } from "./expectations";

/** Read-only brain (knowledge graph) query. Available in all modes. */
export function brainReadTools(client: ArcClient, step: StepFn) {
  const queryBrain = tool(
    "query_brain",
    "Search the marketing brain (knowledge graph) for personas, segments, proof points, messaging angles, CTAs, learnings, and signals. All filters optional.",
    {
      kind: z.string().optional().describe("Node kind, e.g. persona | proof_point | learning | signal"),
      trust_tier: z.string().optional().describe("observed | proposed | trusted | rejected | archived"),
      persona: z.string().optional(),
      ref_table: z.string().optional(),
      ref_id: z.string().optional(),
      search: z.string().optional().describe("Free-text substring search across each node's title, body, and summary"),
    },
    async (args) =>
      runTool(
        step,
        "Searching the marketing brain",
        () => client.apiPost<{ nodes: unknown[] }>("/api/v1/arc/brain/query", args),
        { expect: expectList("nodes"), select: (r) => r.nodes },
      ),
  );

  return [queryBrain];
}

/**
 * Brain write tools (act/draft modes only). Records Arc's understanding as graph
 * nodes/edges. The app auto-gates trust: outbound-governing kinds (brand_fact,
 * messaging_angle, cta, proof_point) land as "proposed" (approval queue); all
 * other kinds (learning, signal, …) land as "observed" (internal). Arc never
 * sets the author or tier — the app forces author "arc".
 */
export function brainWriteTools(client: ArcClient, step: StepFn) {
  const recordBrainNote = tool(
    "record_brain_note",
    "Record a learning, signal, or insight in the marketing brain as a graph node. Use for durable knowledge worth remembering across chats. Outbound-governing kinds (brand_fact, messaging_angle, cta, proof_point) are auto-routed to human approval; learnings/signals are stored as internal observations.",
    {
      kind: z.string().describe("Node kind, e.g. learning | signal | persona | segment | proof_point"),
      label: z.string().describe("Short title for the node"),
      body: z.string().optional().describe("The full content/insight"),
      summary: z.string().optional(),
      persona: z.string().optional(),
      confidence: z.number().optional().describe("0-100"),
      ref_table: z.string().optional().describe("Pair with ref_id to link an existing CRM/campaign row"),
      ref_id: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) =>
      runTool(step, "Recording to the marketing brain", async () => {
        const r = await client.apiPost<{ id: string; kind: string }>("/api/v1/arc/brain/nodes", args);
        return r;
      }),
  );

  const linkBrainNodes = tool(
    "link_brain_nodes",
    "Create a relationship (edge) between two existing brain nodes.",
    {
      from_node_id: z.string(),
      to_node_id: z.string(),
      relation: z
        .enum([
          "responds_to",
          "governs",
          "proves",
          "targets",
          "relates_to",
          "learned_from",
          "used_in",
          "belongs_to",
          "competes_with",
        ])
        .describe("Edge relation type"),
      weight: z.number().optional(),
    },
    async (args) =>
      runTool(step, "Linking brain nodes", async () => {
        const r = await client.apiPost<{ id: string }>("/api/v1/arc/brain/edges", args);
        return r;
      }),
  );

  const proposeAudience = tool(
    "propose_audience",
    "Synthesize an AUDIENCE SEGMENT from CRM evidence and propose it for human approval. Use after query_brain / reading the CRM when you notice a cluster of records that share a pattern worth targeting (e.g. a persona + loss type + geography + behavior). Creates a `segment` node that lands in the approval queue (proposed) and links it to the persona it targets and the brain nodes that justify it. Pass evidence_node_ids you got from query_brain so the audience is grounded in real records. Nothing is trusted or actionable until a human approves — never treat a proposed audience as final.",
    {
      label: z.string().describe("Short name for the audience, e.g. 'Flood-prone Chicago landlords'"),
      summary: z.string().optional().describe("One line: who they are and why they're grouped"),
      criteria: z.string().optional().describe("The rule that defines membership"),
      persona: z.string().optional().describe("Persona key this audience targets, e.g. persona_landlord"),
      evidence_node_ids: z
        .array(z.string())
        .optional()
        .describe("Brain node ids (from query_brain results) that justify the audience"),
      tags: z.array(z.string()).optional(),
    },
    async (args) =>
      runTool(step, "Proposing an audience", async () => {
        const r = await client.apiPost<{ id: string; personaLinked: boolean; evidenceLinked: number }>(
          "/api/v1/arc/brain/audiences",
          args,
        );
        return r;
      }),
  );

  return [recordBrainNote, linkBrainNodes, proposeAudience];
}
