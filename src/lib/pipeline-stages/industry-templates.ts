import { DEFAULT_PIPELINE_STAGES, type PipelineObjectKey, type PipelineStage } from "@/domain";
import { canonicalIndustryKey, type ProductIndustryKey } from "@/lib/product-language";

/**
 * Starter pipeline stages per industry — the stage equivalent of
 * `src/lib/personas/industry-templates.ts`.
 *
 * Until this existed, every workspace was seeded ONE general set
 * (`DEFAULT_PIPELINE_STAGES`) and told to rename it. That is a fine fallback and
 * a poor first impression: a law firm's leads arrived as
 * New → Validated → Qualified → Converted, which is nobody's intake process.
 *
 * THREE RULES THIS FILE FOLLOWS
 *
 * 1. `outcomes` is deliberately NOT varied. It is the revenue ledger — won,
 *    lost, paid, written off — and it means the same thing in every trade.
 *    Splintering it would fragment revenue reporting across tenants for no gain.
 *    Only `leads` and `jobs` carry the trade's vocabulary.
 *
 * 2. Every set keeps at least one `isWon` and one `isLost` terminal stage.
 *    Reporting reads the FLAGS, not the names (`src/domain/pipeline-stages.ts`),
 *    so a set without both would silently report zero conversion. The invariant
 *    is enforced by a test over every template rather than left to review.
 *
 * 3. These are starting points, not opinions to defend. A tenant renames,
 *    reorders, adds and archives them in Settings → Records → Stages. Seeding
 *    happens once, at workspace creation, and only when the org has no stages —
 *    so nothing here can move an existing tenant's reporting.
 */

const stage = (
  key: string,
  label: string,
  sortOrder: number,
  flags: Partial<Pick<PipelineStage, "isTerminal" | "isWon" | "isLost" | "isQualified">> = {},
): PipelineStage => ({
  key,
  label,
  sortOrder,
  isTerminal: flags.isTerminal ?? false,
  isWon: flags.isWon ?? false,
  isLost: flags.isLost ?? false,
  isQualified: flags.isQualified ?? false,
  active: true,
});

const won = { isQualified: true, isTerminal: true, isWon: true } as const;
const lost = { isTerminal: true, isLost: true } as const;
const qualified = { isQualified: true } as const;

/** Only the pipelines a trade actually says differently. Anything omitted inherits the general set. */
type StageTemplate = Partial<Record<PipelineObjectKey, readonly PipelineStage[]>>;

