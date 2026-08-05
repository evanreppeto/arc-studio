import { describe, expect, it } from "vitest";

import { ARC_SKILLS, resolveArcSkill } from "./skills";

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
