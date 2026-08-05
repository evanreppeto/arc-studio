import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Cache each dynamic page segment in the client router cache for 30s (the
    // default is 0 = off). Re-opening a page you already visited this session
    // then swaps in instantly with no server round-trip. Mutations still call
    // revalidatePath, which evicts the affected route, so this only ever serves
    // <=30s-stale reads on revisit — fine for these dashboards.
    staleTimes: { dynamic: 30 },
    // Branding uploads validate the image itself at 4 MB. Leave enough room for
    // the multipart Server Action envelope; Next otherwise rejects the request
    // at its 1 MB default before our validation or inline error UI can run.
    serverActions: { bodySizeLimit: "5mb" },
  },
  // Move the dev-only on-screen indicator off the left rail (its default
  // 'bottom-left' overlaps the sidebar's operator avatar). Set to `false` to hide.
  devIndicators: {
    position: "bottom-right",
  },
  // Hand the browser the deploy's environment and release.
  //
  // Next only inlines NEXT_PUBLIC_*, and Vercel's VERCEL_ENV / VERCEL_GIT_COMMIT_SHA
  // carry no such prefix — so client-side Sentry saw neither and tagged production
  // errors `environment: "development"` with no release, while the server tagged the
  // same errors correctly. Sentry's own SDK concedes the split (getVercelEnv reads
  // NEXT_PUBLIC_VERCEL_ENV on the client, VERCEL_ENV on the server).
  //
  // This config is evaluated at build time on the server, where the real values
  // exist, so it is the one place that can bridge them. Empty string means "unset"
  // downstream; an explicitly-set NEXT_PUBLIC_* still wins.
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || "",
    NEXT_PUBLIC_SENTRY_RELEASE:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
  // The creative renderer's .ttf files, declared rather than inferred.
  //
  // nft traces `import`/`require`/`fs` usage STATICALLY, and `readFile(join(...,
  // relative))` picks its file at runtime — so no analysis can know which of the
  // ten faces a request will want. The previous code reached for `new URL('./fonts/'
  // + x, import.meta.url)` to get traced, and that is what broke on prod: Turbopack
  // rewrites that expression into its own asset reference, which is not a `file:`
  // URL, so `fileURLToPath` threw and every composed creative failed (#1008, #1010).
  //
  // Declaring the directory is the documented way out and removes the dependency on
  // bundler rewriting entirely. 2 MB, on the two route trees that compose creative:
  // the Studio server action and Arc's compose endpoint.
  outputFileTracingIncludes: {
    "/studio": ["./src/lib/media/compose/fonts/**"],
    "/api/v1/arc/media/compose": ["./src/lib/media/compose/fonts/**"],
  },
  async redirects() {
    return [
      { source: "/persona-intelligence", destination: "/personas", permanent: true },
      { source: "/persona-intelligence/:personaKey", destination: "/personas/:personaKey", permanent: true },
    ];
  },
  // Front door flipped to the real app: the root `/` is no longer rewritten to
  // the static mockup gallery — it resolves to src/app/page.tsx, which sends
  // callers into the app (/home). The mockup files remain in public/ but nothing
  // links to them anymore.
};

// Sentry wraps the build to (a) instrument server code and (b) upload source maps
// so a prod stack trace points at real lines instead of minified soup.
//
// It must stay harmless in the builds that have no Sentry env: CI runs
// `pnpm build` with nothing configured, and a plugin that errored (or chattered)
// there would break the required `verify` check for every PR. Source-map upload
// only happens when SENTRY_AUTH_TOKEN + org/project are present; otherwise this
// is a pass-through.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Don't fail or spam the build when Sentry isn't configured (CI, local, demo).
  silent: !process.env.SENTRY_AUTH_TOKEN,
  errorHandler: (err) => {
    // A source-map upload hiccup must never fail a deploy — the app is fine, the
    // symbolication just degrades.
    console.warn("[sentry] build plugin:", err.message);
  },
  // Route the browser SDK's requests through our own origin so ad-blockers don't
  // silently swallow client-side error reports.
  tunnelRoute: "/monitoring",
  // Keep uploaded maps out of the public bundle.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
