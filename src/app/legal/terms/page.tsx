import type { Metadata } from "next";

import { SITE_URL } from "@/lib/seo/site";

import { LegalView } from "../_components/legal-view";
import { ENTITY, TERMS_SECTIONS } from "../_data/legal-documents";

const TITLE = "Terms of Service — Arc Studio";
const DESCRIPTION =
  "The terms governing use of Arc Studio, including what the agent does, what you are responsible for approving, and how plans and data are handled.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/legal/terms" },
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: `${SITE_URL}/legal/terms`,
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function TermsPage() {
  return (
    <LegalView
      title="Terms of Service"
      currentPath="/legal/terms"
      intro={`These terms govern your use of ${ENTITY.productName}. The short version: the agent drafts, you approve, and nothing reaches a customer without your sign-off — which also means you own what you approve.`}
      sections={TERMS_SECTIONS}
    />
  );
}
