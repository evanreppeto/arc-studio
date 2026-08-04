import { describe, expect, it } from "vitest";

import {
  arcToolLabel,
  humanizeIdentifier,
  recallKindLabel,
  runModeLabel,
  runRouteLabel,
  runStatusLabel,
  toolStatusLabel,
} from "../vocabulary";

/**
 * The Arc run-detail page is reachable by any signed-in customer from their own
 * chat, and it rendered stored identifiers verbatim (BSR-655). These are the
 * values that actually exist — censused from prod `arc_messages.metadata` on
 * 2026-08-03, not invented for the test.
 */

describe("humanizeIdentifier", () => {
  it("strips the MCP protocol prefix a tool name arrives with", () => {
    expect(humanizeIdentifier("mcp__arc__search_contacts")).toBe("Search contacts");
    expect(humanizeIdentifier("mcp__arc__create_campaign_draft")).toBe("Create campaign draft");
  });

  it("splits camelCase as well as snake_case", () => {
    expect(humanizeIdentifier("ToolSearch")).toBe("Tool search");
    expect(humanizeIdentifier("demo_beats_discount")).toBe("Demo beats discount");
  });

  it("keeps acronyms upper-case instead of sentence-casing them", () => {
    expect(humanizeIdentifier("crm_lead")).toBe("CRM lead");
    expect(humanizeIdentifier("sms")).toBe("SMS");
  });

  it("never returns an empty string for a non-empty identifier", () => {
    // A value that is nothing but separators would otherwise humanize to "".
    expect(humanizeIdentifier("__")).toBe("__");
    expect(humanizeIdentifier("_")).toBe("_");
  });
});

describe("run field labels", () => {
  it("names the statuses the run page can render", () => {
    expect(runStatusLabel("complete")).toBe("Finished");
    expect(runStatusLabel("failed")).toBe("Failed");
    expect(runStatusLabel("pending")).toBe("Still running");
  });

  it("returns null for an absent mode or route so the kicker can omit it", () => {
    // Half of prod's runs predate these fields; the page must not print "—".
    expect(runModeLabel(null)).toBeNull();
    expect(runModeLabel(undefined)).toBeNull();
    expect(runRouteLabel(null)).toBeNull();
  });

  it("maps the modes and routes that exist", () => {
    expect(runModeLabel("ask")).toBe("Answering a question");
    expect(runModeLabel("act")).toBe("Doing work");
    expect(runModeLabel("draft")).toBe("Drafting");
    expect(runRouteLabel("fast")).toBe("Fast model");
    expect(runRouteLabel("standard")).toBe("Standard model");
  });

  /**
   * The important property. `route` is typed `"fast" | "standard"` and the demo
   * fixture already carries `"chat"`; the runner adds Brain node kinds without
   * asking the app. An exhaustive lookup would render undefined on the first
   * value nobody predicted — which is how the raw key got on screen originally.
   */
  it("falls back to a humanized form for values not in the map", () => {
    expect(runRouteLabel("chat")).toBe("Chat");
    expect(runStatusLabel("some_new_state")).toBe("Some new state");
    expect(recallKindLabel("brand_voice_note")).toBe("Brand voice note");
    expect(toolStatusLabel("timed_out")).toBe("Timed out");
  });

  it("names every recall kind present in prod", () => {
    const censused = [
      "learning",
      "crm_lead",
      "campaign_ref",
      "persona",
      "signal",
      "crm_job",
      "proof_point",
      "crm_contact",
      "messaging_angle",
      "crm_outcome",
      "crm_company",
      "arc",
    ];
    for (const kind of censused) {
      const label = recallKindLabel(kind);
      expect(label).not.toContain("_");
      expect(label).not.toBe(kind);
    }
  });

  it("describes a missing kind rather than printing nothing", () => {
    expect(recallKindLabel(undefined)).toBe("Memory");
  });
});

describe("tool labels", () => {
  it("renames every tool name recorded in prod away from its protocol prefix", () => {
    const censused = [
      "mcp__arc__search_contacts",
      "mcp__arc__get_workspace_settings",
      "mcp__arc__suggest_followups",
      "mcp__arc__create_campaign_draft",
      "mcp__arc__emit_card",
      "mcp__arc__generate_image",
      "mcp__arc__cite_sources",
      "mcp__arc__list_opportunities",
      "mcp__arc__query_brain",
      "ToolSearch",
    ];
    for (const name of censused) {
      const label = arcToolLabel(name);
      expect(label).not.toContain("mcp__");
      expect(label).not.toContain("_");
    }
  });

  it("maps tool outcomes to the same words the run status uses", () => {
    expect(toolStatusLabel("complete")).toBe("Done");
    expect(toolStatusLabel("error")).toBe("Failed");
    expect(toolStatusLabel("running")).toBe("Running");
  });
});
