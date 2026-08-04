import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";
import { SITE_URL } from "@/lib/seo/site";

import { IndustryView } from "../_components/industry-view";
import { INDUSTRIES, getIndustry } from "../_data/industries";

// Industry landing pages (BSR-584). Public and prerendered static, like
// /pricing and /compare: a stranger's first impression arriving from a search
// for their trade, with no per-request data beyond the sign-up flag, and no
// Supabase dependency (CI builds env-less).
//
// `/industries` is registered in PUBLIC_MARKETING_PATHS
// (`src/lib/auth/route-protection.ts`), which matches an exact path plus a real
// sub-path — never a bare prefix.
export const dynamicParams = false;

export function generateStaticParams() {
  return INDUSTRIES.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) return {};

  const url = `/industries/${industry.slug}`;
  return {
    title: industry.metaTitle,
    description: industry.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "Arc Studio",
      url: `${SITE_URL}${url}`,
      title: industry.metaTitle,
      description: industry.metaDescription,
      images: [
        { url: "/brand/og-card.jpg", width: 1200, height: 630, alt: industry.metaTitle },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: industry.metaTitle,
      description: industry.metaDescription,
      images: ["/brand/og-card.jpg"],
    },
  };
}

export default async function IndustryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const industry = getIndustry(slug);
  if (!industry) notFound();

  return <IndustryView industry={industry} signupOpen={isSelfServeSignupOpen()} />;
}
