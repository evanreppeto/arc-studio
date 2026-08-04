// Comparison page content (BSR-583).
//
// Data, not prose-in-JSX, so a new comparison is a content change rather than an
// engineering project — and so the sitemap can derive its entries from the same
// list that renders the pages (a page that ships un-indexed defeats the point).
//
// Three rules from the ticket, encoded here because they are easy to erode:
//
//  1. NO FABRICATED FEATURE MATRICES. Every factual claim about another product
//     is either a category-level statement that is uncontroversially true, or it
//     carries a citation in `sources`. Competitor pricing specifics are avoided
//     deliberately — they change often, and a stale number is a false claim.
//  2. EVERY COMPARISON STATES WHERE WE LOSE. `betterChoice` is required, not
//     optional. It converts better than pretending to win everywhere, and it is
//     the only version that survives being read by the competitor.
//  3. COMPARISONS GO STALE INTO LIES. `lastReviewed` is rendered on the page.
//     When a competitor ships something material, re-check the rows and move the
//     date — an unreviewed comparison is a liability, not an asset.
//
// Positioning source of truth is `docs/POSITIONING.md`. The order below is the
// amended priority from BSR-579: this ICP is choosing between an agency, doing
// it themselves, and nothing — they are mostly not running a HubSpot evaluation.

export type ComparisonRow = {
  /** What is being compared. Kept short — it is a column label on mobile. */
  dimension: string;
  arc: string;
  other: string;
};

export type ComparisonSource = { label: string; url: string };

export type Comparison = {
  slug: string;
  /** Label in the index grid and breadcrumbs. */
  shortLabel: string;
  /** Column header for the non-Arc side of the table. */
  otherLabel: string;
  /** <h1>. Lead clause + accented clause, matching the landing/pricing rhythm. */
  title: string;
  titleAccent: string;
  metaTitle: string;
  metaDescription: string;
  lede: string;
  /** The honest summary. If someone reads one paragraph, this is it. */
  shortAnswer: string;
  rows: ComparisonRow[];
  betterChoiceTitle: string;
  betterChoice: string[];
  sources?: ComparisonSource[];
  /** ISO date. Rendered publicly — see rule 3 above. */
  lastReviewed: string;
};

const REVIEWED = "2026-07-30";

