// Public legal documents (BSR-522), a hard blocker on reopening self-serve
// signup (BSR-505) — you cannot take money from strangers without these.
//
// ⚠️ THESE ARE A DRAFTED BASELINE, NOT REVIEWED LEGAL ADVICE. They were written
// from what this system verifiably does — the subprocessor list below is derived
// from real dependencies and real connectors, not from a template — but they
// must be reviewed by counsel before self-serve signup opens.
//
// ⚠️ THREE FACTS CANNOT BE INVENTED and are left as visible placeholders:
// the legal entity name, its registered postal address, and the governing
// jurisdiction. A policy naming a company that does not exist is worse than no
// policy. `legal-documents.test.ts` inventories these so they cannot ship
// unnoticed, and the pages render an explicit notice while any remain.
//
// The postal address is separately load-bearing: outbound email is already
// blocked until one is set, because a physical address is a legal requirement
// on commercial email.

/** Placeholder sentinels. Replace every one, then delete it from this list. */
export const LEGAL_PLACEHOLDERS = [
  "[LEGAL_ENTITY]",
  "[REGISTERED_ADDRESS]",
  "[JURISDICTION]",
] as const;

export const ENTITY = {
  /** e.g. "Arc Studio, Inc." */
  name: "[LEGAL_ENTITY]",
  /** Also required on every commercial email — see the note above. */
  address: "[REGISTERED_ADDRESS]",
  /** e.g. "the State of Illinois, United States" */
  jurisdiction: "[JURISDICTION]",
  productName: "Arc Studio",
  contactEmail: "support@arc-studio.ai",
  privacyEmail: "privacy@arc-studio.ai",
  securityEmail: "security@arc-studio.ai",
} as const;

/** True while any placeholder is unresolved — drives the "not in effect" notice. */
export function hasUnresolvedPlaceholders(): boolean {
  const blob = JSON.stringify(ENTITY);
  return LEGAL_PLACEHOLDERS.some((p) => blob.includes(p));
}

export const LAST_UPDATED = "2026-07-31";

export type Subprocessor = {
  name: string;
  purpose: string;
  dataHandled: string;
  /** "core" ships to every workspace; "optional" only if a workspace enables it. */
  tier: "core" | "optional";
};

/**
 * Derived from what this system actually uses — `package.json` dependencies and
 * `src/domain/connectors.ts` — rather than from a generic template. If a
 * dependency or connector is added, it belongs here before it ships.
 */
export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Supabase",
    purpose: "Primary database, authentication, and file storage",
    dataHandled: "Account details, workspace records, CRM data, uploaded media",
    tier: "core",
  },
  {
    name: "Vercel",
    purpose: "Application hosting, edge routing, and product analytics",
    dataHandled: "Request metadata, IP addresses in transit, aggregate page analytics",
    tier: "core",
  },
  {
    name: "Anthropic",
    purpose: "The Claude models behind Arc's reasoning and drafting",
    dataHandled: "Prompt content: the records and instructions Arc reasons over",
    tier: "core",
  },
  {
    name: "Google Cloud (including Gemini)",
    purpose: "Agent runner execution, object storage, and generative models",
    dataHandled: "Prompt content, generated assets, run logs",
    tier: "core",
  },
  {
    name: "Stripe",
    purpose: "Subscription billing and payment processing",
    dataHandled: "Billing contact and payment details — handled by Stripe, never stored by us",
    tier: "core",
  },
  {
    name: "Resend",
    purpose: "Transactional email and approved campaign delivery",
    dataHandled: "Recipient addresses and message content for approved sends",
    tier: "core",
  },
  {
    name: "Sentry",
    purpose: "Error monitoring and diagnostics",
    dataHandled: "Error traces and limited request context",
    tier: "core",
  },
  {
    name: "Higgsfield",
    purpose: "Generative media, when a workspace enables the connector",
    dataHandled: "Generation prompts and resulting assets",
    tier: "optional",
  },
  {
    name: "HubSpot",
    purpose: "CRM import, when a workspace connects it",
    dataHandled: "Contact and company records the workspace chooses to import",
    tier: "optional",
  },
  {
    name: "Mailchimp",
    purpose: "Audience import, when a workspace connects it",
    dataHandled: "List and contact records the workspace chooses to import",
    tier: "optional",
  },
  {
    name: "Slack",
    purpose: "Operational alerts to a workspace's own channel",
    dataHandled: "Alert content only",
    tier: "optional",
  },
  {
    name: "Meta (Ad Library)",
    purpose: "Competitor ad intelligence, when enabled",
    dataHandled: "Public ad-library queries — no customer data sent",
    tier: "optional",
  },
  {
    name: "Google Business Profile",
    purpose: "Review monitoring, when a workspace connects it",
    dataHandled: "Public review content for the workspace's own listings",
    tier: "optional",
  },
  {
    name: "NOAA / National Weather Service",
    purpose: "Severe-weather signals for a workspace's service area",
    dataHandled: "Geographic queries only — no customer data sent",
    tier: "optional",
  },
];

