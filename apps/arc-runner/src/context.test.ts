import { describe, expect, it } from "vitest";

import { NEUTRAL_CONTEXT } from "./business-context";
import { buildSystemPrompt, formatHistory, type ArcTurnContext } from "./context";
import { resolveArcSkill } from "./skills";

const baseCtx: ArcTurnContext = {
  business: NEUTRAL_CONTEXT,
  mode: "ask",
  scope: { conversationId: "c1", projectId: null, campaignId: null, operator: "Evan" },
  mentions: [],
};

describe("formatHistory", () => {
  it("returns empty string for no turns", () => {
    expect(formatHistory(undefined)).toBe("");
    expect(formatHistory([])).toBe("");
  });
  it("renders operator and arc turns in order with a header", () => {
    const out = formatHistory([
      { role: "operator", body: "find me leads" },
      { role: "arc", body: "Found 3." },
    ]);
    expect(out).toContain("Conversation so far");
    expect(out.indexOf("find me leads")).toBeLessThan(out.indexOf("Found 3."));
    expect(out).toContain("Operator:");
    expect(out).toContain("Arc:");
  });
  it("prepends the compacted summary ahead of the verbatim turns", () => {
    const out = formatHistory([{ role: "operator", body: "and the SMS?" }], "Operator is planning a storm campaign.");
    expect(out).toContain("CONVERSATION SUMMARY (earlier turns");
    expect(out).toContain("storm campaign");
    // summary comes before the recent turns
    expect(out.indexOf("CONVERSATION SUMMARY")).toBeLessThan(out.indexOf("Conversation so far"));
  });
  it("renders just the summary when there are no verbatim turns", () => {
    const out = formatHistory([], "Prior context.");
    expect(out).toContain("Prior context.");
    expect(out).not.toContain("Conversation so far");
  });
});

