// ---------------------------------------------------------------------------
// Brand screen view-model — turns the (previously UI-less) Brand Kit into the
// shape the /brand page renders. Live: the org's business_profiles row +
// brand sources. Offline preview (ARC_DEMO_DATA): a rich BSR-flavoured demo
// profile so the screen reads like a finished brand kit, not neutral defaults.
// Falls back to NEUTRAL_DEFAULTS when there's no profile and no demo flag.
// Read-only — nothing here sends or publishes.
// ---------------------------------------------------------------------------

import { NEUTRAL_DEFAULTS, type BusinessProfile, type ProofPoint } from "@/domain";
import { isDemoDataEnabled } from "@/lib/demo/demo-mode";

import { getBusinessProfile } from "./persistence";
import { isSupabaseAdminConfigured } from "../supabase/server";

export type BrandSwatch = { role: string; name: string; hex: string };
export type BrandSourceItem = { id?: string; ext: string; extColor?: string; name: string; facts: string; when: string; stale: boolean };

export type BrandProfileView = {
  isDemo: boolean;
  identity: {
    name: string;
    tagline: string | null;
    segments: string[];
    website: string | null;
    legalName: string | null;
    published: boolean;
    /**
     * The brand mark Arc stamps on generated creative (`toBrandTokens` →
     * `renderCreative`). Only http(s) URLs are surfaced — the renderer fetches
     * this, so a relative or data: value would either 404 or bloat the render.
     */
    logoUrl: string | null;
  };
  palette: BrandSwatch[];
  headingFont: string | null;
  bodyFont: string | null;
  tone: string[];
  voiceGuidance: string | null;
  preferredPhrases: string[];
  bannedPhrases: string[];
  proofPoints: string[];
  services: string[];
  guardrails: string[];
  sources: BrandSourceItem[];
};

type ColorSlot = "primary" | "secondary" | "accent" | "dark" | "light";
const ROLE_BY_SLOT: Array<[ColorSlot, string]> = [
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["accent", "Accent"],
  ["dark", "Ink"],
  ["light", "Paper"],
];

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function proofLabel(p: ProofPoint): string {
  return p.detail ? `${p.label} — ${p.detail}` : p.label;
}

