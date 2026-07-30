import { describe, expect, it } from "vitest";

import {
  ENV_CAPABILITIES,
  allKnownEnvVars,
  isEnvVarSet,
  reportCapabilities,
  reportCapability,
  type CapabilitySpec,
} from "../env-capabilities";

const byKey = (key: string): CapabilitySpec => {
  const spec = ENV_CAPABILITIES.find((c) => c.key === key);
  if (!spec) throw new Error(`no capability ${key}`);
  return spec;
};

describe("presence, not value", () => {
  it("treats a blank string as unset", () => {
    // `vercel env pull` writes sensitive vars as empty, and a blank
    // TRACES_SAMPLE_RATE would otherwise read as a deliberate 0.
    const spec = { name: "X", requirement: "required" as const, ifUnset: "" };
    expect(isEnvVarSet({ X: "" }, spec)).toBe(false);
    expect(isEnvVarSet({ X: "   " }, spec)).toBe(false);
    expect(isEnvVarSet({ X: "0" }, spec)).toBe(true);
  });

  it("accepts an alias in place of the primary name", () => {
    // The code reads MARKETING_SUPABASE_URL as a fallback; a checklist that
    // ignored aliases would report a working deployment as broken.
    const spec = {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      requirement: "required" as const,
      ifUnset: "",
      aliases: ["MARKETING_SUPABASE_URL"] as const,
    };
    expect(isEnvVarSet({ MARKETING_SUPABASE_URL: "https://db" }, spec)).toBe(true);
  });
});

describe("capability grading", () => {
  it("is inert when nothing is set", () => {
    const report = reportCapability({}, byKey("billing"));
    expect(report.state).toBe("inert");
    expect(report.detail).toMatch(/switched off/i);
  });

  it("is ready when every required var is present", () => {
    const report = reportCapability(
      {
        STRIPE_SECRET_KEY: "sk",
        STRIPE_WEBHOOK_SECRET: "whsec",
        STRIPE_PRICE_STARTER: "price_a",
        STRIPE_PRICE_PRO: "price_b",
        STRIPE_PRICE_SCALE: "price_c",
      },
      byKey("billing"),
    );
    expect(report.state).toBe("ready");
    // An unset optional is reported but must not hold the capability back.
    expect(report.missingOptional.map((s) => s.name)).toContain("ARC_BILLING_ENFORCEMENT");
  });

  it("distinguishes partial from inert, and names what is missing", () => {
    // Half-configured is the more dangerous state: mail leaves and nothing
    // comes back, which looks like a working send loop.
    const report = reportCapability(
      {
        ARC_SEND_ENABLED: "1",
        RESEND_API_KEY: "re_x",
        RESEND_FROM: "arc@example.com",
        EMAIL_UNSUBSCRIBE_SECRET: "s",
        NEXT_PUBLIC_SITE_URL: "https://app",
      },
      byKey("send"),
    );
    expect(report.state).toBe("partial");
    expect(report.missingRequired.map((s) => s.name)).toEqual(["RESEND_WEBHOOK_SECRET"]);
    expect(report.detail).toContain("RESEND_WEBHOOK_SECRET");
  });

  it("never lets a platform-only var affect readiness", () => {
    // Otherwise every self-hosted deployment reads as broken for lacking our
    // Sentry org, which would train operators to ignore the report.
    const report = reportCapability(
      { NEXT_PUBLIC_SENTRY_DSN: "https://dsn", ALERT_SLACK_WEBHOOK_URL: "https://hook" },
      byKey("observability"),
    );
    expect(report.state).toBe("ready");
    expect(report.missingPlatform.map((s) => s.name)).toContain("SENTRY_AUTH_TOKEN");
  });
});

describe("the catalogue itself", () => {
  it("gives every variable a consequence an operator can act on", () => {
    // The whole point is answering "what breaks while this is unset". A row
    // without that is a name in a list, which is what .env.example already was.
    for (const capability of ENV_CAPABILITIES) {
      for (const spec of capability.vars) {
        expect(spec.ifUnset.trim().length, `${capability.key}/${spec.name}`).toBeGreaterThan(20);
      }
    }
  });

  it("has no duplicate variable inside one capability", () => {
    for (const capability of ENV_CAPABILITIES) {
      const names = capability.vars.map((s) => s.name);
      expect(new Set(names).size, capability.key).toBe(names.length);
    }
  });

  it("covers the variables the app cannot run without", () => {
    const known = new Set(allKnownEnvVars());
    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "ARC_AGENT_API_TOKEN",
      "GEMINI_API_KEY",
      "CRON_SECRET",
      // Undocumented in .env.example before this ticket, and load-bearing:
      // unsubscribe links cannot be signed without it, which is a compliance
      // failure rather than a missing feature.
      "EMAIL_UNSUBSCRIBE_SECRET",
    ]) {
      expect(known.has(name), name).toBe(true);
    }
  });

  it("reports every capability, in a stable order", () => {
    const reports = reportCapabilities({});
    expect(reports).toHaveLength(ENV_CAPABILITIES.length);
    expect(reports.map((r) => r.key)).toEqual(ENV_CAPABILITIES.map((c) => c.key));
  });
});
