/**
 * Fit scoring for records that arrive WITHOUT intent signals.
 *
 * `calculateLeadScore` answers "how hot is this inbound emergency?" — it is
 * built from standing water, an uploaded photo, an after-hours call. Those are
 * good proxies for intent and effort, but they only exist when someone came to
 * you. A contact you imported from a spreadsheet told you nothing: it never
 * filled in a form, so it scores the base 10 and stays there forever. Every
 * imported record therefore sat 20 points under the crm_inactivity floor of 60
 * and could never surface, no matter how long it had been quiet.
 *
 * Rather than loosen that floor — it was measured against the live inbox, and
 * the note on it warns that raising the bar past 60 starts discarding real
 * signals — this scores the different question an imported record can actually
 * answer: not "how hot is this?" but "is this worth contacting next?"
 *
 * Built only from what any business has about a record, with no restoration (or
 * any other vertical) assumptions:
 *
 *   fit        does it match a persona you sell to
 *   knowledge  do you know enough to say something specific
 *   reach      can you actually contact them
 *
 * Recency is deliberately NOT scored here. The cold-lead detector already adds
 * its own bonus for how long a record has been quiet, and counting it twice
 * would let age alone push weak records over the bar.
 */

export type LeadFitSignals = {
  /** A persona from the workspace's taxonomy — the closest thing to ICP fit. */
  hasPersona: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  /** A known company, which is what makes a message about their business. */
  hasCompany: boolean;
  /** City/state or similar — enough to reference where they are. */
  hasLocation: boolean;
};

/**
 * Base is low on purpose. A record with nothing but an email address should not
 * clear a quality bar, and this must not become a way for empty rows to qualify.
 */
const BASE_FIT_SCORE = 15;

const PERSONA_POINTS = 10;
const COMPANY_POINTS = 10;
const EMAIL_POINTS = 8;
const PHONE_POINTS = 5;
const LOCATION_POINTS = 5;

/** Ceiling of 53 — deliberately below any floor on its own. */
export const MAX_LEAD_FIT_SCORE =
  BASE_FIT_SCORE + PERSONA_POINTS + COMPANY_POINTS + EMAIL_POINTS + PHONE_POINTS + LOCATION_POINTS;

/**
 * How contactable and well-understood a record is, 15–53.
 *
 * Calibrated so it cannot qualify anything by itself: even a perfect record tops
 * out at 53, under the 60 floor. It only clears the bar once the detector's own
 * cold bonus is added — meaning a record still has to be genuinely quiet AND
 * genuinely well-formed to reach an operator. A bare email that has been silent
 * for a year gets 23 + 20 = 43 and is correctly ignored.
 */
export function calculateLeadFitScore(signals: LeadFitSignals): number {
  return (
    BASE_FIT_SCORE +
    (signals.hasPersona ? PERSONA_POINTS : 0) +
    (signals.hasCompany ? COMPANY_POINTS : 0) +
    (signals.hasEmail ? EMAIL_POINTS : 0) +
    (signals.hasPhone ? PHONE_POINTS : 0) +
    (signals.hasLocation ? LOCATION_POINTS : 0)
  );
}

/**
 * The quality figure the cold-lead detector should reason about.
 *
 * Takes whichever is higher. An inbound lead with real intent signals keeps its
 * earned score untouched — this can only ever raise a record that the intent
 * model had nothing to say about, which is exactly the imported case. Nothing
 * about existing inbound behaviour changes.
 */
export function effectiveLeadQuality(leadScore: number, fit: LeadFitSignals): number {
  return Math.max(leadScore, calculateLeadFitScore(fit));
}
