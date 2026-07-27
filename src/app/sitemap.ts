import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo/site";

/**
 * Serves /sitemap.xml.
 *
 * Deliberately one entry. Everything else is either behind the auth gate or a
 * duplicate of the root (/landing serves the same page), and listing URLs a
 * crawler can't usefully index is worse than listing none. Add entries here as
 * genuinely public pages ship — pricing, changelog, docs.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