/** Pure: BusinessProfile (+ resolved sources) → the Brand screen view-model. */
export function toBrandProfileView(profile: BusinessProfile, sources: BrandSourceItem[], isDemo: boolean, fallbackName: string): BrandProfileView {
  const palette: BrandSwatch[] = ROLE_BY_SLOT
    .map(([slot, role]) => ({ role, name: profile.brandPalette[slot].label || role, hex: profile.brandPalette[slot].hex }))
    .filter((s) => /^#[0-9a-fA-F]{6}$/.test(s.hex));

  const segments = [profile.industry, ...profile.serviceAreas].filter((v): v is string => Boolean(v && v.trim())).map(titleCase);

  return {
    isDemo,
    identity: {
      name: profile.displayName.trim() || fallbackName,
      tagline: profile.tagline,
      segments,
      website: profile.websiteUrl,
      legalName: profile.legalName,
      published: profile.status === "active",
      logoUrl: profile.logoUrl?.startsWith("http") ? profile.logoUrl : null,
    },
    palette,
    headingFont: profile.brandPalette.headingFont || null,
    bodyFont: profile.brandPalette.bodyFont || null,
    // `tone` is a single stored field; a comma list (demo) becomes multiple chips.
    tone: profile.tone.split(",").map((t) => titleCase(t.trim())).filter(Boolean),
    voiceGuidance: profile.voiceGuidance,
    preferredPhrases: profile.preferredPhrases,
    bannedPhrases: profile.bannedPhrases,
    proofPoints: profile.proofPoints.map(proofLabel),
    services: profile.services,
    guardrails: profile.guardrails.disallowedClaims,
    sources,
  };
}

/** BSR-flavoured demo profile — mirrors the finished Brand mockup so the offline
 *  preview reads like a real, populated brand kit. BSR is the demo tenant. */
function demoBrandProfile(name: string): BusinessProfile {
  return {
    ...NEUTRAL_DEFAULTS,
    displayName: name,
    legalName: "Big Shoulders Restoration, LLC",
    tagline: "Storm-damage roofing & exteriors, done right.",
    description: "Licensed, insured, local crews handling storm-damage roofing and exteriors, from inspection through the insurance claim.",
    industry: "Roofing & exteriors",
    websiteUrl: "https://bigshouldersrestoration.com",
    serviceAreas: ["Storm restoration"],
    accent: "#f2a93b",
    tone: "Warm, Trustworthy, Local, No-pressure",
    voiceGuidance:
      "Speak neighbor-to-neighbor. Lead with help and proof, never pressure. Short sentences, active voice. Reassure a homeowner dealing with storm damage who hates being sold to.",
    preferredPhrases: ["inspection", "warranty", "local", "licensed", "claim-ready"],
    bannedPhrases: ["discount", "limited-time", "act now", "cheapest", "gimmick"],
    services: ["Roof replacement", "Storm-damage repair", "Insurance-claim assistance", "Gutter & siding"],
    proofPoints: [
      { kind: "certification", label: "GAF-certified installer" },
      { kind: "certification", label: "Licensed & insured local crews" },
      { kind: "testimonial", label: "Maple Grove HOA reroofed in 5 days" },
      { kind: "stat", label: "Google 4.8/5", detail: "1,200+ reviews" },
    ],
    guardrails: {
      disallowedClaims: [
        "Make unverified savings / % claims",
        "Name competitors in paid ads",
        "Guarantee claim approval before inspection",
        "Use customer photos without rights",
        "Outbound-send without human approval",
      ],
      complianceNotes: NEUTRAL_DEFAULTS.guardrails.complianceNotes,
    },
    brandPalette: {
      primary: { label: "Restoration Blue", hex: "#3b6ef5" },
      secondary: { label: "Trust Teal", hex: "#18b4a6" },
      accent: { label: "Amber", hex: "#f2a93b" },
      dark: { label: "Ink", hex: "#14181f" },
      light: { label: "Paper", hex: "#f5f7fa" },
      headingFont: "Fraunces",
      bodyFont: "Geist",
    },
    status: "active",
  };
}

const DEMO_SOURCES: BrandSourceItem[] = [
  { ext: "PDF", name: "Brand guidelines.pdf", facts: "18 facts", when: "analyzed 30d ago", stale: true },
  { ext: "DOCX", extColor: "#2b78c4", name: "Tone of voice.docx", facts: "9 facts", when: "analyzed 30d ago", stale: true },
  { ext: "MD", extColor: "#5a5f6b", name: "messaging-v3.md", facts: "12 facts", when: "analyzed 6d ago", stale: false },
  { ext: "PDF", name: "product-onepager.pdf", facts: "7 facts", when: "analyzed 6d ago", stale: false },
];

export async function getBrandProfileView(orgId: string, fallbackName: string): Promise<BrandProfileView> {
  if (isSupabaseAdminConfigured()) {
    const profile = await getBusinessProfile(orgId).catch(() => null);
    if (profile) {
      const sources = await loadLiveSources(orgId);
      return toBrandProfileView(profile, sources, false, fallbackName);
    }
  }

  if (isDemoDataEnabled()) {
    return toBrandProfileView(demoBrandProfile(fallbackName), DEMO_SOURCES, true, fallbackName);
  }

  return toBrandProfileView(NEUTRAL_DEFAULTS, [], false, fallbackName);
}

const EXT_COLOR: Record<string, string> = { DOCX: "#2b78c4", MD: "#5a5f6b" };

/** Live brand sources → view items. Best-effort: the underlying media-library
 *  read-model returns empty when unconfigured, so this never throws the page. */
async function loadLiveSources(orgId: string): Promise<BrandSourceItem[]> {
  try {
    const { listBrandSources } = await import("../brand-knowledge/sources-read-model");
    const rows = await listBrandSources(orgId);
    return rows.map((r) => {
      const ext = (r.fileName.split(".").pop() ?? "DOC").toUpperCase().slice(0, 4);
      return { id: r.id, ext, extColor: EXT_COLOR[ext], name: r.fileName, facts: `${r.brain.total} facts`, when: "", stale: false };
    });
  } catch {
    return [];
  }
}
