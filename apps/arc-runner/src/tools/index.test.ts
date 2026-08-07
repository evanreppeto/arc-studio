import { describe, expect, it, vi } from "vitest";

import type { ArcClient } from "../arc-client";
import { resolveArcSkill } from "../skills";
import { ALWAYS_LOADED_REPLY_TOOLS, allowedToolNames, toolsForMode } from "./index";

// A stub client — the assembler only wires tools, it never calls these in the test.
const stubClient = {
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  postChatReply: vi.fn(),
  postStep: vi.fn(),
} as unknown as ArcClient;
const step = vi.fn(async () => {});
const sink = { card: () => {}, suggestion: () => {}, source: () => {}, question: () => {}, draft: () => {} };

const READ = [
  "search_companies",
  "search_contacts",
  "search_leads",
  "get_lead",
  "search_jobs",
  "search_outcomes",
  "search_properties",
  // Tenant-defined record types. READ, not write: `create_custom_record` is in
  // WRITE below, and this list is what caught it riding into ask mode.
  "list_record_types",
  "search_custom_records",
  // The custom-fields route shipped 2026-07-28 with no caller at all; on a
  // tenant-defined type its fields ARE the record, so this is not an extra.
  "read_custom_fields",
  "search_crm",
  "query_brain",
  "list_campaigns",
  "get_campaign",
  "list_approvals",
  "get_approval",
  "read_performance",
  "list_opportunities",
  "read_persona_intelligence",
  "list_vault_notes",
  "get_vault_note",
  "read_recent_activity",
  "list_media",
  "list_folders",
  "list_brand_documents",
  "read_brand_document",
  "research_web",
  "emit_card",
  "suggest_followups",
  "cite_sources",
  "ask_operator",
  "get_app_map",
  "get_workspace_settings",
];
const WRITE = ["record_brain_note", "link_brain_nodes", "propose_audience", "log_interaction", "create_lead", "update_record", "create_custom_record", "set_custom_record_stage", "save_custom_fields", "create_folder", "file_asset", "recommend_on_approval"];
const DRAFT = ["create_campaign_draft", "revise_campaign_asset", "submit_draft", "record_campaign_summary", "generate_image", "generate_video", "compose_creative", "edit_image", "submit_ad_variants", "analyze_website", "analyze_brand_design", "propose_brand_profile", "attach_media"];

describe("toolsForMode", () => {
  it("ask mode exposes only read tools (no writes)", () => {
    const names = toolsForMode("ask", stubClient, step, sink).map((t) => t.name).sort();
    expect(names).toEqual([...READ].sort());
  });

  it("act mode adds the write tools and draft work products", () => {
    const names = toolsForMode("act", stubClient, step, sink).map((t) => t.name).sort();
    expect(names).toEqual([...READ, ...WRITE, ...DRAFT].sort());
  });

  it("act mode can create drafts and generate images", () => {
    const names = toolsForMode("act", stubClient, step, sink).map((t) => t.name);
    expect(names).toContain("create_campaign_draft");
    expect(names).toContain("generate_image");
  });

  it("draft mode exposes the same tools as act", () => {
    const names = toolsForMode("draft", stubClient, step, sink).map((t) => t.name).sort();
    expect(names).toEqual([...READ, ...WRITE, ...DRAFT].sort());
  });

  it("ask mode excludes draft work products", () => {
    const names = toolsForMode("ask", stubClient, step, sink).map((t) => t.name);
    expect(names).not.toContain("create_campaign_draft");
    // Revising a live deliverable is a write, however small the edit.
    expect(names).not.toContain("revise_campaign_asset");
    expect(names).not.toContain("generate_image");
    expect(names).not.toContain("analyze_website");
    expect(names).not.toContain("analyze_brand_design");
    expect(names).not.toContain("propose_brand_profile");
  });

  it("scan mode includes propose_opportunity, record_competitor_intel, and read tools", () => {
    const names = toolsForMode("scan", stubClient, step, sink).map((t) => t.name);
    expect(names).toContain("propose_opportunity");
    expect(names).toContain("record_competitor_intel");
    // includes all read tools
    for (const r of READ) {
      expect(names).toContain(r);
    }
    // excludes draft/act write tools
    expect(names).not.toContain("create_campaign_draft");
    expect(names).not.toContain("submit_draft");
    expect(names).not.toContain("generate_image");
    expect(names).not.toContain("record_brain_note");
    expect(names).not.toContain("log_interaction");
  });

  it("narrows mode tools to the active skill allowlist", () => {
    const skill = resolveArcSkill("company-research");
    const names = toolsForMode("draft", stubClient, step, sink, { skill }).map((t) => t.name);

    expect(names).toContain("research_web");
    expect(names).toContain("cite_sources");
    expect(names).not.toContain("create_campaign_draft");
    expect(names).not.toContain("generate_image");
    expect(names).not.toContain("update_record");
  });
});

