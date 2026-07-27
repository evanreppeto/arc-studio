import { describe, expect, it } from "vitest";

import { matchPersonaSlug, normalizePersonaSlug, personaInspectHref } from "../persona-links";

describe("persona deep links", () => {
  it("round-trips a mention href back to the persona it names", () => {
    const href = personaInspectHref("team-admin");
    expect(href).toBe("/personas?inspect=team-admin");

    const inspect = new URL(href, "https://example.test").searchParams.get("inspect");
    expect(matchPersonaSlug(inspect, ["ops-lead", "team-admin"])).toBe("team-admin");
  });

  it("accepts the record-key spelling CRM rows carry", () => {
    expect(matchPersonaSlug("persona_team_admin", ["team-admin"])).toBe("team-admin");
    expect(normalizePersonaSlug("PERSONA_Team_Admin")).toBe("team-admin");
  });

  it("returns undefined for a persona this workspace does not have", () => {
    // Personas are per-org: a key from another tenant must fall through to the
    // default rather than select an unrelated persona.
    expect(matchPersonaSlug("persona_homeowner_emergency", ["team-admin", "ops-lead"])).toBeUndefined();
    expect(matchPersonaSlug("", ["team-admin"])).toBeUndefined();
    expect(matchPersonaSlug(undefined, ["team-admin"])).toBeUndefined();
    expect(matchPersonaSlug("   ", ["team-admin"])).toBeUndefined();
  });

  it("escapes slugs that would break the query string", () => {
    expect(personaInspectHref("a&b=c")).toBe("/personas?inspect=a%26b%3Dc");
  });
});
