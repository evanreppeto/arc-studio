import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SETTINGS_VIEW = readFileSync(new URL("./settings-view.tsx", import.meta.url), "utf8");
const WORKSPACE_IDENTITY = readFileSync(new URL("./workspace-identity-modal.tsx", import.meta.url), "utf8");

describe("settings information architecture", () => {
  it("keeps unfinished behavior and notification controls out of primary settings", () => {
    expect(SETTINGS_VIEW).not.toContain('["behavior", "Behavior"]');
    expect(SETTINGS_VIEW).not.toContain('["notifications", "Notifications"]');
    expect(SETTINGS_VIEW).not.toContain("data-soon=");
  });

  it("names organization branding and workspace overrides honestly", () => {
    expect(SETTINGS_VIEW).toContain('["general", "Organization & brand"]');
    expect(SETTINGS_VIEW).toContain('label="Brand logo"');
    expect(WORKSPACE_IDENTITY).toContain("Sidebar logo override");
    expect(WORKSPACE_IDENTITY).toContain("Leave blank to use the organization’s brand logo.");
  });
});

describe("settings interaction semantics", () => {
  it("uses native buttons for navigation and interactive cards", () => {
    expect(SETTINGS_VIEW).toContain('className={`setitem${it[0] === cur ? " on" : ""}`}');
    // The `ovcard` row this used to assert on is gone: Overview's four tiles
    // restated the Workspace panel directly beneath them (Team twice, less
    // completely in the tile), so they were folded into it as rows. The rule
    // the assertion was protecting — native <button>, never role="button" —
    // still binds every remaining clickable, including those rows' buttons.
    expect(SETTINGS_VIEW).not.toContain('className="ovcard"');
    expect(SETTINGS_VIEW).toContain('type="button" className="ccard ccard-btn"');
    expect(SETTINGS_VIEW).not.toContain('role="button"');
  });

  it("routes runner shortcuts to the real Agent subtab", () => {
    expect(SETTINGS_VIEW).not.toContain('navTo("agent")');
    expect(SETTINGS_VIEW).toContain('navTo("general", "Agent")');
  });
});

describe("settings tells the truth about money and status", () => {
  it("shows the workspace's resolved plan cap, not the tier catalog's", () => {
    // `billing.capLabel` honours a negotiated `monthly_cap_cents` override;
    // `options[].capLabel` never can. Rendering the catalog printed "$2/mo
    // monthly cap" underneath a meter reading "6% of your $250 Free plan cap"
    // — on production, on one screen, and the wrong figure was the calm one.
    expect(SETTINGS_VIEW).toContain("const effectiveCapLabel = showingServerTier ? billing.capLabel : current.capLabel;");
    expect(SETTINGS_VIEW).not.toContain("{current.capLabel} monthly cap");
  });

  it("never renders an invented plan cap when the usage read fails", () => {
    // "$80" matched no tier we sell and was shown verbatim on any read failure.
    expect(SETTINGS_VIEW).not.toContain('capLabel: "$80"');
    // A failed read has to be distinguishable from a month with no spend.
    expect(SETTINGS_VIEW).toContain("const usageUnavailable = usage === null;");
  });

  it("does not report a failed read as a real figure on Overview", () => {
    // #1045 folded the overview tiles into Workspace rows, which re-homed two
    // figures that must not render a zero on failure: an unread team became
    // "0 members" (a workspace told it has nobody in it) and an unread usage
    // meter became "0% used" (a workspace told it has spent nothing).
    expect(SETTINGS_VIEW).toContain('{team.failed ? "Couldn’t be read"');
    expect(SETTINGS_VIEW).toContain('{usageUnavailable ? "Couldn’t be read"');
  });

  it("derives rail status dots instead of pinning them green", () => {
    // A permanently-green dot beside "Connections" while zero were active.
    expect(SETTINGS_VIEW).not.toContain('const DOTS: Record<string, string> = { connections: "var(--ok)"');
    expect(SETTINGS_VIEW).toContain("const dots: Record<string, string> = {");
  });

  it("keeps the Services panel's own grade honest", () => {
    // A hardcoded green "Live" chip sat above rows reading "Not connected".
    expect(SETTINGS_VIEW).not.toContain('<Panel title="Services" tag={<span className="tg ok">Live</span>}>');
  });

  it("does not decorate static panels with an Active chip", () => {
    // Nine panels — including the roles REFERENCE GUIDE — carried a green
    // "Active" tag that graded nothing and could never be false.
    expect(SETTINGS_VIEW).not.toContain("tag={TGOK}");
  });
});