export const COMPARISONS: Comparison[] = [
  {
    slug: "vs-agency",
    shortLabel: "vs. a marketing agency",
    otherLabel: "A marketing agency",
    title: "The agency does the thinking.",
    titleAccent: "Arc does the every-week part.",
    metaTitle: "Arc Studio vs. Hiring a Marketing Agency — An Honest Comparison",
    metaDescription:
      "For service businesses without a marketing team: what an agency genuinely does better, what software does better, and what each one actually costs per month.",
    lede: "Most owners we talk to are not choosing between two apps. They are choosing between paying an agency, doing it themselves, or doing nothing.",
    shortAnswer:
      "An agency brings judgment, relationships, and hands you cannot hire part-time. Arc Studio brings continuous execution at a fraction of the cost, working from your own customer records rather than a monthly brief. If you need someone to rethink your positioning, hire the agency — that is real work and it is worth paying for. If what you actually need is last year's customers followed up with every week, that was never a retainer problem.",
    rows: [
      {
        dimension: "Typical monthly cost",
        arc: "$99–$899 flat per workspace, unlimited seats.",
        other:
          "Small-business retainers commonly run $1,500–$4,000 a month for local SEO, social, or ads management.",
      },
      {
        dimension: "Where the ideas come from",
        arc: "Your CRM, your past jobs, and live signals in your service area — each opportunity filed with its evidence attached.",
        other: "A monthly strategy call and whatever brief comes out of it.",
      },
      {
        dimension: "Turnaround on a new campaign",
        arc: "Minutes. You are approving, not briefing.",
        other: "Days to weeks, depending on the queue you are in.",
      },
      {
        dimension: "What happens in a quiet month",
        arc: "Arc keeps scouting and filing opportunities whether or not you log in.",
        other: "Work generally pauses until the next call.",
      },
      {
        dimension: "When the relationship ends",
        arc: "Records, drafts, decisions, and everything learned stay in your workspace.",
        other: "The institutional knowledge leaves with the account manager.",
      },
      {
        dimension: "Who approves what goes out",
        arc: "You do, on every single outbound piece. There is no setting that turns it off.",
        other: "Depends entirely on your agreement — many retainers include send authority.",
      },
      {
        dimension: "Strategy and brand judgment",
        arc: "Limited by design. Arc executes against the brand and voice you give it.",
        other: "This is the part you are genuinely paying for.",
      },
    ],
    betterChoiceTitle: "When an agency is the better choice",
    betterChoice: [
      "You need positioning, brand, or a category decision made. That is human judgment work and software is not close to replacing it.",
      "You need hands in the physical world — a photo shoot, a video crew, an event, a trade show booth.",
      "You are buying media at real spend, where an experienced buyer earns the fee back in wasted budget alone.",
      "You want someone accountable to a number who will sit in a meeting and answer for it. Software does not take responsibility.",
      "Worth saying plainly: keeping an agency for quarterly strategic work and using Arc for the weekly execution is a perfectly good answer, and it is what several of our best-fit customers do.",
    ],
    sources: [
      {
        label: "Marketing agency retainer cost guide (2026)",
        url: "https://www.webfx.com/blog/marketing/marketing-agency-cost/",
      },
    ],
    lastReviewed: REVIEWED,
  },

  {
    slug: "vs-doing-it-yourself",
    shortLabel: "vs. ChatGPT and a spreadsheet",
    otherLabel: "ChatGPT and a spreadsheet",
    title: "The writing was never the bottleneck.",
    titleAccent: "Knowing who to send it to was.",
    metaTitle: "Arc Studio vs. Doing It Yourself with ChatGPT and a Spreadsheet",
    metaDescription:
      "A chat window writes a good email in ten seconds. Here is the honest account of what it cannot do, and when doing it yourself is genuinely the right call.",
    lede: "This is the real status quo for most service businesses, and it deserves a straight comparison rather than a strawman.",
    shortAnswer:
      "ChatGPT will write you a better email than most agencies will, in ten seconds, for free. That is true, and we are not going to pretend otherwise. What a blank prompt cannot do is know which forty customers should get it, remember what you sent in March, or stop you emailing someone who asked you to leave them alone. The writing was never the hard part of marketing a service business — the follow-through was.",
    rows: [
      {
        dimension: "Cost",
        arc: "$99–$899 a month.",
        other: "Free, or the price of a chat subscription you already pay for.",
      },
      {
        dimension: "Quality of the writing",
        arc: "Comparable — the same class of model is doing the drafting.",
        other: "Comparable. We are not claiming to write better prose.",
      },
      {
        dimension: "Where it starts",
        arc: "Your records: who has gone quiet, which job types repeat, what just happened in your service area.",
        other: "A blank prompt and whatever you can remember to type into it.",
      },
      {
        dimension: "Deciding who to contact",
        arc: "Arc files opportunities with the evidence attached, so the list comes with a reason.",
        other: "You, from memory, usually late on a Sunday.",
      },
      {
        dimension: "Memory across months",
        arc: "Every send, decision, and outcome recorded against the customer it touched.",
        other: "The chat window, until you close the tab.",
      },
      {
        dimension: "Unsubscribes and suppression",
        arc: "Enforced automatically on every send.",
        other: "A column in the spreadsheet that you have to remember to check.",
      },
      {
        dimension: "Opt-out link and required footer",
        arc: "Added to every outbound message.",
        other: "Yours to remember, every time.",
      },
      {
        dimension: "Getting it out the door",
        arc: "Approve it and Arc sends it.",
        other: "Copy, paste, reformat, into whatever tool actually sends.",
      },
    ],
    betterChoiceTitle: "When doing it yourself is the better choice",
    betterChoice: [
      "You send a handful of emails a year. A monthly subscription is overkill and we would rather tell you now than churn you in month three.",
      "You genuinely enjoy the work and have the hours for it. Arc's value is the hours, not the words.",
      "You are still testing whether marketing moves the needle for your business at all. Prove it by hand first, then automate the thing that worked.",
      "Your customer list lives in one place, is small enough to hold in your head, and you talk to most of them anyway.",
    ],
    lastReviewed: REVIEWED,
  },

  {
    slug: "vs-email-platforms",
    shortLabel: "vs. Mailchimp and Constant Contact",
    otherLabel: "Mailchimp / Constant Contact",
    title: "They are built to send.",
    titleAccent: "Arc is built to decide what to send.",
    metaTitle: "Arc Studio vs. Mailchimp and Constant Contact",
    metaDescription:
      "Email platforms hand you an empty campaign and a template library. An honest look at what changes when the campaign arrives already drafted from your customer records.",
    lede: "These are good products with long track records, and this comparison is not an attempt to take their core job away from them.",
    shortAnswer:
      "Mailchimp and Constant Contact are built to send email reliably, and they are better at that than most things. The difference is everything that happens before the send. They hand you an empty campaign and a template library, and the hard question — what is worth sending this week, and to whom — is still yours. Arc decides that from your customer records, drafts every asset, and brings it to you for approval.",
    rows: [
      {
        dimension: "Sending email",
        arc: "Yes, as a supported path once you have approved the message.",
        other: "Yes — this is their core strength and their reason to exist.",
      },
      {
        dimension: "Deliverability track record",
        arc: "Newer. We do not claim to beat them on this and you should not assume we do.",
        other: "Years of sending infrastructure and sender reputation behind them.",
      },
      {
        dimension: "Where a campaign starts",
        arc: "An opportunity Arc filed from your records, with the evidence attached.",
        other: "An empty campaign and a template picker.",
      },
      {
        dimension: "What the AI does",
        arc: "Decides what is worth running, then drafts the complete package for approval.",
        other:
          "Helps you write and time what you have already decided to run — content generation, send-time optimization, segment suggestions.",
      },
      {
        dimension: "Beyond email",
        arc: "SMS, paid social, landing copy, and creative arrive as one package.",
        other: "Email-centric, plus each vendor's own adjacent products.",
      },
      {
        dimension: "Customer records",
        arc: "A CRM the marketing actually reads from — job history, personas, relationship stage.",
        other: "Lists, audiences, and segments.",
      },
      {
        dimension: "Decision trail",
        arc: "Every approve, decline, and revision recorded against the record it changed.",
        other: "Standard campaign scheduling and send history.",
      },
    ],
    betterChoiceTitle: "When an email platform is the better choice",
    betterChoice: [
      "You want the cheapest reliable way to send a newsletter to a list. That is precisely what they are for and they do it well.",
      "Deliverability at high volume is your first concern. They have sending reputation that we simply have not had time to build.",
      "You run ecommerce. Product feeds, abandoned-cart flows, and store integrations are a different playbook and we do not compete there.",
      "You already have someone whose job is to plan the campaigns. Planning is the part Arc replaces — if it is already covered, you are paying for less than you think.",
    ],
    sources: [
      {
        label: "Constant Contact and Mailchimp feature comparison (2026)",
        url: "https://www.constantcontact.com/compare-constant-contact-to-mailchimp",
      },
    ],
    lastReviewed: REVIEWED,
  },

  {
    slug: "vs-hubspot",
    shortLabel: "vs. HubSpot",
    otherLabel: "HubSpot",
    title: "HubSpot is built for a marketing team.",
    titleAccent: "Arc is built for not having one.",
    metaTitle: "Arc Studio vs. HubSpot — Which Fits a Business Without a Marketing Team",
    metaDescription:
      "HubSpot wins on breadth and it is not close. The real question is who is expected to operate it. An honest comparison for owner-run service businesses.",
    lede: "If you are comparing these two seriously, the deciding factor is usually not the feature list.",
    shortAnswer:
      "HubSpot is a large, genuinely capable platform built to be operated by a marketing team. If you have one, it is hard to argue against and we will not try. Arc Studio is built for the business that does not have one, where marketing is the owner's fourth job. The difference is not feature count — HubSpot wins that comfortably. The difference is who is expected to do the work once the tool is bought.",
    rows: [
      {
        dimension: "Who operates it",
        arc: "Arc does the work and brings it to you. You approve.",
        other: "Your marketing team operates the platform.",
      },
      {
        dimension: "What happens before you get value",
        arc: "Connect your records, confirm your brand, approve the first campaign.",
        other: "Meaningful configuration, often with an onboarding package or a partner.",
      },
      {
        dimension: "Breadth",
        arc: "Deliberately focused: opportunity to campaign to approval to outcome.",
        other: "Very broad — marketing, sales, service, CMS, and operations.",
      },
      {
        dimension: "Pricing shape",
        arc: "Flat per workspace with unlimited seats. It does not grow with your list.",
        other: "Tiered by hub and contact volume, so cost scales as your database does.",
      },
      {
        dimension: "What the AI does",
        arc: "Drafts the complete campaign package from your records, then waits for approval.",
        other: "Breeze AI assists across the platform's existing workflows.",
      },
      {
        dimension: "Sales CRM depth",
        arc: "Records exist to feed marketing. This is not a sales CRM.",
        other: "A real sales CRM with pipelines, sequences, quotes, and forecasting.",
      },
      {
        dimension: "Best fit",
        arc: "An owner-operator or a small team with nobody whose job is marketing.",
        other: "An in-house team with someone to run it day to day.",
      },
    ],
    betterChoiceTitle: "When HubSpot is the better choice",
    betterChoice: [
      "You have a marketing team, or you are about to hire one. Their tooling is deeper and their ecosystem is enormous.",
      "You need a real sales CRM — pipelines, quotes, sequences, forecasting. We are not that and we are not trying to become it.",
      "You need a large integration ecosystem or a partner network to lean on.",
      "Configurable reporting depth matters more to you than execution. Theirs goes further than ours.",
      "You are already running it successfully. Switching costs are real and we are not going to pretend they are not.",
    ],
    lastReviewed: REVIEWED,
  },
];

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((c) => c.slug === slug);
}

/** Slugs for `generateStaticParams` and for the sitemap's derived entries. */
export const COMPARISON_SLUGS = COMPARISONS.map((c) => c.slug);
