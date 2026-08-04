# Positioning & Category

**Status: DECIDED 2026-07-30 (BSR-579).** This document is the source of truth for
who Arc Studio is sold to, what category it competes in, and what it claims. Every
public page, comparison, directory listing, ad, and the landing rewrite (BSR-525)
derives from it. If a marketing artifact contradicts this doc, the artifact is wrong.

Companion to `UNIVERSALITY.md`, which covers the same question from the product
side: that doc says the app must speak any tenant's vocabulary; this one says whose
vocabulary we go looking for first.

---

## 1. The decision in one table

The category question was hard because three of the four candidates in BSR-579 were
categories and one was a differentiator. They are different layers and all three are
needed:

| Layer | Choice | Job it does |
| --- | --- | --- |
| **Primary category** | AI marketing agent — **segment-qualified**, never bare | Rides growing category demand in the only place we can actually rank |
| **Secondary category** | Marketing automation alternative / done-for-you marketing | Bottom-funnel switching traffic, where budget already exists |
| **Claim** (not a category) | **Governed autonomy** — approval-gated, spend-capped, audited | Wins the deal once found; answers the objection the whole market is having |

**Do not chase the bare head term "AI marketing agent."** As of 2026 it is owned by
Salesforce Agentforce, HubSpot Breeze, Adobe, Braze Operator, Iterable Nova, and
Klaviyo Composer, plus a dense layer of listicle farms. We would spend the entire
quarter losing to companies with nine-figure content budgets. We compete on the
qualified long tail — the segment those products do not serve.

---

## 2. ICP — one segment, not three

**Owner-operator local and regional service businesses.**

The landing page currently names three personas (owner-operator, small in-house team,
agency). Three personas is not positioning; a page written for all three converts none
of them. We are picking the first.

### Definition, precise enough to write a page for

- **Size:** roughly 5–75 employees, $1M–$25M revenue.
- **Who owns marketing:** the owner or a GM, among five other jobs. There is no
  full-time marketer — at most one generalist or an office manager doing it part-time.
- **Revenue shape:** project- and job-based, heavily repeat and referral driven, with a
  CRM (or a spreadsheet) full of past customers nobody has time to follow up with.
- **Buying behavior:** credit card, decision in days not quarters, allergic to long
  onboarding and to anything that needs a consultant to configure.
- **What they use today:** an ops system (ServiceTitan, Jobber, Housecall Pro or
  similar), QuickBooks, a half-abandoned Mailchimp or Constant Contact account, and
  either an agency they are quietly unhappy with or nothing at all.

### Core verticals (drives BSR-584)

Restoration and remediation first — it is where our only real tenant lives, so proof
and dogfood land in-segment for free. Then HVAC / plumbing / electrical, roofing and
exteriors, commercial cleaning and facilities, landscaping and snow.

**Adjacent, revisit on evidence:** professional services with the same shape — law
firms, accounting and bookkeeping, insurance agencies, property management, med spa
and dental. Same "the owner owns marketing" dynamic, generally higher willingness to
pay. This is the designated escape hatch (see §7).

### Why this segment

1. **It is the only one where Arc is transformative rather than incremental.** A team
   with two marketers has some capacity; this buyer has none. The product replaces
   zero, not a fraction.
2. **Our proof will be in-segment anyway.** BSR is a restoration contractor. The
   dogfood workspace (BSR-585) and first case studies (BSR-595) land here for free.
3. **The features already built are shaped for it.** The weather connector and
   CRM-inactivity opportunity detection are local-services instincts, not B2B SaaS ones.
4. **The verticals are searchable.** Local service categories have clean, winnable
   search demand; "marketing operations platform" does not.

---

## 3. The claim every public page repeats

> **Arc Studio is an AI marketing agent for businesses without a marketing team: it
> finds the opportunity, drafts the campaign, and prepares the creative — and nothing
> reaches a customer without your approval.**

The existing hero — *"Marketing that runs itself. Decisions that stay yours."* — is
consistent with this and should survive the rewrite. The sentence above is the subhead
and the shape of every meta description.

---

## 4. Governance is the spine, on every page

Positioning decision: **lead with governance everywhere**, not as a closing
objection-handler.

The market objection is peaking exactly now. Gartner projects 40% of agentic AI
projects will fail and that a third of companies will damage customer experience by
deploying AI prematurely; the emerging consensus term for the answer is *governed
autonomy* — spend caps, approval gates, audit trails. We have all three as
**architecture, not settings**:

