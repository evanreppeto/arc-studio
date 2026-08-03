/**
 * One colour per persona, everywhere (BSR-661).
 *
 * This existed five times — `crm-board.tsx`, `crm/_data/row-vm.ts`,
 * `campaigns/page.tsx`, `campaigns-board.tsx`, and an index-based array in
 * `lib/analytics/overview.ts`. The first four were near-identical copies of the
 * same regex ladder; the fifth assigned colours by array position, so the SAME
 * persona was gold on CRM and blue on Analytics. A colour that changes meaning
 * between screens teaches nothing.
 *
 * Two rules the old ladder broke, both from DESIGN.md §8:
 *
 *   - **No purple.** `#9678c8` and `#b58fd0` carried "HOA board" and "past
 *     customer". Purple is banned outright ("no purple/neon AI palette").
 *   - **Red is destructive only.** `#cc6a6a` carried the emergency persona. A
 *     user who has learned red means "careful, this deletes things" then meets
 *     it on a routine audience label. Urgency is real, but it is the
 *     opportunity's urgency field's job to say so, not the persona chip's.
 *
 * Pure — no I/O, no React.
 */

/**
 * The persona ramp: warm, purple-free, red-free, and drawn from the same
 * obsidian/gold family as the rest of the app.
 */
export const PERSONA_ACCENTS = {
  gold: "#c8a24a",
  green: "#7fb89a",
  teal: "#6fae9e",
  blue: "#88b6d8",
  amber: "#d8935a",
  sand: "#b09a72",
} as const;

export type PersonaAccent = (typeof PERSONA_ACCENTS)[keyof typeof PERSONA_ACCENTS];

const RAMP: PersonaAccent[] = [
  PERSONA_ACCENTS.gold,
  PERSONA_ACCENTS.green,
  PERSONA_ACCENTS.blue,
  PERSONA_ACCENTS.teal,
  PERSONA_ACCENTS.amber,
  PERSONA_ACCENTS.sand,
];

/**
 * Meaning-carrying matches first. These are the groupings a service business
 * actually thinks in, so a recognised persona keeps a stable, sensible hue
 * rather than whatever the hash lands on.
 */
const NAMED: { pattern: RegExp; accent: PersonaAccent }[] = [
  { pattern: /plumb|partner|contractor|referral|vendor|trade|sub/, accent: PERSONA_ACCENTS.green },
  { pattern: /insurance|adjuster|agent/, accent: PERSONA_ACCENTS.blue },
  { pattern: /preventative|preventive|maintenance|monitor|inspection/, accent: PERSONA_ACCENTS.teal },
  { pattern: /emergency|urgent|storm|hail|flood|fire|burst|water\s*damage/, accent: PERSONA_ACCENTS.amber },
  { pattern: /rebuild|restoration|reconstruct|remodel|renov/, accent: PERSONA_ACCENTS.amber },
  { pattern: /hoa|board|association|landlord|tenant/, accent: PERSONA_ACCENTS.sand },
  { pattern: /past|repeat|existing|customer|reactivat/, accent: PERSONA_ACCENTS.sand },
  { pattern: /property|manager|realtor|commercial|reit/, accent: PERSONA_ACCENTS.gold },
];

/** Stable small hash so an unrecognised persona still gets the same hue everywhere. */
function hashIndex(value: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h) % buckets;
}

/**
 * The colour for a persona. Deterministic on the persona's own name, which is
 * what makes it agree across CRM, Campaigns, Analytics and Personas — the old
 * index-based version could not, because position differs per screen.
 */
export function personaAccent(persona: string | null | undefined): PersonaAccent {
  const p = (persona || "").toLowerCase().trim();
  if (!p) return PERSONA_ACCENTS.gold;
  for (const { pattern, accent } of NAMED) {
    if (pattern.test(p)) return accent;
  }
  return RAMP[hashIndex(p, RAMP.length)] ?? PERSONA_ACCENTS.gold;
}
