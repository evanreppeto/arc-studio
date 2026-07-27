import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  isSupabaseAdminConfigured: vi.fn(() => true),
  getSupabaseAdminClient: vi.fn(() => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subscription_status: null }, error: null }) }) }) }),
  })),
}));
vi.mock("@/lib/auth/workspace", () => ({ getCurrentWorkspaceContext: vi.fn() }));
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: vi.fn(() => false) }));
vi.mock("./entitlements", () => ({ resolveOrgPlan: vi.fn() }));

import { PLANS } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

import { resolveOrgPlan } from "./entitlements";
import { getSettingsBillingView } from "./settings-billing";

const cfg = vi.mocked(isSupabaseAdminConfigured);
const ctx = vi.mocked(getCurrentWorkspaceContext);
const plan = vi.mocked(resolveOrgPlan);

afterEach(() => vi.clearAllMocks());

describe("getSettingsBillingView", () => {
  it("returns a non-manageable default when Supabase isn't configured", async () => {
    cfg.mockReturnValue(false);
    const view = await getSettingsBillingView();
    expect(view.configured).toBe(false);
    expect(view.canManage).toBe(false);
    expect(view.options.length).toBeGreaterThan(0);
    expect(view.options.every((o) => o.capLabel.includes("/mo"))).toBe(true);
  });

  it("lets an owner/admin manage and reflects the resolved plan", async () => {
    cfg.mockReturnValue(true);
    ctx.mockResolvedValue({ orgId: "org-1", role: "admin" } as never);
    plan.mockResolvedValue({ tier: "pro", capCents: PLANS.pro.monthlyCapCents });
    const view = await getSettingsBillingView();
    expect(view).toMatchObject({ configured: true, canManage: true, tier: "pro", planLabel: "Pro" });
  });

  it("shows the plan read-only to a non-admin member", async () => {
    cfg.mockReturnValue(true);
    ctx.mockResolvedValue({ orgId: "org-1", role: "marketer" } as never);
    plan.mockResolvedValue({ tier: "starter", capCents: PLANS.starter.monthlyCapCents });
    const view = await getSettingsBillingView();
    expect(view.canManage).toBe(false);
    expect(view.tier).toBe("starter");
  });
});