describe("settings offers only controls that can work", () => {
  it("offers exactly the roles the server will accept", () => {
    // "Owner" led a hand-written list while changeWorkspaceMemberRole rejects
    // it unconditionally — a guaranteed error, and the Roles tab three tabs
    // away said so ("Granted at onboarding").
    expect(SETTINGS_VIEW).toContain("const ROLE_OPTIONS = ASSIGNABLE_WORKSPACE_ROLES.map((role) => roleLabel(role));");
    expect(SETTINGS_VIEW).not.toContain('const ROLE_OPTIONS = ["Owner"');
    // The invite popup used to carry its own third copy of the list.
    expect(SETTINGS_VIEW).not.toContain("<option>Admin</option><option>Marketer</option>");
  });

  it("does not invite you to connect a connector that isn't built", () => {
    expect(SETTINGS_VIEW).toContain('view.status === "unavailable"\n    ? "Details"');
  });

  it("has no button that navigates to the section it is already in", () => {
    // A gold "Open usage & billing" button sat on the Usage & billing page.
    expect(SETTINGS_VIEW).not.toContain("Open usage &amp; billing");
  });

  it("counts the Live connector tab including the email connection", () => {
    // The grid renders Resend alongside the connector rows, so counting only
    // `connectors` badged 15 while 16 cards were on screen.
    expect(SETTINGS_VIEW).toContain("Live: connectors.connectors.length + (emailConnection ? 1 : 0)");
  });

  it("uses the workspace's persona picker for every persona field", () => {
    // The weather connector's persona field was free text while the other
    // three were pickers, so only that one accepted a typo that fails silently
    // at detection time.
    expect(SETTINGS_VIEW).not.toMatch(/key: "persona",\s*\n\s*kind: "text"/);
  });
});

describe("settings speaks the customer's language", () => {
  it("keeps column names and API routes out of the UI", () => {
    // Matched on the rendered prop, not the file — the comment explaining the
    // removal necessarily quotes the string it removed.
    expect(SETTINGS_VIEW).not.toContain('foot="image_model / video_model · read by /api/v1/arc/media/generate-*"');
    // Every remaining mention must be inside a comment line.
    for (const line of SETTINGS_VIEW.split("\n")) {
      if (line.includes("image_model / video_model") || line.includes("/api/v1/arc/media/generate-*")) {
        expect(line.trim().startsWith("//") || line.trim().startsWith("*")).toBe(true);
      }
    }
  });

  it("labels a spend cap as a cap, never as a price", () => {
    // "Starter — $25/mo" reads as what the plan costs. It is the spend ceiling.
    expect(SETTINGS_VIEW).toContain("{optionFor(t)?.capLabel} cap");
    expect(SETTINGS_VIEW).toContain("{o.capLabel} cap");
  });

  it("does not point at a nav label that no longer exists", () => {
    expect(SETTINGS_VIEW).not.toContain("<b>industry</b> in <b>General</b>");
  });

  it("finds the controls people actually search for", () => {
    // "logo" and "postal" both returned "No settings match" — and a missing
    // postal address is what hard-blocks every outbound email, so the person
    // most in need of this search was the one it failed.
    expect(SETTINGS_VIEW).toMatch(/"general\/Email":[^\n]*postal/);
    expect(SETTINGS_VIEW).toMatch(/general:[^\n]*logo/);
    // Account gained a password-reset control; searching for it must reach it.
    expect(SETTINGS_VIEW).toMatch(/account:[^\n]*password/);
  });
});
