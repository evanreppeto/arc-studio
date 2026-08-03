import type { ArcClient } from "./arc-client";

/** Every per-business fact Arc needs, injected into the system prompt by buildSystemPrompt(). */
export type ArcBusinessContext = {
  businessName: string;
  industry: string;
  brandVoice: string;
  /** Short note on approved-media posture and creative guardrails. */
  creativePolicy: string;
  /** Compliance / restricted-claims posture, stated for the model. */
  compliance: string;
  /**
   * The WORKSPACE's own persona taxonomy. Carried through from the wire payload
   * rather than flattened away: the system prompt tells Arc to "use these exact
   * keys", so a hardcoded list instructs the model to map a tenant's contacts
   * onto another business's personas. Empty means "not supplied" and the prompt
   * falls back to the demo set.
   */
  personas: Array<{ key: string; label: string }>;
};

export const NEUTRAL_CONTEXT: ArcBusinessContext = {
  personas: [],
  businessName: "the business",
  industry: "Not specified.",
  brandVoice: "Use a clear, accurate, professional voice. Ask for brand details when the operator has not activated a Brand Kit.",
  creativePolicy:
    "Prefer the business's real, approved media. AI creative may package/resize/test authentic proof, never fabricate scenes. Flag embedded text, unrealistic scenes, privacy/redaction, and unsubstantiated claims.",
  compliance: "No specific compliance constraints recorded; stay accurate and avoid unverifiable claims.",
};

/** The rich context shape returned by GET /api/v1/arc/brand/context (app's assembleArcContext output). */
export type AppBusinessContext = {
  businessName: string;
  industry: string | null;
  services: string[];
  tone: string;
  voiceGuidance: string | null;
  preferredPhrases: string[];
  bannedPhrases: string[];
  proofPoints: Array<{ kind: string; label: string; detail?: string }>;
  brainFacts: string[];
  // Structural subset: fromAppContext doesn't read personas yet. The wire payload
  // includes more (audienceType, sortOrder, isActive, metadata); a later task maps them.
  personas: Array<{ key: string; label: string; [k: string]: unknown }>;
  guardrails: { disallowedClaims: string[]; complianceNotes: string };
  palette: {
    primary: { label: string; hex: string };
    secondary: { label: string; hex: string };
    accent: { label: string; hex: string };
    dark: { label: string; hex: string };
    light: { label: string; hex: string };
    headingFont: string;
    bodyFont: string;
  };
  logoUrl: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  serviceAreas: string[];
};

/** Tenant-agnostic creative posture: the same for every business; brand specifics ride the other fields. */
const DEFAULT_CREATIVE_POLICY =
  "Prefer the business's real, approved media. AI creative may package/resize/test authentic proof, never fabricate scenes. Flag embedded text, unrealistic scenes, privacy/redaction, and unsubstantiated claims.";

/** Flatten the app's structured brand context into the runner's free-text 5-field prompt shape. */
export function fromAppContext(raw: AppBusinessContext): ArcBusinessContext {
  const services = raw.services.length ? ` Services: ${raw.services.join(", ")}.` : "";
  const voice = [
    `Tone: ${raw.tone}.`,
    raw.voiceGuidance ? `Guidance: ${raw.voiceGuidance}.` : null,
    raw.preferredPhrases.length ? `Preferred phrases: ${raw.preferredPhrases.join(", ")}.` : null,
    raw.bannedPhrases.length ? `Never use: ${raw.bannedPhrases.join(", ")}.` : null,
  ]
    .filter((b): b is string => Boolean(b))
    .join(" ");
  const proof = raw.proofPoints.length
    ? ` Proof points available: ${raw.proofPoints.map((p) => p.label).join("; ")}.`
    : "";
  const brainFacts = raw.brainFacts.length ? ` Approved Brain facts: ${raw.brainFacts.join("; ")}.` : "";
  const compliance =
    [
      raw.guardrails.complianceNotes || null,
      raw.guardrails.disallowedClaims.length ? `Do not claim: ${raw.guardrails.disallowedClaims.join(", ")}.` : null,
    ]
      .filter((b): b is string => Boolean(b))
      .join(" ") || "No specific compliance constraints recorded; stay accurate and avoid unverifiable claims.";

  const colorBits = (["primary", "secondary", "accent", "dark", "light"] as const)
    .map((slot) => raw.palette[slot])
    .filter((c) => c.hex.length > 0)
    .map((c) => (c.label ? `${c.label} ${c.hex}` : c.hex));
  const fonts = [
    raw.palette.headingFont && `Heading: ${raw.palette.headingFont}`,
    raw.palette.bodyFont && `Body: ${raw.palette.bodyFont}`,
  ]
    .filter(Boolean)
    .join(", ");
  const identity = [
    raw.tagline ? `Tagline: ${raw.tagline}.` : null,
    // The operator's own prose about what the business does. Fetched over the
    // wire since the Brand Kit shipped, but never read here — so a filled-in
    // description reached Arc's context and was dropped before the prompt.
    raw.description ? `About: ${raw.description}.` : null,
    raw.websiteUrl ? `Website: ${raw.websiteUrl}.` : null,
    raw.serviceAreas.length ? `Service areas: ${raw.serviceAreas.join(", ")}.` : null,
    raw.logoUrl ? `Logo: ${raw.logoUrl}.` : null,
    colorBits.length ? `Brand colors: ${colorBits.join(", ")}.` : null,
    fonts ? `Fonts: ${fonts}.` : null,
  ]
    .filter((b): b is string => Boolean(b))
    .join(" ");

  return {
    businessName: raw.businessName,
    industry: (raw.industry ?? "Not specified") + services,
    brandVoice: [voice, identity, brainFacts].filter(Boolean).join(" "),
    creativePolicy: DEFAULT_CREATIVE_POLICY + proof,
    compliance,
    // The org's own taxonomy, normalized to {key,label}. The wire payload carries
    // more per persona (audienceType, sortOrder, isActive, metadata); the prompt
    // only needs the key and something to call it.
    personas: (raw.personas ?? [])
      .filter((p) => p && typeof p.key === "string" && p.key.trim())
      .map((p) => ({ key: p.key.trim(), label: typeof p.label === "string" && p.label.trim() ? p.label.trim() : p.key.trim() })),
  };
}

/** Fetch + map the org's brand context for this turn; fall back to neutral context on any error. */
export async function resolveBusinessContext(client: ArcClient): Promise<ArcBusinessContext> {
  try {
    const res = await client.apiGet<{ context: AppBusinessContext }>("/api/v1/arc/brand/context");
    return fromAppContext(res.context);
  } catch {
    return NEUTRAL_CONTEXT;
  }
}