export type LegalSection = { heading: string; body: string[] };

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "1. Agreement",
    body: [
      `These Terms govern your use of ${ENTITY.productName}, operated by ${ENTITY.name} ("we", "us"). By creating an account or using the service you agree to them. If you are agreeing on behalf of a company, you confirm you have authority to bind that company.`,
    ],
  },
  {
    heading: "2. What the service does",
    body: [
      `${ENTITY.productName} is a marketing system with an AI agent. The agent identifies opportunities from records you provide, drafts campaigns and creative, and presents them for your approval.`,
      "The agent does not send, publish, or spend on your behalf without your explicit approval of the specific item. This is enforced by the system rather than being a configurable preference.",
    ],
  },
  {
    heading: "3. Your responsibilities",
    body: [
      "You are responsible for the content you approve. Approval is the point at which a draft becomes your communication, and you are responsible for its accuracy, claims, and compliance with the laws that apply to your business and your recipients.",
      "You are responsible for having a lawful basis to contact the people in your workspace, including consent where required, and for honouring opt-outs. You must not upload data you do not have the right to process.",
      "You must not use the service to send unlawful, deceptive, or harassing messages, to impersonate others, or to attempt to circumvent the approval gate or any usage limit.",
    ],
  },
  {
    heading: "4. AI-generated output",
    body: [
      "Drafts and generated assets are produced by AI models and may contain errors, inaccuracies, or unintended similarity to existing material. They are suggestions for your review, not verified statements of fact.",
      "You should review every draft before approving it. We do not warrant that generated output is accurate, original, or fit for a particular purpose.",
    ],
  },
  {
    heading: "5. Plans, billing, and trials",
    body: [
      "Paid plans are billed in advance per workspace at the price shown at purchase. Trials, where offered, convert to a paid plan only if you choose to subscribe.",
      "Plans include a monthly allowance of AI processing. If a workspace reaches its allowance, AI features may pause until the next period or until the plan is changed; your data and existing records remain accessible.",
      "Fees are non-refundable except where required by law. You may cancel at any time, effective at the end of the current billing period.",
    ],
  },
  {
    heading: "6. Your data",
    body: [
      "You retain ownership of the data you put into the service and of the content you approve. You grant us the limited licence needed to host, process, and transmit it in order to operate the service.",
      "We do not sell your data. We do not use your workspace's customer data to train models for other customers.",
      "You can export or request deletion of your workspace data as described in the Privacy Policy.",
    ],
  },
  {
    heading: "7. Availability",
    body: [
      "We aim to keep the service available but do not guarantee uninterrupted operation. Maintenance, third-party outages, and incidents can interrupt it.",
      "The service is provided on an \"as is\" basis without warranties of any kind, to the extent permitted by law.",
    ],
  },
  {
    heading: "8. Limitation of liability",
    body: [
      "To the maximum extent permitted by law, our aggregate liability arising out of or relating to the service is limited to the amount you paid us in the twelve months before the event giving rise to the claim.",
      "We are not liable for indirect, incidental, or consequential damages, or for lost profits, revenue, or data.",
    ],
  },
  {
    heading: "9. Suspension and termination",
    body: [
      "We may suspend or terminate an account that breaches these Terms, creates a security or legal risk, or fails to pay. Where practical we will give notice and an opportunity to correct the problem.",
      "You may stop using the service at any time. On termination we will make your data available for export for a reasonable period before deletion.",
    ],
  },
  {
    heading: "10. Changes",
    body: [
      "We may update these Terms. For material changes we will give reasonable advance notice through the service or by email. Continuing to use the service after a change takes effect means you accept the updated Terms.",
    ],
  },
  {
    heading: "11. Governing law and contact",
    body: [
      `These Terms are governed by the laws of ${ENTITY.jurisdiction}, without regard to conflict-of-law rules.`,
      `${ENTITY.name}, ${ENTITY.address}. Questions: ${ENTITY.contactEmail}.`,
    ],
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "1. Scope",
    body: [
      `This policy explains how ${ENTITY.name} handles personal data in ${ENTITY.productName}, for both the people who use the service and the people whose records a customer stores in it.`,
      "Where a customer uses the service to process data about their own contacts, the customer is the controller of that data and we act as their processor.",
    ],
  },
  {
    heading: "2. What we collect",
    body: [
      "Account data: name, email address, workspace and organisation details, and authentication records.",
      "Workspace content: the CRM records, campaigns, approvals, media, and settings a customer creates or imports.",
      "Usage data: pages viewed, features used, agent run records, and AI processing volume for billing.",
      "Acquisition data: which channel referred a visit — campaign parameters, the referring site's host, and the landing page. This describes a channel, not a person: it never contains a name, an email address, or an IP address, and the referrer is reduced to its host before storage.",
      "Billing data: handled directly by Stripe. We store a customer identifier and subscription status, never card details.",
    ],
  },
  {
    heading: "3. Why we process it",
    body: [
      "To provide the service: authenticating you, storing your records, running the agent, and delivering the messages you approve.",
      "To bill you correctly and to apply the plan limits you agreed to, which requires measuring AI processing volume per workspace.",
      "To keep the service secure, investigate abuse, and diagnose faults when something breaks.",
      "To communicate with you about the service, including changes that affect you and notices about your plan or usage.",
    ],
  },
  {
    heading: "4. AI processing",
    body: [
      "Operating the agent means sending relevant workspace content to AI providers so they can draft and reason over it. Those providers are listed on the Subprocessors page.",
      "We do not use one customer's workspace data to train models for other customers, and we do not sell workspace data.",
      "Because the agent drafts rather than sends, AI output stays inside your workspace until a human approves it.",
    ],
  },
  {
    heading: "5. Sharing",
    body: [
      "We share personal data with the subprocessors listed on the Subprocessors page, each acting under contract and only to perform its function.",
      "We may disclose data where legally required, or to protect rights and safety. We will tell affected customers where we are permitted to.",
      "If the business is acquired, data may transfer as part of that transaction; the successor remains bound by this policy or an equivalent one.",
    ],
  },
  {
    heading: "6. Isolation and security",
    body: [
      "Each workspace's data is isolated at the database level through row-level security, not only in the interface, so one workspace's queries cannot reach another's records.",
      "Credentials for connected services are stored encrypted and are readable only by the workspace that supplied them.",
      "Access to production systems is limited to personnel who need it. No system is perfectly secure, and we do not claim otherwise.",
    ],
  },
  {
    heading: "7. Retention and deletion",
    body: [
      "We keep workspace data while the account is active. After termination we retain it for a limited period so it can be exported, then delete it.",
      "You can request export or deletion of a workspace's data at any time by contacting us. Some records may be retained where the law requires it, such as billing records.",
    ],
  },
  {
    heading: "8. Your rights",
    body: [
      "Depending on where you live, you may have rights to access, correct, delete, port, or restrict the processing of your personal data, and to object to certain processing.",
      `To exercise a right, contact ${ENTITY.privacyEmail}. If you are a contact stored in a customer's workspace, please contact that business directly — they control that data, and we will assist them in responding.`,
    ],
  },
  {
    heading: "9. Cookies",
    body: [
      "We use a session cookie to keep you signed in, and a first-party cookie that records which channel referred your visit. The latter holds campaign parameters, a referring host, and a landing path — no personal data.",
      "We do not use third-party advertising or cross-site tracking cookies.",
    ],
  },
  {
    heading: "10. International transfers",
    body: [
      "Our subprocessors are primarily based in the United States, and data may be processed there. Where required, transfers rely on appropriate safeguards such as standard contractual clauses.",
    ],
  },
  {
    heading: "11. Changes and contact",
    body: [
      "We will post material changes to this policy and update the date below.",
      `${ENTITY.name}, ${ENTITY.address}. Privacy questions: ${ENTITY.privacyEmail}. Security reports: ${ENTITY.securityEmail}.`,
    ],
  },
];