1. **Approval gate.** Nothing sends, publishes, launches, or spends without a human.
   There is no setting that disables it, and there never will be.
2. **Spend cap.** A per-workspace monthly cap (`PLANS[tier].monthlyCapCents` in
   `src/domain/plans.ts`) plus a media sub-cap, with cost shown before generating.
3. **Audit trail.** Provenance on every asset, and every approve / decline / revise
   decision recorded against the record it changed.

Every claim made about these must be true *today*. Anything aspirational is labelled
roadmap or left off — BSR-520's security review verifies the public claims.

---

## 5. What we are explicitly NOT

Recorded so it cannot drift. Each of these is a real temptation and each one costs a
quarter if taken:

- **Not an enterprise marketing cloud.** We do not compete with Braze, Adobe, or
  Salesforce, do not answer their RFPs, and do not build comparison pages against them.
- **Not a copywriting tool.** Jasper and its neighbours are a text box; we are the
  system of record. Never position on generation quality alone.
- **Not a fully autonomous agent — deliberately.** The landing page's "who it isn't
  for" line already says this and should stay: anyone who wants marketing to run
  itself completely is not our customer. This is a *feature* of the positioning.
- **Not a workflow builder.** We do not compete on visual automation canvases, and we
  will lose any feature-matrix comparison framed that way.
- **Not an email service provider.** Deliverability is not our claim.
- **Not a sales CRM.** The CRM exists to feed marketing, not to run a sales team.
- **Not ecommerce.** Catalog, abandoned cart, and product feeds are a different
  playbook and a different product. Out of scope.
- **Not agencies-as-ICP.** Agencies are a *distribution channel to* this ICP, not the
  ICP. That framing is better than the one in BSR-589 and that ticket should adopt it.

---

## 6. What this changes in the other M8/M9 tickets

Concrete downstream consequences — treat these as amendments to those tickets:

- **BSR-581 (keyword map).** Anchor on `[trade] marketing`, `marketing for [trade]`,
  `AI marketing agent for small business`, `marketing automation for [trade]`. Not the
  bare category term.
- **BSR-583 (comparisons).** **Reprioritize.** This ICP mostly is not evaluating
  HubSpot. Real order: (1) **vs. hiring an agency** — the actual competitor, on cost
  and control; (2) **vs. doing it yourself / ChatGPT plus a spreadsheet** — the honest
  status quo; (3) vs. Mailchimp / Constant Contact; (4) vs. HubSpot, lower priority
  than the ticket currently implies. Drop enterprise-agent comparisons entirely.
- **BSR-584 (industry pages).** Restoration first, then HVAC/plumbing, roofing,
  commercial cleaning.
- **BSR-587 (directories).** Choose SMB marketing automation and AI marketing
  categories. Not enterprise martech — category changes reset ranking history, so this
  is expensive to get wrong.
- **BSR-525 (landing rewrite).** Two required changes: cut from three personas to one,
  and **replace the B2B SaaS demo copy**. The sample timeline in
  `landing/_components/landing-sections.tsx` currently reads *"Pricing-page surge · 14
  accounts gone quiet · reply spike"* — that is a SaaS growth team's language and it
  actively contradicts this ICP. It should read like a service business: past customers
  who have not been contacted in six months, a storm in the service area, a quote that
  never got followed up.
- **BSR-589 (agency channel).** Reframe from "agencies as a segment" to "agencies
  serving these verticals as a route to the ICP."

---

## 7. Open tensions and the trigger to revisit

Stated honestly so a later reversal is a decision rather than a drift:

- **The $899 Scale tier may not fit this ICP.** Local service SMBs are famously
  low-willingness-to-pay. The plausible Scale buyer is a multi-location or franchise
  operator. Watch whether anyone actually buys it before building for it.
- **Churn risk is the known failure mode of this segment.** If retention is bad, the
  problem may be the segment rather than the product.
- **The escape hatch is upmarket, not sideways:** small professional-services firms
  (law, accounting, insurance) share the "owner owns marketing" dynamic and pay more.
  Moving there would keep the claim and the governance spine intact and change only the
  verticals.

**Revisit trigger:** if after two quarters of real signups this segment will not pay
past the $99 tier, or churns beyond an acceptable rate, reopen this decision and
evaluate the professional-services adjacency. Do not reopen it on anecdote.