describe("allowedToolNames", () => {
  it("prefixes each tool with the mcp__arc__ namespace", () => {
    const allowed = allowedToolNames("ask");
    expect(allowed).toContain("mcp__arc__search_leads");
    expect(allowed.every((n) => n.startsWith("mcp__arc__"))).toBe(true);
  });
  it("ask excludes write tools; act includes them", () => {
    expect(allowedToolNames("ask")).not.toContain("mcp__arc__log_interaction");
    expect(allowedToolNames("act")).toContain("mcp__arc__log_interaction");
  });
  it("scan includes propose_opportunity and excludes draft write tools", () => {
    const allowed = allowedToolNames("scan");
    expect(allowed).toContain("mcp__arc__propose_opportunity");
    expect(allowed).not.toContain("mcp__arc__create_campaign_draft");
    expect(allowed).not.toContain("mcp__arc__generate_image");
  });

  it("prefixes skill-narrowed allowed tools for the SDK", () => {
    const allowed = allowedToolNames("draft", resolveArcSkill("company-research"));

    expect(allowed).toContain("mcp__arc__research_web");
    expect(allowed).toContain("mcp__arc__cite_sources");
    expect(allowed).not.toContain("mcp__arc__create_campaign_draft");
  });

  it("exposes get_app_map and get_workspace_settings in every mode", () => {
    for (const mode of ["ask", "scan", "act", "draft"] as const) {
      const allowed = allowedToolNames(mode);
      expect(allowed).toContain("mcp__arc__get_app_map");
      expect(allowed).toContain("mcp__arc__get_workspace_settings");
    }
  });
});

/**
 * BSR-737. The SDK applies `tool({ alwaysLoad: true })` as
 * `_meta["anthropic/alwaysLoad"]`, which is why this asserts on the wire shape
 * rather than on an option we passed — a future SDK that renamed the key would
 * silently stop pinning these, and nothing else in the suite would notice.
 */
const alwaysLoaded = (t: { _meta?: Record<string, unknown> }) =>
  t._meta?.["anthropic/alwaysLoad"] === true;

describe("reply-assembly tools are never deferred behind tool search", () => {
  it("pins emit_card, cite_sources and suggest_followups in every mode", () => {
    // Drop the flag from any one of them and Arc calls it from the prompt's prose
    // with no schema loaded, gets an argument-validation error, and burns a
    // ToolSearch round-trip recovering — on the critical path to the reply.
    for (const mode of ["ask", "scan", "act", "draft"] as const) {
      const byName = new Map(toolsForMode(mode, stubClient, step, sink).map((t) => [t.name, t]));
      for (const name of ALWAYS_LOADED_REPLY_TOOLS) {
        expect(byName.get(name), `${name} missing in ${mode} mode`).toBeDefined();
        expect(alwaysLoaded(byName.get(name)!), `${name} not pinned in ${mode} mode`).toBe(true);
      }
    }
  });

  it("leaves everything else deferred, so tool search still earns its keep", () => {
    // The failure this catches is the over-correction: pinning the whole server
    // (or reaching for the server-level `alwaysLoad`) puts ~50 schemas in every
    // prompt and makes tool search pointless.
    const pinned = toolsForMode("act", stubClient, step, sink).filter(alwaysLoaded).map((t) => t.name).sort();
    expect(pinned).toEqual([...ALWAYS_LOADED_REPLY_TOOLS].sort());
  });

  it("does not pin ask_operator", () => {
    // It fires only when Arc needs a decision, so it is a genuine deferral
    // candidate — unlike the three above, which run on essentially every turn.
    const ask = toolsForMode("act", stubClient, step, sink).find((t) => t.name === "ask_operator");
    expect(ask).toBeDefined();
    expect(alwaysLoaded(ask!)).toBe(false);
  });
});
