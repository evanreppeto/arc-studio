import { describe, expect, it } from "vitest";

import { auditActionLabel } from "./workspace-audit";

describe("auditActionLabel", () => {
  it("maps known workspace actions to friendly labels", () => {
    expect(auditActionLabel("member.role_changed")).toBe("Role changed");
    expect(auditActionLabel("invite.created")).toBe("Invite created");
    expect(auditActionLabel("member.removed")).toBe("Member removed");
  });

  it("labels the identity actions, including the retired rename", () => {
    // The fallback humanizer turns "workspace.identity_updated" into
    // "Workspace identity updated" too — but only by luck of the key's wording.
    // Pinning it keeps the feed readable if the action key is ever reworded.
    expect(auditActionLabel("workspace.identity_updated")).toBe("Workspace identity updated");
    // No longer emitted (updateWorkspaceIdentity replaced the coupled rename),
    // but historical rows still carry it.
    expect(auditActionLabel("workspace.renamed")).toBe("Workspace renamed");
  });

  it("humanizes unknown actions instead of showing the raw key", () => {
    expect(auditActionLabel("campaign.published")).toBe("Campaign published");
  });
});