describe("buildSystemPrompt", () => {
  it("includes the base prompt and the business name", () => {
    const out = buildSystemPrompt("BASE_PROMPT", baseCtx);
    expect(out).toContain("BASE_PROMPT");
    expect(out).toContain(NEUTRAL_CONTEXT.businessName);
  });
  it("states read-only stance for ask mode and points to act mode for work", () => {
    const out = buildSystemPrompt("BASE", { ...baseCtx, mode: "ask" });
    expect(out.toLowerCase()).toContain("read-only");
    // The dead-end fix: ask mode should guide the operator to Act instead of a bare refusal.
    expect(out.toLowerCase()).toContain("capability control");
    expect(out).toContain("Work");
  });
  it("includes the persona taxonomy", () => {
    const out = buildSystemPrompt("BASE", baseCtx);
    expect(out).toContain("persona_homeowner_emergency");
    expect(out).toContain("Emergency Homeowner");
  });
  it("act mode can create CRM records and approval-gated drafts, matching the tool grants", () => {
    const out = buildSystemPrompt("BASE", { ...baseCtx, mode: "act" });
    expect(out).toContain("MODE: act");
    // Act has the same capabilities as draft (tools/index.ts), so its mode text must
    // not tell Arc to refuse drafting — that contradiction is what made Arc say
    // "switch to draft mode" when it already held create_campaign_draft.
    expect(out.toLowerCase()).toContain("create_lead");
    expect(out.toLowerCase()).toContain("draft");
    expect(out.toLowerCase()).toContain("approval");
    expect(out).not.toMatch(/may not[^.]*\bdraft/i);
  });
  it("permits drafts in draft mode and never outbound", () => {
    const out = buildSystemPrompt("BASE", { ...baseCtx, mode: "draft" });
    expect(out.toLowerCase()).toContain("draft");
    expect(out.toLowerCase()).toContain("approval");
  });
  it("names the project and campaign when scoped", () => {
    const out = buildSystemPrompt("BASE", {
      ...baseCtx,
      scope: { conversationId: "c1", projectId: "p1", campaignId: "camp1", operator: "Evan" },
    });
    expect(out).toContain("p1");
    expect(out).toContain("camp1");
  });
  it("lists mentions when present", () => {
    const out = buildSystemPrompt("BASE", {
      ...baseCtx,
      mentions: [{ type: "lead", id: "L1", label: "Dana Kasprak", href: "/crm/leads/L1" }],
    });
    expect(out).toContain("Dana Kasprak");
  });
  it("includes behavior hints when provided", () => {
    const out = buildSystemPrompt("BASE", { ...baseCtx, assistantTone: "warm", assistantResponseStyle: "concise" });
    expect(out).toContain("warm");
    expect(out).toContain("concise");
  });
  it("includes the active skill instructions and output contract", () => {
    const out = buildSystemPrompt("BASE", { ...baseCtx, skill: resolveArcSkill("company-research") });

    expect(out).toContain("ACTIVE SKILL: Company research");
    expect(out).toContain("business-agnostic");
    expect(out).toContain("Return source-backed findings");
    expect(out).toContain("Allowed tools for this skill");
    expect(out).toContain("research_web");
  });

  it("injects an operator-locked media model as a firm default", () => {
    const out = buildSystemPrompt("BASE", {
      ...baseCtx,
      mediaConfig: {
        defaults: {
          image: { id: "nano_banana_pro", label: "Nano Banana Pro", provider: "Google", explicit: true },
          video: { id: "veo3_1", label: "Google Veo 3.1", provider: "Google", explicit: true },
          audio: null,
        },
        autoPick: false,
        allowVideo: true,
        preferRealMedia: true,
        defaultAspect: "9:16",
      },
    });
    expect(out).toContain("MEDIA MODEL DEFAULTS");
    // Stated as the value of Higgsfield's REQUIRED `model` argument, not as a
    // preference — a preference is what Arc was free to absorb and ignore.
    expect(out).toContain('pass model: "nano_banana_pro"');
    expect(out).toContain("locked this model for the workspace");
    expect(out).toContain('pass model: "veo3_1"');
    expect(out).toContain("9:16");
  });

  it("lets the operator's pick for THIS turn beat the workspace default", () => {
    const out = buildSystemPrompt("BASE", {
      ...baseCtx,
      mediaConfig: {
        defaults: {
          image: { id: "nano_banana_pro", label: "Nano Banana Pro", provider: "Google", explicit: true },
          video: { id: "veo3_1", label: "Google Veo 3.1", provider: "Google", explicit: true },
          audio: null,
        },
        autoPick: false,
        allowVideo: true,
        preferRealMedia: true,
        defaultAspect: "9:16",
      },
      mediaPick: { key: "higgsfield:kling3_0", engine: "higgsfield", id: "kling3_0", category: "video", label: "Kling 3.0" },
    });
    expect(out).toContain('pass model: "kling3_0"');
    expect(out).toContain("chose this model for THIS message");
    // The pick is per-CATEGORY: image keeps the workspace default.
    expect(out).toContain('pass model: "nano_banana_pro"');
    expect(out).not.toContain('pass model: "veo3_1"');
  });

  it("never names a Gemini pick to Arc — that engine is pinned server-side", () => {
    // Naming it here would invite Arc to pass an id Higgsfield has never heard of.
    const out = buildSystemPrompt("BASE", {
      ...baseCtx,
      mediaConfig: {
        defaults: {
          image: { id: "nano_banana_pro", label: "Nano Banana Pro", provider: "Google", explicit: false },
          video: null,
          audio: null,
        },
        autoPick: true,
        allowVideo: true,
        preferRealMedia: true,
        defaultAspect: "4:5",
      },
      mediaPick: { key: "gemini:gemini-3-pro-image", engine: "gemini", id: "gemini-3-pro-image", category: "image", label: "Gemini 3 Pro Image" },
    });
    expect(out).not.toContain("gemini-3-pro-image");
    expect(out).toContain('pass model: "nano_banana_pro"');
  });

  it("tells Arc not to generate video when the operator disabled it", () => {
    const out = buildSystemPrompt("BASE", {
      ...baseCtx,
      mediaConfig: {
        defaults: {
          image: { id: "marketing_studio_image", label: "Marketing Studio Image", provider: "Higgsfield", explicit: false },
          video: null,
          audio: null,
        },
        autoPick: true,
        allowVideo: false,
        preferRealMedia: true,
        defaultAspect: "4:5",
      },
    });
    expect(out).toContain("Video: DISABLED");
    expect(out).toContain("Arc's pick");
  });

  it("omits the media block entirely when no media config is present", () => {
    expect(buildSystemPrompt("BASE", baseCtx)).not.toContain("MEDIA MODEL DEFAULTS");
  });
});
