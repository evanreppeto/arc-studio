/**
 * A failed brand read must not present placeholder defaults as the tenant's
 * brand (BSR-578).
 *
 * The worst of the three, because it does not show an operator nothing — it
 * shows them NEUTRAL_DEFAULTS, which look like a real brand kit. `/studio`
 * consumes the same view for its accent swatches, under a note saying they come
 * from the Brand kit, so Arc can draft creative against colours, a logo and a
 * voice that are not theirs with nothing on screen saying so.
 *
 * The distinction being tested is the one the old `.catch(() => null)` erased:
 * "no profile saved yet" is TRUE for a new workspace and keeps the neutral
 * defaults; "the read failed" is not.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabase/server", () => ({ isSupabaseAdminConfigured: () => true }));
vi.mock("@/lib/demo/demo-mode", () => ({ isDemoDataEnabled: () => false }));
vi.mock("@/lib/observability/report-degraded", () => ({ reportDegraded: vi.fn() }));
vi.mock("@/lib/settings/store", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/branding/logo", () => ({ resolveWorkspaceLogoUrl: () => null }));

const shouldThrow = { value: true };

vi.mock("./persistence", () => ({
  getBusinessProfile: async () => {
    if (shouldThrow.value) throw new Error("brand_profiles lookup failed");
    return null;
  },
  listBrandSources: async () => [],
}));

afterEach(() => vi.clearAllMocks());

describe("brand kit", () => {
  it("says so when the read fails, rather than showing placeholder colours as yours", async () => {
    shouldThrow.value = true;
    const { getBrandProfileView } = await import("./profile-view");
    const view = await getBrandProfileView("org-1", "Acme");

    expect(view.failed).toBeTruthy();
    expect(view.failed).toContain("brand_profiles");
  });

  it("reports the failure so it is findable, not just visible", async () => {
    shouldThrow.value = true;
    const { reportDegraded } = await import("@/lib/observability/report-degraded");
    const { getBrandProfileView } = await import("./profile-view");
    await getBrandProfileView("org-1", "Acme");
    expect(reportDegraded).toHaveBeenCalled();
  });

  it("stays silent for a workspace that simply has no brand kit yet", async () => {
    // The other half of the contract. Most new tenants are in this state, and
    // warning them about a failure that did not happen would train them to
    // ignore the banner for the time it does.
    shouldThrow.value = false;
    const { getBrandProfileView } = await import("./profile-view");
    const view = await getBrandProfileView("org-1", "Acme");
    expect(view.failed).toBeNull();
  });
});