const TEMPLATES: Partial<Record<ProductIndustryKey, StageTemplate>> = {
  restoration: {
    leads: [
      stage("new", "New", 0),
      stage("contacted", "Contacted", 1),
      stage("inspection_scheduled", "Inspection scheduled", 2, qualified),
      stage("estimate_sent", "Estimate sent", 3, qualified),
      stage("approved", "Approved", 4, won),
      stage("lost", "Lost", 5, lost),
      stage("archived", "Archived", 6, { isTerminal: true }),
    ],
    jobs: [
      stage("pending", "Pending", 0),
      stage("scheduled", "Scheduled", 1, qualified),
      stage("mitigation", "Mitigation", 2, qualified),
      stage("repairs", "Repairs", 3, qualified),
      stage("completed", "Completed", 4, won),
      stage("canceled", "Canceled", 5, lost),
    ],
  },
  home_services: {
    leads: [
      stage("new", "New", 0),
      stage("contacted", "Contacted", 1),
      stage("quote_sent", "Quote sent", 2, qualified),
      stage("booked", "Booked", 3, won),
      stage("lost", "Lost", 4, lost),
      stage("archived", "Archived", 5, { isTerminal: true }),
    ],
    jobs: [
      stage("scheduled", "Scheduled", 0, qualified),
      stage("dispatched", "Dispatched", 1, qualified),
      stage("in_progress", "In progress", 2, qualified),
      stage("completed", "Completed", 3, won),
      stage("canceled", "Canceled", 4, lost),
    ],
  },
  professional_services: {
    leads: [
      stage("new_inquiry", "New inquiry", 0),
      stage("consultation", "Consultation", 1),
      // The stage that made this whole track necessary: a firm cannot open work
      // before clearing conflicts, and no general pipeline has a name for it.
      stage("conflict_check", "Conflict check", 2, qualified),
      stage("proposal_sent", "Proposal sent", 3, qualified),
      stage("engaged", "Engaged", 4, won),
      stage("declined", "Declined", 5, lost),
    ],
    jobs: [
      stage("active", "Active", 0, qualified),
      stage("on_hold", "On hold", 1),
      stage("delivered", "Delivered", 2, won),
      stage("withdrawn", "Withdrawn", 3, lost),
    ],
  },
  agency: {
    leads: [
      stage("new", "New", 0),
      stage("discovery", "Discovery", 1),
      stage("pitch", "Pitch", 2, qualified),
      stage("proposal_sent", "Proposal sent", 3, qualified),
      stage("won", "Won", 4, won),
      stage("lost", "Lost", 5, lost),
    ],
    jobs: [
      stage("kickoff", "Kickoff", 0, qualified),
      stage("in_production", "In production", 1, qualified),
      stage("client_review", "Client review", 2, qualified),
      stage("delivered", "Delivered", 3, won),
      stage("canceled", "Canceled", 4, lost),
    ],
  },
  healthcare: {
    leads: [
      stage("new", "New", 0),
      stage("contacted", "Contacted", 1),
      stage("consult_booked", "Consult booked", 2, qualified),
      stage("treatment_plan", "Treatment plan", 3, qualified),
      stage("accepted", "Accepted", 4, won),
      stage("declined", "Declined", 5, lost),
    ],
    jobs: [
      stage("scheduled", "Scheduled", 0, qualified),
      stage("confirmed", "Confirmed", 1, qualified),
      stage("completed", "Completed", 2, won),
      // A no-show is lost revenue for that slot, not a neutral filing action.
      stage("no_show", "No-show", 3, lost),
      stage("canceled", "Canceled", 4, lost),
    ],
  },
  real_estate: {
    leads: [
      stage("new", "New", 0),
      stage("contacted", "Contacted", 1),
      stage("showing", "Showing", 2, qualified),
      stage("offer", "Offer", 3, qualified),
      stage("under_contract", "Under contract", 4, qualified),
      stage("closed", "Closed", 5, won),
      stage("lost", "Lost", 6, lost),
    ],
    jobs: [
      stage("active", "Active", 0, qualified),
      stage("under_contract", "Under contract", 1, qualified),
      stage("closed", "Closed", 2, won),
      stage("fell_through", "Fell through", 3, lost),
    ],
  },
  saas: {
    leads: [
      stage("new", "New", 0),
      stage("qualified", "Qualified", 1, qualified),
      stage("trial", "Trial", 2, qualified),
      stage("demo", "Demo", 3, qualified),
      stage("closed_won", "Closed won", 4, won),
      stage("closed_lost", "Closed lost", 5, lost),
    ],
    jobs: [
      stage("onboarding", "Onboarding", 0, qualified),
      stage("active", "Active", 1, qualified),
      // Not terminal: an at-risk account is still live and still workable.
      stage("at_risk", "At risk", 2, qualified),
      stage("renewed", "Renewed", 3, won),
      stage("churned", "Churned", 4, lost),
    ],
  },
  ecommerce: {
    leads: [
      stage("new", "New", 0),
      stage("browsing", "Browsing", 1),
      stage("cart", "Cart", 2, qualified),
      stage("purchased", "Purchased", 3, won),
      stage("abandoned", "Abandoned", 4, lost),
    ],
    jobs: [
      stage("placed", "Placed", 0, qualified),
      stage("fulfilled", "Fulfilled", 1, qualified),
      stage("delivered", "Delivered", 2, won),
      stage("returned", "Returned", 3, lost),
      stage("canceled", "Canceled", 4, lost),
    ],
  },
};

/** Industries with a bespoke starter set. `general` is absent on purpose — it IS the fallback. */
export const INDUSTRIES_WITH_STAGE_TEMPLATES = Object.keys(TEMPLATES) as ProductIndustryKey[];

/**
 * The starter stages for an industry, per pipeline.
 *
 * Falls back to `DEFAULT_PIPELINE_STAGES` for `general`, for an unrecognised
 * industry, and for any single pipeline a template chose not to vary (which is
 * `outcomes`, everywhere).
 */
export function stagesForIndustry(industry?: string | null): Record<PipelineObjectKey, readonly PipelineStage[]> {
  const template = TEMPLATES[canonicalIndustryKey(industry)] ?? {};
  return {
    leads: template.leads ?? DEFAULT_PIPELINE_STAGES.leads,
    jobs: template.jobs ?? DEFAULT_PIPELINE_STAGES.jobs,
    outcomes: template.outcomes ?? DEFAULT_PIPELINE_STAGES.outcomes,
  };
}
