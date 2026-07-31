import { describe, expect, it } from "vitest";

import { ARC_SKILLS, ARC_SKILL_LIBRARY, ALL_ARC_SKILLS } from "./catalog";
import { CONNECTOR_REGISTRY } from "@/domain/connectors";
import {
  describeSkillRequirement,
  describeSkillRequirements,
  unmetSkillConnectors,
  type SkillConnectorStatus,
} from "./requirements";

const connector = (
  key: string,
  status: SkillConnectorStatus["status"],
  label = key,
): SkillConnectorStatus => ({ key, label, status });

describe("unmetSkillConnectors", () => {
  it("stays silent for a skill that declares nothing", () => {
    expect(unmetSkillConnectors({}, [connector("weather-signals", "disabled")])).toEqual([]);
    expect(unmetSkillConnectors({ requiresConnectors: [] }, [])).toEqual([]);
  });

  it("treats a connected source as met", () => {
    const unmet = unmetSkillConnectors(
      { requiresConnectors: ["weather-signals"] },
      [connector("weather-signals", "connected", "Weather Signals")],
    );
    expect(unmet).toEqual([]);
  });

  it("reports every non-connected status with its own reason", () => {
    const cases: Array<[SkillConnectorStatus["status"], string]> = [
      ["disabled", "disabled"],
      ["not_configured", "not_configured"],
      ["error", "error"],
      ["unavailable", "unavailable"],
    ];
    for (const [status, reason] of cases) {
      const unmet = unmetSkillConnectors(
        { requiresConnectors: ["reviews-signals"] },
        [connector("reviews-signals", status, "Reviews & Reputation")],
      );
      expect(unmet).toEqual([{ key: "reviews-signals", label: "Reviews & Reputation", reason }]);
    }
  });

  it("flags a required connector missing from the workspace catalog entirely", () => {
    const unmet = unmetSkillConnectors({ requiresConnectors: ["ghost-source"] }, []);
    expect(unmet).toEqual([{ key: "ghost-source", label: "ghost-source", reason: "unknown" }]);
  });

  it("requires every declared connector, not just one of them", () => {
    const unmet = unmetSkillConnectors(
      { requiresConnectors: ["weather-signals", "reviews-signals"] },
      [connector("weather-signals", "connected"), connector("reviews-signals", "disabled", "Reviews")],
    );
    expect(unmet.map((requirement) => requirement.key)).toEqual(["reviews-signals"]);
  });

  it("reports a duplicated declaration once", () => {
    const unmet = unmetSkillConnectors(
      { requiresConnectors: ["weather-signals", "weather-signals"] },
      [connector("weather-signals", "disabled", "Weather")],
    );
    expect(unmet).toHaveLength(1);
  });
});

describe("describeSkillRequirement", () => {
  it("names the source and why it is unusable", () => {
    const label = "Competitor Ad Intel";
    expect(describeSkillRequirement({ key: "c", label, reason: "disabled" })).toBe("Competitor Ad Intel is off");
    expect(describeSkillRequirement({ key: "c", label, reason: "not_configured" })).toBe("Competitor Ad Intel is not set up");
    expect(describeSkillRequirement({ key: "c", label, reason: "error" })).toBe("Competitor Ad Intel needs attention");
    expect(describeSkillRequirement({ key: "c", label, reason: "unavailable" })).toBe("Competitor Ad Intel is not available yet");
    expect(describeSkillRequirement({ key: "c", label, reason: "unknown" })).toBe("Competitor Ad Intel is not in this workspace");
  });

  it("always says Arc will still answer — this never blocks a run", () => {
    const one = describeSkillRequirements([{ key: "a", label: "Weather", reason: "disabled" }]);
    expect(one).toBe("Weather is off — Arc will answer without it.");

    const two = describeSkillRequirements([
      { key: "a", label: "Weather", reason: "disabled" },
      { key: "b", label: "Reviews", reason: "not_configured" },
    ]);
    expect(two).toBe("Weather is off and Reviews is not set up — Arc will answer without them.");
  });

  it("renders nothing when everything a skill needs is available", () => {
    expect(describeSkillRequirements([])).toBe("");
  });
});

describe("the declared requirements themselves", () => {
  it("only names connectors that exist in the registry", () => {
    const known = new Set(CONNECTOR_REGISTRY.map((entry) => entry.key));
    for (const skill of ALL_ARC_SKILLS) {
      for (const key of skill.requiresConnectors ?? []) {
        expect(known, `${skill.key} requires unknown connector "${key}"`).toContain(key);
      }
    }
  });

  it("declares the external-source library skills", () => {
    const required = (key: string) =>
      ARC_SKILL_LIBRARY.find((skill) => skill.key === key)?.requiresConnectors ?? [];
    expect(required("competitor-watch")).toEqual(["competitor-ads"]);
    expect(required("local-search-audit")).toEqual(["reviews-signals"]);
    expect(required("review-response-planner")).toEqual(["reviews-signals"]);
    expect(required("storm-signal-monitor")).toEqual(["weather-signals"]);
  });

  it("never recommends permit-data, which fabricates opportunities", () => {
    for (const skill of ALL_ARC_SKILLS) {
      expect(skill.requiresConnectors ?? []).not.toContain("permit-data");
    }
  });

  it("leaves the workspace-record built-ins silent", () => {
    const noisy = ARC_SKILLS.filter((skill) => (skill.requiresConnectors ?? []).length > 0);
    expect(noisy.map((skill) => skill.key)).toEqual(["company-research"]);
  });
});
