/**
 * Canonical site identity for SEO surfaces (robots, sitemap, canonical URLs).
 *
 * Kept in one place so robots.txt, the sitemap and the page metadata can never
 * disagree about which origin is the real one.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")
  : "https://arc-studio.ai";

/**
 * Whether this deployment should be indexed at all.
 *
 * Vercel sets VERCEL_ENV to "production" | "preview" | "development". Only
 * production is indexable — otherwise every branch preview would serve the same
 * marketing page and compete with the real domain in search results. When the
 * variable is absent (local dev, self-hosted, CI) we treat it as indexable so
 * the generated files stay inspectable and testable.
 */
export function isIndexableDeployment(): boolean {
  const env = process.env.VERCEL_ENV;
  return !env || env === "production";
}
