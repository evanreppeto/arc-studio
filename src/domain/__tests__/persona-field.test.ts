import { describe, expect, it } from "vitest";

import { CompanyRowSchema } from "../companies";
import { ContactRowSchema } from "../contacts";
import { JobRowSchema } from "../jobs";
import { LeadRowSchema } from "../leads";
import { OutcomeRowSchema } from "../outcomes";
import { OFFICIAL_PERSONA_MAPPINGS } from "../personas";
import { PropertyRowSchema } from "../properties";

/**
 * Every CRM row schema must accept the tenant's OWN persona (BSR-684).
 *
 * `persona` is a `text` column, not the `persona_mapping` enum, because personas
 * have been per-org since migration 20260713120000. Five of these schemas still
 * validated it against the twelve OFFICIAL_PERSONA_MAPPINGS, so a tenant's own
 * persona slug threw on read.
 *
 * The symptom was a 502 on every row-returning `search_contacts` call while
 * `limit=0` count calls returned 200 — because a count never parses a row. On
 * prod that read as an empty CRM holding 243 contacts, and Arc reported it as
 * one. LeadRowSchema had already been fixed; the others had not been swept.
 */
const ROW_SCHEMAS = [
  ["ContactRowSchema", ContactRowSchema],
  ["CompanyRowSchema", CompanyRowSchema],
  ["JobRowSchema", JobRowSchema],
  ["OutcomeRowSchema", OutcomeRowSchema],
  ["PropertyRowSchema", PropertyRowSchema],
  ["LeadRowSchema", LeadRowSchema],
] as const;

/** Real per-org slugs in use on prod, which are not in OFFICIAL_PERSONA_MAPPINGS. */
const PER_ORG_PERSONAS = ["emergency-homeowner", "past-restoration-client", "property-manager", "insurance-partner"];

describe("persona is a per-org string on every CRM row schema", () => {
  for (const [name, schema] of ROW_SCHEMAS) {
    describe(name, () => {
      const field = schema.shape.persona;

      it.each(PER_ORG_PERSONAS)("accepts the tenant's own persona %s", (persona) => {
        expect(field.safeParse(persona).success).toBe(true);
      });

      it("still accepts the legacy official mappings", () => {
        for (const persona of OFFICIAL_PERSONA_MAPPINGS) {
          expect(field.safeParse(persona).success).toBe(true);
        }
        expect(field.safeParse("unassigned_persona").success).toBe(true);
      });

      it("still rejects an absent persona", () => {
        // Widening to a string must not become "anything goes" — a row with no
        // persona is a data fault and should still fail loudly.
        expect(field.safeParse("").success).toBe(false);
        expect(field.safeParse("   ").success).toBe(false);
        expect(field.safeParse(null).success).toBe(false);
        expect(field.safeParse(undefined).success).toBe(false);
      });
    });
  }
});
