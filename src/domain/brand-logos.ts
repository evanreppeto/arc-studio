/**
 * A workspace's logo set — pure roles + selection, no I/O.
 *
 * The brand kit held exactly one `logo_url`, and the creative templates draw it
 * on a charcoal scrim. A workspace whose only logo is dark-on-transparent
 * therefore rendered an invisible logo on every ad Arc generated, and nothing in
 * the approval flow surfaced it — the operator sees a composed image and has no
 * reason to suspect the mark is there but unreadable.
 *
 * Naming the variants is what lets the renderer pick correctly instead of
 * guessing, so this is a small fixed vocabulary rather than free-form tags: the
 * renderer has to branch on it, and a role a tenant invented is a role the
 * renderer cannot reason about.
 */

export const BRAND_LOGO_ROLES = ["primary", "mark", "wordmark", "on_light", "on_dark"] as const;
export type BrandLogoRole = (typeof BRAND_LOGO_ROLES)[number];

export type BrandLogo = {
  role: BrandLogoRole;
  url: string;
  /** Original filename, so the operator can tell two similar marks apart. */
  fileName: string | null;
  updatedAt: string | null;
};

export const BRAND_LOGO_LABELS: Record<BrandLogoRole, { label: string; hint: string }> = {
  primary: {
    label: "Primary logo",
    hint: "Your main lockup. Used whenever nothing more specific fits.",
  },
  mark: {
    label: "Icon or mark",
    hint: "Square, no words. For avatars, favicons and tight spaces.",
  },
  wordmark: {
    label: "Wordmark",
    hint: "Your name set as type, with no icon.",
  },
  on_light: {
    label: "For light backgrounds",
    hint: "Usually your dark or full-colour version.",
  },
  on_dark: {
    label: "For dark backgrounds",
    hint: "Usually a white or knocked-out version. Arc reaches for this on dark creative.",
  },
};

export function isBrandLogoRole(value: unknown): value is BrandLogoRole {
  return typeof value === "string" && (BRAND_LOGO_ROLES as readonly string[]).includes(value);
}

/**
 * Choose the logo to draw on a given background.
 *
 * Prefers the variant made for that background, then the primary, then the other
 * neutral lockups.
 *
 * It deliberately never falls back to the *opposite* background's variant. A
 * white knocked-out logo on white paper is not a degraded result, it is an
 * absent one that still reports success — and the templates already have an
 * honest fallback (the short-mark chip) for having no usable logo. Returning
 * null here is what lets them use it.
 */
export function pickLogoForBackground(
  logos: readonly BrandLogo[],
  background: "light" | "dark",
): BrandLogo | null {
  const by = (role: BrandLogoRole) => logos.find((l) => l.role === role && l.url.trim().length > 0) ?? null;
  const forBackground = background === "dark" ? by("on_dark") : by("on_light");
  const opposite: BrandLogoRole = background === "dark" ? "on_light" : "on_dark";
  return (
    forBackground ??
    by("primary") ??
    by("wordmark") ??
    by("mark") ??
    // Everything except the opposite-background variant, which would render
    // invisible. Nothing usable → null, and the template draws its text chip.
    logos.find((l) => l.role !== opposite && l.url.trim().length > 0) ??
    null
  );
}

/**
 * The single logo the rest of the app shows — the nav rail, the Studio preview,
 * `business_profiles.logo_url`. Those surfaces predate the set and each render
 * one image, so the primary (or the closest thing to it) stands in.
 */
export function primaryBrandLogo(logos: readonly BrandLogo[]): BrandLogo | null {
  const by = (role: BrandLogoRole) => logos.find((l) => l.role === role && l.url.trim().length > 0) ?? null;
  return by("primary") ?? by("wordmark") ?? by("mark") ?? by("on_light") ?? by("on_dark") ?? null;
}

/** Roles with nothing uploaded yet — drives the "add one" slots in the UI. */
export function emptyLogoRoles(logos: readonly BrandLogo[]): BrandLogoRole[] {
  return BRAND_LOGO_ROLES.filter((role) => !logos.some((l) => l.role === role && l.url.trim().length > 0));
}
