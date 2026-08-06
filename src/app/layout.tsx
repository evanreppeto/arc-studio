import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { DM_Sans, Fraunces, Geist, Geist_Mono, Inter, Oswald, Playfair_Display, Source_Serif_4, Space_Grotesk } from "next/font/google";

import { AttributionCapture } from "@/app/_components/attribution-capture";
import { getCurrentOrgId } from "@/lib/auth/org";
import { getAppSettings } from "@/lib/settings/store";

import "./globals.css";

// Editorial serif (Fraunces) — the signature display face used for hero/auth
// headlines only. Wired to the --ff-serif / --ff-editorial token contract that
// globals.css @theme reads. Weights 400/500/600 only (never 700 — not loaded).
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--ff-serif",
  display: "swap",
});

// Product grotesk (Geist) — body, labels, metrics → --ff-body / --ff-display.
const geist = Geist({
  subsets: ["latin"],
  variable: "--ff-body",
  display: "swap",
});

// Mono (Geist Mono) — identifiers, scores, timestamps → --ff-mono.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--ff-mono",
  display: "swap",
});

// ---------------------------------------------------------------------------
// The brand-kit typeface catalog (src/domain/brand-fonts.ts) — the faces a
// WORKSPACE can pick for its own creative, distinct from the three above, which
// are Arc Studio's own chrome and are not tenant-configurable.
//
// Declared here so the Brand page previews a choice in the real face rather than
// a substitute. Declaring a family costs almost nothing on the client: these
// generate @font-face rules, and a browser only downloads a face that rendered
// text actually uses — so a workspace pulls the one or two it picked, not all
// six. The renderer loads its own static .ttf copies server-side; this pair of
// sources is kept honest by the brand-fonts test.
// ---------------------------------------------------------------------------
const brandInter = Inter({ subsets: ["latin"], weight: ["400", "700"], variable: "--bf-inter", display: "swap" });
const brandDmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "700"], variable: "--bf-dm-sans", display: "swap" });
const brandSpaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "700"], variable: "--bf-space-grotesk", display: "swap" });
const brandSourceSerif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "700"], variable: "--bf-source-serif", display: "swap" });
const brandPlayfair = Playfair_Display({ subsets: ["latin"], weight: ["400", "700"], variable: "--bf-playfair", display: "swap" });
const brandOswald = Oswald({ subsets: ["latin"], weight: ["400", "700"], variable: "--bf-oswald", display: "swap" });

const BRAND_FONT_VARIABLES = [
  brandInter,
  brandDmSans,
  brandSpaceGrotesk,
  brandSourceSerif,
  brandPlayfair,
  brandOswald,
]
  .map((f) => f.variable)
  .join(" ");

// Canonical origin for absolute URLs in social cards. Falls back to the live
// domain so a share from any preview still resolves a real image.
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://arc-studio.ai";

const OG_TITLE = "Arc Studio — Marketing operations, with your approval";
const OG_DESCRIPTION =
  "Arc finds opportunities backed by real evidence, drafts the campaigns, and prepares the creative — and never sends anything without your sign-off.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  // Social sharing card. Without these, a link pasted into LinkedIn, X, Slack
  // or iMessage renders as a bare URL with no image or title.
  openGraph: {
    type: "website",
    siteName: "Arc Studio",
    url: SITE_URL,
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [{ url: "/brand/og-card.jpg", width: 1200, height: 630, alt: "Arc Studio — marketing that runs itself, decisions that stay yours" }],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: ["/brand/og-card.jpg"],
  },
  // Browser-tab + bookmark/home-screen icon: the gold "A" mark on the brand's
  // dark ground. A full set (favicon.ico, PNG favicon, apple-touch-icon, web
  // manifest) so every surface is branded — not just the tab. The static gallery
  // pages carry the same <link>s directly in their <head>.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  // Search-engine ownership verification. Set these on Vercel and redeploy;
  // undefined values are simply omitted from the head.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
};

export const viewport: Viewport = {
  themeColor: "#15151a",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Workspace-chosen theme, applied at the root so the signed-in app renders in
  // the saved accent/density/motion with no flash. Org is resolved best-effort:
  // pre-auth pages (no workspace) and env-less builds fall back to null → app
  // defaults (gold/comfortable/standard). The Appearance panel writes these keys
  // and revalidates the layout.
  const orgId = await getCurrentOrgId().catch(() => null);
  const { appearanceAccent, appearanceDensity, appearanceMotion } = await getAppSettings(orgId);
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${geist.variable} ${geistMono.variable} ${BRAND_FONT_VARIABLES}`}
      data-accent={appearanceAccent}
      data-density={appearanceDensity}
      data-motion={appearanceMotion}
      // --ff-editorial aliases the serif; --ff-display falls back to body in globals.
      style={{ ["--ff-editorial" as string]: "var(--ff-serif)" }}
    >
      <body>
        {children}
        {/* Page-view + conversion analytics for the public site. No cookies, no
            PII; respects Do Not Track. Mounted at the root so the landing page
            and the signed-in app are both covered. */}
        <Analytics />
        {/* Records WHICH CHANNEL brought this visitor, into a first-party cookie
            the server reads at waitlist/signup time (BSR-586). Complements
            <Analytics /> rather than duplicating it: Vercel counts the sessions,
            this one survives until the account is created so a workspace can be
            traced back to its source. Channel data only — never PII. */}
        <AttributionCapture />
      </body>
    </html>
  );
}
