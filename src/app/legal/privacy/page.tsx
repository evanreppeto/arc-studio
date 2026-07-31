import type { Metadata } from "next";

import { SITE_URL } from "@/lib/seo/site";

import { LegalView } from "../_components/legal-view";
import { PRIVACY_SECTIONS } from "../_data/legal-documents";

const TITLE = "Privacy Policy — Arc Studio";
const DESCRIPTION =
  "How Arc Studio handles personal data: what we collect, what the AI providers see, how workspaces are isolated, and how to export or delete your data.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/legal/privacy" },
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: `${SITE_URL}/legal/privacy`,
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function PrivacyPage() {
  return (
    <LegalView
      title="Privacy Policy"
      currentPath="/legal/privacy"
      intro="What we collect, why, who else processes it, and what you can ask us to do about it. Workspace data is isolated at the database level, and we do not use one customer's data to train models for another."
      sections={PRIVACY_SECTIONS}
    />
  );
}
