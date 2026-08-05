import { describe, expect, it } from "vitest";

import { ARC_SYSTEM_PROMPT } from "./prompt";
import { ALWAYS_INSTRUCTED_TOOLS, ARC_SKILLS, resolveArcSkill } from "./skills";
import { ALWAYS_LOADED_REPLY_TOOLS } from "./tools";

describe("Arc skill registry", () => {
  it("ships broad, company-agnostic skills that grant tools by allowlist", () => {
    const skill = resolveArcSkill("company-research");

    expect(skill).toMatchObject({
      id: "company-research",
      businessAgnostic: true,
      approvalPolicy: "propose_only",
    });
    expect(skill?.allowedTools).toContain("research_web");
    expect(skill?.allowedTools).toContain("cite_sources");
    expect(skill?.allowedTools).not.toContain("create_campaign_draft");
  });

  it("resolves nullish skill ids without narrowing the base mode tools", () => {
    expect(resolveArcSkill(undefined)).toBeNull();
    expect(resolveArcSkill(null)).toBeNull();
  });

  it("rejects unknown skill ids so bad payloads do not accidentally expand access", () => {
    expect(() => resolveArcSkill("restoration-only-secret-skill")).toThrow(/Unknown Arc skill/);
  });

  it("keeps every registered skill business agnostic", () => {
    expect(ARC_SKILLS.length).toBeGreaterThan(0);
    expect(ARC_SKILLS.every((skill) => skill.businessAgnostic)).toBe(true);
  });

  /**
   * The general form of BSR-759: an instruction with no tool behind it fails as
   * a polite refusal, not an error, so nothing sees it but a real run.
   *
   * A skill is *supposed* to narrow the toolset, so most of what the system
   * prompt names is legitimately absent from a given skill. These four are not:
   * they are instructed on every turn regardless of task, and none can reach the
   * outside world.
   */
  it("grants every skill the tools the system prompt instructs on every turn", () => {
    for (const skill of ARC_SKILLS) {
      for (const tool of ALWAYS_INSTRUCTED_TOOLS) {
        expect(skill.allowedTools, `${skill.id} does not grant ${tool}`).toContain(tool);
      }
    }
  });

  it("keeps the always-instructed list honest about what the prompt actually says", () => {
    // Guards the other direction: this list is only legitimate while the prompt
    // really does name these on every turn. Drop the instruction and the entry
    // should go with it, rather than quietly widening every skill forever.
    for (const tool of ALWAYS_INSTRUCTED_TOOLS) {
      expect(ARC_SYSTEM_PROMPT, `${tool} is granted everywhere but the prompt no longer names it`).toContain(tool);
    }
  });

  it("never pins a reply tool past tool search that a skill then filters out", () => {
    // ALWAYS_LOADED_REPLY_TOOLS exists because the prompt calls these from prose
    // with no schema fetch. Pinning one and then deleting it in a skill is the
    // same contradiction one layer down — skill-authoring dropped cite_sources.
    for (const skill of ARC_SKILLS) {
      for (const tool of ALWAYS_LOADED_REPLY_TOOLS) {
        expect(skill.allowedTools, `${skill.id} filters out pinned reply tool ${tool}`).toContain(tool);
      }
    }
  });

  it("lets background work write to the Brain, not just chat", () => {
    // `promoteConversationMemory` runs only on chat turns (arc.ts), so for a
    // campaign task or an opportunity scan `record_brain_note` is the ONLY way
    // anything learned survives the run. No skill granted it, so the proactive
    // work — the work meant to compound — started from a blank slate every time.
    for (const id of ["opportunity-discovery", "approval-gated-drafting", "campaign-package-drafting"]) {
      expect(resolveArcSkill(id)?.allowedTools, `${id} cannot record what it learned`).toContain("record_brain_note");
    }
  });

  it("lets a drafting skill document a campaign without minting a deliverable", () => {
    // BSR-677. record_campaign_summary writes metadata only; without it the sole
    // way to record an objective or a handoff note is create_campaign_draft,
    // which puts an asset nobody intends to send into the approval queue.
    for (const id of ["approval-gated-drafting", "campaign-package-drafting"]) {
      expect(resolveArcSkill(id)?.allowedTools).toContain("record_campaign_summary");
    }
  });

  it("gives the campaign-wake skill the performance read its own prompt demands", () => {
    // "call read_performance and cite real figures — never fabricate metrics."
    expect(resolveArcSkill("approval-gated-drafting")?.allowedTools).toContain("read_performance");
  });

  it("registers a propose-only authoring skill for /create-skill", () => {
    const skill = resolveArcSkill("skill-authoring");

    expect(skill).toMatchObject({
      id: "skill-authoring",
      approvalPolicy: "propose_only",
    });
    expect(skill?.allowedTools).toContain("ask_operator");
    expect(skill?.allowedTools).not.toContain("create_campaign_draft");
  });

  it("grants approval-gated drafting the compositor its own prompt sends branding revisions to", () => {
    const skill = resolveArcSkill("approval-gated-drafting");

    // Every campaign task — including an operator's asset revision — is woken
    // with this skill. The prompt routes "put our logo / phone number / any
    // words on this image" to compose_creative and explicitly forbids solving it
    // by regenerating the background. Dropping it from the allowlist made that
    // instruction unsatisfiable: three stranded revisions on prod ran to
    // completion and revised nothing (BSR-759).
    expect(skill?.allowedTools).toContain("compose_creative");
    expect(skill?.allowedTools).toContain("generate_image");
    // The boundary that matters is outbound, and it is unchanged: compose_creative
    // lands its result through /campaigns/draft-asset as an approval-gated draft.
    expect(skill?.approvalPolicy).toBe("approval_gated_drafts");
  });

  it("grants approval-gated drafting the copy write path a revision needs", () => {
    const skill = resolveArcSkill("approval-gated-drafting");

    // The other half of BSR-759. Adding compose_creative fixed image revisions;
    // a copy revision ("use our real 24/7 number") still had no tool that could
    // write to an existing asset, so it ran to `completed` having changed
    // nothing. Without this entry the tool exists and the skill deletes it,
    // which fails as a polite refusal rather than as an error.
    expect(skill?.allowedTools).toContain("revise_campaign_asset");
    expect(skill?.approvalPolicy).toBe("approval_gated_drafts");
  });

  it("registers an approval-gated campaign-package skill that drafts but does not generate media", () => {
    const skill = resolveArcSkill("campaign-package-drafting");

    expect(skill).toMatchObject({
      id: "campaign-package-drafting",
      businessAgnostic: true,
      approvalPolicy: "approval_gated_drafts",
    });
    expect(skill?.allowedTools).toContain("create_campaign_draft");
    expect(skill?.allowedTools).toContain("attach_media");
    // Boundary: net-new media generation stays with the broader drafting skill.
    expect(skill?.allowedTools).not.toContain("generate_image");
    expect(skill?.allowedTools).not.toContain("generate_video");
  });
});
