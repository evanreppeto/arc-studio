import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { SITE_URL } from "@/lib/seo/site";

import { ComparisonView } from "../_components/comparison-view";
import { COMPARISONS, getComparison } from "../_data/comparisons";

// Public comparison pages (BSR-583) — the highest-intent organic traffic we can
// realistically win, because the incumbents will never write these.
//
// Reachable signed-out: `/compare` is listed in PUBLIC_MARKETING_PATHS
// (`src/lib/auth/route-protection.ts`) so the proxy lets it through before any
// session check. That list matches on an exact path plus a real sub-path, so
// `/compare` covers `/compare/vs-agency` without also exempting a future
// `/compare-internal`.
//
// Prerendered static, like /pricing: this is a stranger's first impression
// arriving from search, it has no per-request data beyond the sign-up flag, and
// it must not depend on Supabase env (CI builds without it).
//
// dynamicParams=false so an unknown slug 404s instead of rendering an empty
// shell — a comparison page for a product we never wrote about is worse than a
// missing one.
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPARISONS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const comparison = getComparison(slug);
  if (!comparison) return {};

  const url = `/compare/${comparison.slug}`;
  return {
    title: comparison.metaTitle,
    description: comparison.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "Arc Studio",
      url: `${SITE_URL}${url}`,
      title: comparison.metaTitle,
      description: comparison.metaDescription,
      images: [
        { url: "/brand/og-card.jpg", width: 1200, height: 630, alt: comparison.metaTitle },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: comparison.metaTitle,
      description: comparison.metaDescription,
      images: ["/brand/og-card.jpg"],
    },
  };
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const comparison = getComparison(slug);
  if (!comparison) notFound();

  return <ComparisonView comparison={comparison} signupOpen={isSelfServeSignupOpen()} />;
}
