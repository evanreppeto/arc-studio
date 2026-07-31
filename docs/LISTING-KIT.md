# Listing Kit

**Purpose (BSR-587):** one canonical source for every directory, review-platform, and
marketplace listing, so submitting a new one is an hour rather than a project.
Copy from here. Do not re-write descriptions per platform — divergent listings are
how a product ends up describing itself four different ways.

Positioning source of truth is `docs/POSITIONING.md`. If this file and that one
disagree, that one wins and this file is stale.

---

## 0. Read this before submitting anything

**Self-serve signup is currently CLOSED.** On production, `/sign-up` returns a 307 to
the waitlist (verified 2026-07-30). A directory listing sends buyers to a "get
started" button; today that button lands on a waitlist form.

That has three consequences, and they are the reason this kit exists before the
listings do:

1. **A listing published now converts into a waitlist, not a trial.** The single
   biggest lever on a directory listing's conversion is a working self-serve path.
2. **Category ranking history starts accruing the day you publish.** Publishing into
   a poor-converting funnel teaches the platform your listing is weak, and that is
   slow to undo.
3. **Reviews cannot accumulate without customers using the product** (BSR-594), and a
   G2 profile with zero reviews ranks near the floor regardless of how good the copy is.

**Recommended sequencing:**

| Do now | Wait for |
| --- | --- |
| Prepare this kit (done) | **BSR-505** — reopen self-serve signup |
| **Claim** profiles so the name is reserved and nobody squats it | **BSR-586** — attribution, so listing traffic is measurable |
| Decide categories (below) | **BSR-594** — review program, so profiles are not empty |

Claiming a profile is not the same as publishing a fully populated one. Claim early,
populate when the funnel is real.

---

## 1. Category selection — decide once, changing it is expensive

Directory profiles carry ranking history, and a category change generally resets it.
Per BSR-579 the category is **AI marketing agent, segment-qualified — never bare**,
with marketing automation as the secondary.

**Choose, in order of preference where the platform offers them:**

- Marketing Automation → **Small Business** / SMB sub-category where one exists
- AI Marketing / AI Agents
- CRM only as a *secondary* category, never primary — we are not a sales CRM and
  ranking there invites comparisons we lose

**Do not select:** Enterprise Marketing Cloud · Sales Force Automation · Customer Data
Platform · Email Service Provider · E-commerce Marketing. Each one puts us in front of
the wrong buyer and against incumbents we have deliberately chosen not to fight.

---

## 2. Copy blocks

Use verbatim. All three lengths say the same thing at different resolutions.

### Product name
```
Arc Studio
```

### Tagline (under 60 chars)
```
Marketing that runs itself. Decisions that stay yours.
```

### Short description (~20 words, for cards and category listings)
```
An AI marketing agent for businesses without a marketing team. It drafts the
campaign; nothing sends without your approval.
```

### Medium description (~50 words, the most-used length)
```
Arc Studio is an AI marketing agent for owner-run service businesses. It watches
your customer records and your service area, files opportunities with the evidence
attached, and drafts complete campaigns — email, SMS, paid social, landing copy.
Nothing reaches a customer until you approve it.
```

### Long description (~150 words, for the profile body)
```
Arc Studio is an AI marketing agent built for businesses that do not have a
marketing team — where marketing is the owner's fourth job.

Arc works from your own records rather than a blank prompt. It watches customers
who have gone quiet, referral partners who stopped sending work, severe weather in
your service area, and campaigns worth repeating, then files each one as an
opportunity with its evidence attached. From there it drafts the whole package:
email, SMS, paid social, and landing copy, with your brand and your proof.

Then it stops. Nothing sends, publishes, or spends without a human approving it,
and there is no setting that turns that gate off. Every decision is recorded
against the record it changed.

Your workspace speaks your industry's language from day one, and your CRM, personas,
and campaign history stay yours.
```

### Feature bullets (all verified — see §5 before adding any)
```
- Opportunity inbox with the evidence behind every recommendation
- Complete campaign packages: email, SMS, paid social, landing copy
- Human approval required on every outbound action — no override setting
- CRM that relabels itself to your industry's vocabulary
- Personas seeded for your industry, with message angles written
- Provenance on every asset: source, model, format, reviewer, risk flags
- Journey tracking from send through delivery, open, click, and reply
- Imports from HubSpot, Mailchimp, and CSV
- Signals from weather, news and feeds, reviews, and competitor ad activity
- Workspace data isolated at the database level, not just in the UI
```

