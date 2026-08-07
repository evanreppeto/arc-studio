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
  /**
   * Deliverables waiting on the OPERATOR.
   *
   * Was every deliverable with no decision recorded, which is a different and
   * larger set: it included the ones the operator had already sent back for
   * revision, so the board filed those under "Needs you" while the rail — which
   * has always used the narrower rule — left them out. Same question, two
   * answers, 19 against 15 on the live workspace.
   */
  awaitingCount: number;
};

/**
 * Does this campaign's own STATUS put it on a human's desk?
 *
 * `revise` counts. Note the asymmetry with the DELIVERABLE rule next door:
 * `assetAwaitsOperator` now excludes a deliverable sent back for revision,
 * because `isWaitingOnOperator` (`@/lib/approvals/read-model`) has always said
 * so — "You asked for changes. Arc is reworking it." The same argument probably
 * applies to a campaign whose OWN status is revision-requested, but that is a
 * different axis and no campaign in the live workspace is in that state, so
 * there is nothing to measure the change against. Left as-is deliberately
 * rather than changed on a hunch.
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
  return needsOperatorApproval(row.tone) || row.awaitingCount > 0;
}

/**
 * The tone the row's STATUS PILL should wear.
 *
 * `needsOperatorAttention` decided which section a row files under, but the pill
 * beside it kept rendering the raw campaign status — so on prod the live
 * workspace showed a card sitting under "Needs you" wearing a green **Approved**
 * pill, above a button reading "Review 6 assets", while the campaign's own
 * detail page said "Needs you · 1 of 7 approved". One campaign, three answers.
 *
 * The cause is that a campaign carries two states — its own `campaign_status`
 * and the state of the deliverables inside it — and the board printed the first
 * while filing by the second. The pill now answers the question the operator is
 * actually asking, which is "does this want something from me".
 *
 * Two deliberate exceptions:
 *
 *  - **`archived` is never promoted.** Something put away asks nothing, whatever
 *    it still holds.
 *  - **`review` and `revise` are left alone.** They already say "on your desk",
 *    and `revise` says it *more precisely* — flattening "Needs changes" into
 *    "Needs you" would lose which of the two it is.
 *
 * Section grouping is unaffected: a row promoted to `review` still satisfies
 * `needsOperatorAttention`, which is how it got promoted.
 */
export function deskTone(tone: CampaignTone, pendingCount: number): CampaignTone {
  if (tone === "archived") return tone;
  if (needsOperatorApproval(tone)) return tone;
  return pendingCount > 0 ? "review" : tone;
}
