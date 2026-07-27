import type { MetadataRoute } from "next";

import { SITE_URL, isIndexableDeployment } from "@/lib/seo/site";

/**
 * Serves /robots.txt.
 *
 * Only the public marketing page is crawlable. Everything behind the auth gate
 * (the app, settings, auth screens) is disallowed — those pages redirect to
 * /login for a crawler anyway, so indexing them yields nothing but noise.
 *
 * Preview/branch deployments disallow everything: a Vercel preview URL serving
 * the same content as production would compete with it in search results.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/home",
          "/arc",
          "/campaigns",
          "/crm",
          "/opportunities",
          "/analytics",
          "/journeys",
          "/brain",
          "/personas",
          "/studio",
          "/library",
          "/brand",
          "/outbox",
          "/settings",
          "/onboarding",
          "/login",
          "/sign-up",
          "/forgot-password",
          "/reset-password",
          "/accept-invite/",
          "/welcome",
          // Same content as "/" — the canonical. Kept out of the index so the
          // two URLs don't compete.
          "/landing",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
