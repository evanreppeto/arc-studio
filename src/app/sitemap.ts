import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo/site";

import { COMPARISON_SLUGS } from "./compare/_data/comparisons";

/**
 * Serves /sitemap.xml.
 *
 * Every entry here must be a genuinely public page — listing URLs a crawler
 * can't usefully index is worse than listing none. Anything behind the auth
 * gate, and `/landing` (which serves the same page as the root), stays out.
 *
 * The comparison entries are DERIVED from the same list that renders the pages
 * (`compare/_data/comparisons.ts`) rather than hand-copied, so a new comparison
 * cannot ship un-indexed. Do the same for the remaining page families as they
 * land — docs, changelog, industry pages — rather than growing a hand-kept
 * literal that drifts out of date. BSR-580 tracks turning this into a full
 * generated inventory with a check that fails when a public route has no entry.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      // /pricing shipped long before this entry existed. That omission is
      // exactly the drift the derived list below is meant to prevent.
      url: `${SITE_URL}/pricing`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/compare`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    ...COMPARISON_SLUGS.map((slug) => ({
      url: `${SITE_URL}/compare/${slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
