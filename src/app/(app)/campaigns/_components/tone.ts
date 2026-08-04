/**
 * The campaign board's tone vocabulary, and the one definition of "waiting on you".
 *
 * Not a client module on purpose: the server page and the client board both need
 * these predicates, and every export of a "use client" module becomes a client
 * reference when a server component imports it.
 *
 * This exists because the board and its footer disagreed in front of the operator.
 * The "Needs approval" tab counted tone (4); the footer counted rows whose
 * *rendered* next-action string matched /Approve/ (9) and announced "Arc has 9
 * packages awaiting your approval" directly beneath a tab reading 4. Two answers to
 * one question on one screen — and the 9 was derived from a display label, so
 * rewording "Approve 1 piece" would have silently zeroed it.
 *
 * Both now call this. They cannot drift again without someone deleting it.
 */

export type CampaignTone = "live" | "review" | "revise" | "approved" | "draft" | "archived";

/** The two facts about a campaign that decide whether it is on the operator's desk. */
export type CampaignDeskState = {
  tone: CampaignTone;
  /** Deliverables on this campaign with no decision recorded. */
  pendingCount: number;
};

/**
 * Does this campaign's own STATUS put it on a human's desk?
 *
 * `revise` counts: a revision-requested or blocked campaign is on the operator's
 * desk just as much as one pending approval.
 *
 * Status alone is not the whole question — see `needsOperatorAttention`, which is
 * what the tab and its summary actually use. This stays exported because status
 * is a real, separately-meaningful fact, and callers that mean *only* status
 * should have to say so.
 */
export function needsOperatorApproval(tone: CampaignTone): boolean {
  return tone === "review" || tone === "revise";
}

/**
 * Is this campaign waiting on the operator, by any route? (BSR-726)
 *
 * A campaign asks something of you in one of two ways, and the board only ever
 * counted the first:
 *
 *   1. its own status is submitted / sent back (`needsOperatorApproval`), or
 *   2. it holds at least one deliverable with no decision recorded.
 *
 * Case 2 is the one prod actually has. Every campaign in the live workspace sits
 * at status `draft` while holding assets at `pending_approval`, so the row reads
 * "Approve 5 assets", the footer read "7 assets across 3 campaigns still
 * undecided", the campaign's own detail page showed a "Needs you" pill — and the
 * "Needs you" tab, the one filter built to collect the operator's queue, read 0
 * and returned an empty list.
 *
 * The tab is now the union, which is what its label has always claimed and what
 * every row beneath it already said.
 */
export function needsOperatorAttention(row: CampaignDeskState): boolean {
  return needsOperatorApproval(row.tone) || row.pendingCount > 0;
}
