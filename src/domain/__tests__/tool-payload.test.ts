import { describe, expect, it } from "vitest";

import { redactToolPayload, summarizeToolPayload } from "../tool-payload";

/**
 * BSR-724. The payload shapes below were censused from prod
 * `arc_messages.metadata->toolCalls` on 2026-08-04, with ids and names altered.
 * The awkward ones are the point: most outputs sit exactly at the runner's
 * 400-character cap and are therefore cut mid-token, and some are not JSON at
 * all.
 */

describe("redactToolPayload", () => {
  it("removes contact details a tool returned", () => {
    expect(redactToolPayload('{"phone":"(312) 545-3376"}')).toBe('{"phone":"[phone]"}');
    expect(redactToolPayload('{"phone":"312-545-3376"}')).toBe('{"phone":"[phone]"}');
    expect(redactToolPayload('{"email":"a.arredondo@example.com"}')).toBe('{"email":"[email]"}');
    expect(redactToolPayload('{"addr":"1240 West Fulton Street"}')).toBe('{"addr":"[address]"}');
  });

  /**
   * The failure mode that would make this worse than useless. Prod payloads are
   * dense with UUIDs and dates; an unfenced phone pattern eats digit runs out of
   * both, and redacting an id is its own way of lying about the evidence.
   */
  it("does not fire inside a UUID, a date, or an id", () => {
    const uuid = '{"id":"02a05c97-5f0d-4ab7-8440-8d1c213fa847"}';
    expect(redactToolPayload(uuid)).toBe(uuid);

    const another = '{"assetId":"4823af43-68fa-4a09-ae7b-ec1234567890"}';
    expect(redactToolPayload(another)).toBe(another);

    const dated = '{"createdAt":"2026-08-04T13:50:18.000Z","runMs":1234567}';
    expect(redactToolPayload(dated)).toBe(dated);
  });

  it("leaves a storage URL alone", () => {
    const url = '{"url":"https://qqbecyrhnowmooyjiztz.supabase.co/storage/v1/object/media"}';
    expect(redactToolPayload(url)).toBe(url);
  });
});

describe("summarizeToolPayload", () => {
  it("says nothing for an empty payload", () => {
    expect(summarizeToolPayload("")).toBe("");
    expect(summarizeToolPayload(null)).toBe("");
    expect(summarizeToolPayload(undefined)).toBe("");
    expect(summarizeToolPayload("   ")).toBe("");
  });

  it("prefers the count the payload states about itself", () => {
    expect(summarizeToolPayload('{"contacts":[{"id":"a"}],"total":243,"returned":25}')).toBe("243 contacts");
  });

  it("counts a list only when the payload parsed whole", () => {
    expect(summarizeToolPayload('{"opportunities":[{"id":"a"},{"id":"b"}]}')).toBe("2 opportunities");
    expect(summarizeToolPayload('[{"id":"a"},{"id":"b"},{"id":"c"}]')).toBe("3 items");
  });

  /**
   * The trap this module exists to avoid. A response holding 243 contacts
   * truncates to two, so counting what survived would report "2 contacts" with
   * total confidence.
   */
  it("never counts elements of a truncated payload", () => {
    const truncated = '{"contacts":[{"id":"b38c9cc3-13d7-47fa-aaa1-4ee42025459a","companyId":null,"persona":"emer';
    const out = summarizeToolPayload(truncated);
    expect(out).not.toMatch(/\b\d+\s+contacts\b/);
    expect(out).toContain("cut short");
    expect(out).toContain("contacts");
  });

  /**
   * The other half of that rule. A count the payload states about itself is a
   * scalar, and it sits near the front, so it survives the cut and is safe to
   * use even though the structure around it is unusable.
   */
  it("uses a stated count that survived the cut", () => {
    expect(summarizeToolPayload('{"leads":[…],"total":142}')).toBe("142 leads");
    expect(summarizeToolPayload('{"contacts":[{"id":"a","name":"partial')).not.toContain("1 contacts");
    expect(summarizeToolPayload('{"total":243,"contacts":[{"id":"a","nam')).toBe("243 contacts");
  });

  it("passes an error message through — it is the useful part of the row", () => {
    const err = "Searching CRM contacts failed: GET /api/v1/arc/crm/contacts -> 502";
    expect(summarizeToolPayload(err)).toBe(err);
  });

  it("names the fields when there is nothing to count", () => {
    expect(summarizeToolPayload('{"campaignId":"7bef0d89","assetId":"4823af43"}')).toBe("campaign id, asset id");
  });

  it("reports a real status but not a bare ok next to a count", () => {
    expect(summarizeToolPayload('{"ok":true,"status":"proposed","id":"9756"}')).toBe("proposed");
    expect(summarizeToolPayload('{"ok":true,"status":"ok","items":[{"a":1}]}')).toBe("1 items");
    expect(summarizeToolPayload('{"ok":true}')).toBe("ok");
  });

  it("handles the empty-object input the runner sends constantly", () => {
    expect(summarizeToolPayload("{}")).toBe("no detail");
  });

  it("keeps a small scalar input readable", () => {
    expect(summarizeToolPayload('{"limit":5}')).toBe("limit");
    expect(summarizeToolPayload('{"persona":"emergency-homeowner"}')).toBe("persona");
  });

  /** Redaction happens before summarising, so a summary cannot reintroduce it. */
  it("cannot leak a contact detail through the summary path", () => {
    const withPhone = 'Lookup failed for (312) 545-3376 on the contact record';
    const out = summarizeToolPayload(withPhone);
    expect(out).toContain("[phone]");
    expect(out).not.toContain("545-3376");
  });

  it("clamps a long line rather than letting it wrap the row", () => {
    const long = `Something went wrong: ${"detail ".repeat(60)}`;
    const out = summarizeToolPayload(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("…")).toBe(true);
  });
});
