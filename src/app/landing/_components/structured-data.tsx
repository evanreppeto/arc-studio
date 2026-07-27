import { SITE_URL } from "@/lib/seo/site";

/**
 * JSON-LD for the marketing page.
 *
 * Tells search engines what this thing *is* — an organization, a site, and a
 * software product — rather than leaving them to infer it from prose. This is
 * what lets a result show as a recognised entity instead of a bare blue link.
 *
 * Deliberately claims nothing that isn't true: no aggregateRating, no review
 * counts, no invented pricing. Fabricated review markup is both dishonest and a
 * documented way to earn a manual penalty, and "Arc Studio has 4.9 stars" would
 * be a lie while the product is pre-launch.
 */
export function StructuredData() {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Arc Studio",
        url: SITE_URL,
        logo: `${SITE_URL}/icon.png`,
        description:
          "Arc Studio builds Arc, an AI marketing operator that finds source-backed opportunities, drafts complete campaign packages and prepares creative — and never sends without human approval.",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "Arc Studio",
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-US",
      },
      {
        "@type": "SoftwareApplication",
        name: "Arc Studio",
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Marketing Automation",
        operatingSystem: "Web",
        url: SITE_URL,
        publisher: { "@id": `${SITE_URL}/#organization` },
        description:
          "An AI marketing operator that watches your CRM and engagement signals, files source-backed opportunities, drafts complete campaign packages across email, SMS, paid social and landing copy, and holds everything behind an explicit human approval before anything reaches a customer.",
        featureList: [
          "Source-backed opportunity detection from CRM and engagement signals",
          "Complete campaign packages with evidence attached",
          "Human approval gate on every outbound send",
          "Asset provenance and full audit trail",
          "Per-workspace brand voice, personas and isolation",
        ],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // Server-rendered constant, no user input — safe to inline.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
