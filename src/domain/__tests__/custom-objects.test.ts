import { describe, expect, it } from "vitest";

import {
  deriveObjectKey,
  isBuiltInObjectKey,
  parseCustomObject,
  parseCustomRecord,
  RESERVED_OBJECT_KEYS,
} from "../custom-objects";

describe("parseCustomObject", () => {
  it("takes a name and derives a key", () => {
    const result = parseCustomObject({ labelPlural: "Service Vehicles", labelSingular: "Vehicle" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.key).toBe("service_vehicles");
      expect(result.value.labelPlural).toBe("Service Vehicles");
      expect(result.value.labelSingular).toBe("Vehicle");
    }
  });

  /**
   * Both words or neither. Deriving the singular by stripping an "s" produces
   * "Add Equipment" → "Add Equipmen", and irregular nouns are the NORMAL case
   * for what tenants track: equipment, staff, inventory, personnel. Same rule
   * app_settings.crm_object_labels follows for renaming the six.
   */
  it("refuses a half-supplied name pair", () => {
    expect(parseCustomObject({ labelPlural: "Equipment" })).toMatchObject({ ok: false });
    expect(parseCustomObject({ labelSingular: "Equipment item" })).toMatchObject({ ok: false });
  });

  /**
   * /crm/[objectKey] resolves a built-in first, so a custom object keyed
   * `contacts` would be records you can create and can never open. Refused in
   * the domain AND by custom_objects_key_reserved_check, because the app is not
   * guaranteed to be the only writer.
   */
  it("refuses the six built-ins and the route segments", () => {
    for (const key of ["companies", "contacts", "properties", "leads", "jobs", "outcomes", "import", "settings"]) {
      const result = parseCustomObject({ labelPlural: key, labelSingular: "x", key });
      expect(result.ok, key).toBe(false);
      if (!result.ok) expect(result.error, key).toContain(key);
    }
  });

  it("names the conflict rather than saying it is taken", () => {
    // "That name is unavailable" sends someone through three synonyms of the
    // same word. Saying which built-in it collides with ends it in one.
    const result = parseCustomObject({ labelPlural: "Contacts", labelSingular: "Contact" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/built-in/i);
  });

  it("rejects keys that would be unsafe in a URL or an export", () => {
    for (const key of ["my-object", "2trucks", "has space", "über"]) {
      expect(parseCustomObject({ labelPlural: "X", labelSingular: "x", key }).ok, key).toBe(false);
    }
  });

  it("normalizes case rather than refusing it, like a field key", () => {
    // Someone typing "Equipment" into a key box means `equipment`; refusing
    // would be pedantry, and parseFieldDefinition already lowercases.
    const result = parseCustomObject({ labelPlural: "X", labelSingular: "x", key: "Equipment" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.key).toBe("equipment");
  });

  it("allows underscores after the first character", () => {
    expect(parseCustomObject({ labelPlural: "X", labelSingular: "x", key: "trailing_" }).ok).toBe(true);
  });

  it("keeps every reserved key in sync with the six", () => {
    for (const key of ["companies", "contacts", "properties", "leads", "jobs", "outcomes"]) {
      expect(RESERVED_OBJECT_KEYS.has(key), key).toBe(true);
      expect(isBuiltInObjectKey(key), key).toBe(true);
    }
    expect(isBuiltInObjectKey("equipment")).toBe(false);
  });
});

describe("deriveObjectKey", () => {
  it("produces a legal key from ordinary names", () => {
    expect(deriveObjectKey("Equipment")).toBe("equipment");
    expect(deriveObjectKey("Service Vehicles")).toBe("service_vehicles");
    expect(deriveObjectKey("  Sub-Contractors!  ")).toBe("sub_contractors");
  });

  /** A key must start with a letter; a name that starts with a digit still needs one. */
  it("keeps a leading digit from producing an illegal key", () => {
    expect(deriveObjectKey("3rd party vendors")).toMatch(/^[a-z]/);
  });
});

describe("parseCustomRecord", () => {
  it("requires a name, in the tenant's own word", () => {
    const result = parseCustomRecord({}, "Equipment item");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("equipment item");
  });

  it("trims and keeps an optional subtitle", () => {
    const result = parseCustomRecord({ title: "  Extractor #3 ", subtitle: "  Van 2 " });
    expect(result).toMatchObject({ ok: true, value: { title: "Extractor #3", subtitle: "Van 2" } });
  });

  it("treats a blank subtitle as absent rather than empty", () => {
    const result = parseCustomRecord({ title: "X", subtitle: "   " });
    if (result.ok) expect(result.value.subtitle).toBeNull();
  });
});
