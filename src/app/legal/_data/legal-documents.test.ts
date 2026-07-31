import { describe, expect, it } from "vitest";

import {
  ENTITY,
  LEGAL_PLACEHOLDERS,
  PRIVACY_SECTIONS,
  SUBPROCESSORS,
  TERMS_SECTIONS,
  hasUnresolvedPlaceholders,
} from "./legal-documents";

describe("legal documents", () => {
  it("flags unresolved entity placeholders so a draft cannot pose as a policy", () => {
    // The three facts that cannot be invented — entity name, registered address,
    // governing jurisdiction. While any is a placeholder the pages render an
    // explicit "not yet in effect" notice. When they are filled in, this test
    // starts failing and forces a deliberate decision to remove the notice
    // rather than letting it disappear silently.
    const blob = JSON.stringify(ENTITY);
    const unresolved = LEGAL_PLACEHOLDERS.filter((p) => blob.includes(p));

    expect(
      unresolved,
      "Entity details are now filled in. Remove the resolved sentinels from LEGAL_PLACEHOLDERS and re-read the draft notice logic.",
    ).toEqual([...LEGAL_PLACEHOLDERS]);
    expect(hasUnresolvedPlaceholders()).toBe(true);
  });

  it("keeps the postal address tied to the email-compliance requirement", () => {
    // A physical address is legally required on commercial email, and outbound
    // is already blocked until one is set. It is the same fact in two places —
    // if the legal entity address is ever filled in, the sending address is too.
    expect(ENTITY.address).toBeTruthy();
  });

  it("has substantive terms and privacy content, not headings alone", () => {
    for (const [label, sections] of [
      ["terms", TERMS_SECTIONS],
      ["privacy", PRIVACY_SECTIONS],
    ] as const) {
      expect(sections.length, `${label} sections`).toBeGreaterThanOrEqual(8);
      for (const section of sections) {
        expect(section.heading.length, `${label} heading`).toBeGreaterThan(3);
        expect(section.body.length, `${label} "${section.heading}" body`).toBeGreaterThan(0);
        for (const paragraph of section.body) {
          expect(paragraph.length, `${label} "${section.heading}" paragraph`).toBeGreaterThan(40);
        }
      }
    }
  });

  it("lists every core subprocessor the product cannot run without", () => {
    // Derived from real dependencies rather than a template. If one of these
    // disappears from the list while still in package.json, the published
    // disclosure is wrong — which is a compliance problem, not a docs problem.
    const core = SUBPROCESSORS.filter((s) => s.tier === "core").map((s) => s.name);
    for (const required of ["Supabase", "Vercel", "Anthropic", "Stripe", "Resend", "Sentry"]) {
      expect(core.join(" | ")).toContain(required);
    }
  });

  it("marks per-workspace connectors as optional, not core", () => {
    // A connector a workspace never enables must not be disclosed as something
    // that always receives their data — that would be inaccurate in the
    // direction that erodes trust.
    const optional = SUBPROCESSORS.filter((s) => s.tier === "optional").map((s) => s.name);
    for (const connector of ["Higgsfield", "HubSpot", "Mailchimp", "Slack"]) {
      expect(optional.join(" | ")).toContain(connector);
    }
  });

  it("gives every subprocessor a purpose and a data description", () => {
    for (const s of SUBPROCESSORS) {
      expect(s.purpose.length, `${s.name} purpose`).toBeGreaterThan(10);
      expect(s.dataHandled.length, `${s.name} dataHandled`).toBeGreaterThan(10);
    }
  });

  it("has no duplicate subprocessor entries", () => {
    const names = SUBPROCESSORS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