### Pricing block
```
Starter $99/mo · Pro $299/mo · Scale $899/mo
Flat per workspace, unlimited seats. Annual billing is two months free.
14-day free trial, no credit card required.
```
No public free tier. `free` is the default/lapsed state, not a sold plan — do not
list it as one.

---

## 3. Asset inventory

All paths are in `public/`. Every product screenshot is the real application.

| Asset | Path | Use |
| --- | --- | --- |
| Logo mark | `brand/arc-mark.png` | Square avatar / favicon slots |
| Wordmark | `brand/arc-studio-wordmark.png` | Header / banner slots |
| Full logo | `brand/arc-logo.png` | General purpose |
| Social card | `brand/og-card.jpg` (1200×630) | Open Graph / banner |
| Arc chat | `brand/landing/app/arc.png` | Lead screenshot — shows the agent |
| Opportunities | `brand/landing/app/opportunities.png` | The evidence inbox |
| Campaigns | `brand/landing/app/campaigns.png` | Approval flow |
| CRM | `brand/landing/app/crm.png` | Records + vocabulary |
| Home | `brand/landing/app/home.png` | Command center |
| Analytics | `brand/landing/app/analytics.png` | Performance |
| Brain | `brand/landing/app/brain.png` | Memory / knowledge graph |

**Recommended screenshot order** where a platform allows several: Arc chat →
Opportunities → Campaigns → CRM. That sequence tells the story in the order the
product actually works, and leads with the differentiator.

**Screenshot rule:** only ship images of the real application. Do not mock up a
screen for a listing — the same rule that governs the industry pages.

---

## 4. Where to list

### 4a. Review platforms — operator-only, requires account creation

These need an account and identity verification, which only a human can do. Claim
the profile so the name is reserved; populate when signup reopens.

| Platform | Notes |
| --- | --- |
| G2 | Highest-value. Ranking is driven by review volume and recency (BSR-594). |
| Capterra | Gartner-owned; a submission also feeds GetApp and Software Advice. |
| GetApp / Software Advice | Usually inherited from the Capterra profile — check before duplicating effort. |
| TrustRadius | Lower volume, but reviews are long-form and rank well. |

### 4b. Integration marketplaces — the cheapest real distribution

**The highest-value bucket, and nearly free, because the integrations already exist.**
Each one puts Arc Studio in front of an audience that has already bought the adjacent
problem. Verified against `src/domain/connectors.ts`:

| Marketplace | What we actually integrate | Where it lives |
| --- | --- | --- |
| HubSpot App Marketplace | HubSpot CRM import, real OAuth flow | `/api/connectors/hubspot/*` |
| Slack App Directory | Slack alerts via incoming webhook | `slack_alerts` connector |
| Mailchimp integrations | Mailchimp list import | `mailchimp_import` connector |
| Google Workspace Marketplace | Google Drive picker, Google Business Profile reviews | `/api/integrations/google-drive/*` |

Review each marketplace's technical requirements before committing — several require a
published app, a security review, or a support SLA that we may not want to sign up to
before M7 closes.

### 4c. AI tool directories — be selective

Many are link farms whose backlinks are worth nothing and can be actively harmful.
Before submitting anywhere, check: does it have real organic traffic, does it
moderate submissions, and would a buyer actually browse it? If the answer to any is
no, skip it. A shorter list of real directories beats a long list of farms.

---

## 5. Accuracy rules

Everything in §2 is verified against the codebase as of the review date below. Before
adding a bullet or a claim to any listing:

- **Verified capability only.** No roadmap items in present tense.
- **Do not claim media generation without qualification.** Both engines are gated on
  per-workspace credentials; generation is not on by default.
- **Do not claim deliverability superiority.** We are newer than the email platforms
  and have not earned that claim.
- **Do not claim a free tier.** There is no public one.
- **Do not claim SOC 2 or any certification we do not hold.** Security claims belong
  on the trust page (BSR-596) and must pass the BSR-520 review first.
- **Do not invent customer counts or logos.** Same honest-numbers rule as M9.

---

## 6. Attribution — do this from the first listing

Every listing's outbound link gets its own tagged URL so BSR-586 can tell which
directory actually produced signups. Convention:

```
https://arc-studio.ai/?utm_source=<platform>&utm_medium=directory&utm_campaign=listing
```

Examples: `utm_source=g2`, `utm_source=capterra`, `utm_source=hubspot-marketplace`.

Never put personal data in these URLs. Where a platform allows a deep link, point
category traffic at the most relevant page — an industry page for a trade-specific
directory, `/compare` for a comparison-shopping context — rather than always the root.

---

**Last reviewed:** 2026-07-30. Re-check §2 and §5 whenever the product ships something
material, and re-check §0 the moment self-serve signup reopens.
