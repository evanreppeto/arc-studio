import { isSelfServeSignupOpen } from "@/lib/auth/auth-mode";

import { PricingView } from "./_components/pricing-view";

const TITLE = "Pricing — Arc Studio";
const DESCRIPTION =
  "Flat per-workspace pricing with unlimited seats. Every plan includes the full system and the approval gate; plans differ by how much work the agent does for you each month.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: "/pricing",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/brand/og-card.jpg", width: 1200, height: 630, alt: "Arc Studio pricing" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/brand/og-card.jpg"],
  },
};

// The public pricing page. Reachable signed-out in every auth mode — it is
// listed in PUBLIC_MARKETING_PATHS (`src/lib/auth/route-protection.ts`) so the
// proxy lets it through before any session check.
//
// Reads the sign-up flag on the server so the CTA tells the truth: while
// self-serve sign-up is closed it points at the waitlist rather than a
// /sign-up page that would turn the visitor away.
//
// ⚠️ This page prerenders as STATIC, so the flag is read at BUILD time. Setting
// ARC_SELF_SERVE_SIGNUP=1 reopens /sign-up immediately but will NOT change this
// page's CTA until the next deploy. That's consistent with how env changes work
// here anyway (a running deployment never picks up new env), but it means
// "reopen sign-up" is a flag flip *and* a redeploy — see BSR-505. Kept static
// deliberately: this is the page a stranger's first impression loads, and it has
// no per-request data beyond that one flag.
export default function PricingPage() {
  return <PricingView signupOpen={isSelfServeSignupOpen()} />;
}
