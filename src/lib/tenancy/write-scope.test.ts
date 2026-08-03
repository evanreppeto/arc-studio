import { describe, expect, it } from "vitest";

import { orgScopeFields, workspaceScopeFields } from "./write-scope";

/**
 * BSR-710. This helper replaced seven local copies of the same org-only tenant
 * builder — six private `orgTenantFields()` plus `campaignTenantFields` — every
 * one of which silently dropped `workspace_id`. That duplication is the biggest
 * single risk in the Group A migration, so the replacement is worth testing
 * directly rather than only through its callers.
 */

const SNAKE = { org_id: "org-1", workspace_id: "ws-1" };
const CAMEL = { orgId: "org-1", workspaceId: "ws-1" };

describe("workspaceScopeFields", () => {
  it("stamps both columns from either tenant shape", () => {
    // The app's write paths carry snake_case; the /api/v1 Arc routes carry
    // camelCase. Accepting both is what avoids a conversion at every call site.
    expect(workspaceScopeFields(SNAKE)).toEqual({ org_id: "org-1", workspace_id: "ws-1" });
    expect(workspaceScopeFields(CAMEL)).toEqual({ org_id: "org-1", workspace_id: "ws-1" });
  });

  it("throws rather than writing a partial tenant", () => {
    // During Phase A the column is still nullable, so returning {} would look
    // harmless and then fail for a customer the day Phase B lands. Failing here
    // names the caller while a nullable column is still absorbing the mistake.
    expect(() => workspaceScopeFields(undefined)).toThrow(/workspace-owned/);
    expect(() => workspaceScopeFields({ org_id: "org-1", workspace_id: "" })).toThrow(/workspace-owned/);
    expect(() => workspaceScopeFields({ orgId: "", workspaceId: "ws-1" })).toThrow(/workspace-owned/);
  });
});

describe("orgScopeFields", () => {
  it("deliberately drops the workspace for org-owned tables", () => {
    // contacts / companies / leads are shared across a company's workspaces by
    // design and have no workspace_id column — stamping one breaks the insert.
    expect(orgScopeFields(SNAKE)).toEqual({ org_id: "org-1" });
    expect(orgScopeFields(CAMEL)).toEqual({ org_id: "org-1" });
  });

  it("returns an empty object with no tenant, matching the copies it replaced", () => {
    expect(orgScopeFields(undefined)).toEqual({});
  });

  it("still yields the org when only that is resolvable", () => {
    expect(orgScopeFields({ org_id: "org-1", workspace_id: "" })).toEqual({ org_id: "org-1" });
  });
});
