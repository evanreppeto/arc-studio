/**
 * Is this campaign a batch of raw creative, rather than something that goes out?
 *
 * Studio cannot make approval-gated creative without attaching it to a campaign
 * — `generateStudioDraft` hard-fails with `no_campaign` — because the campaign
 * IS the approval gate. So a workspace that generates images accumulates
 * campaign rows that hold nothing but generation prompts, and they land in the
 * board's "Needs you" queue beside real outbound work.
 *
 * On the live workspace that was half the queue: "Suburban Home Background
 * Asset" and "Service Van — Driveway Morning", three image prompts each, filed
 * next to a flood-response campaign with an email and a landing page in it.
 *
 * This predicate lets the board GROUP them under their own heading. It
 * deliberately does not hide them: a misclassified row under the wrong heading
 * is a cosmetic problem, whereas hiding one would strand real undecided
 * creative on a screen with no other route to it.
 *
 * ## Why "every", not "any"
 *
 * A real campaign can legitimately contain an image prompt alongside its copy —
 * prod has one: "Pre-Winter Pipe & Water-Heater Check" holds an `email`, an
 * `image_prompt` and a `social_ad`. A predicate keyed on *containing* creative
 * would file that as a batch and pull a genuine outbound campaign out of the
 * approval queue.
 *
 * ## Why only these two types
 *
 * `image_prompt` and `video_prompt` are the raw generation requests. Studio's
 * *compose* path writes `social_ad` — a composed creative is a finished ad and
 * belongs to a campaign, so it is correctly not counted here.
 */

/** The generation-request asset types. Everything else is campaign material. */
const CREATIVE_ASSET_TYPES = new Set(["image_prompt", "video_prompt"]);

/**
 * Accepts raw enum values (`image_prompt`) and humanized labels
 * (`"Image Prompt"`) alike — the read-model humanizes `asset_type` before some
 * callers see it, and a classifier that silently answered `false` for one of
 * the two spellings would be worse than one that handles both.
 */
function normalizeAssetType(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isCreativeOnlyCampaign(assetTypes: readonly string[]): boolean {
  const types = assetTypes.map(normalizeAssetType).filter((type) => type.length > 0);
  // An empty campaign is not a creative batch — it is a campaign Arc has not
  // finished building, and it already has its own line on the board.
  if (types.length === 0) return false;
  return types.every((type) => CREATIVE_ASSET_TYPES.has(type));
}

/**
 * What a campaign IS, preferring what was declared over what can be inferred.
 *
 * `campaigns.kind` is set at creation by routes that know — a campaign made to
 * hold submitted variants was a creative batch the moment it existed. NULL
 * means nobody declared it, and the deliverables answer instead.
 *
 * Declared beats derived because contents move and intent does not. Prod has a
 * campaign that held `email, image_prompt, social_ad` one day and gained a
 * `video_prompt` the next; if Arc writes the creative before the copy, a
 * purely derived answer files it under "Creative from Studio" and then moves it
 * to the approval queue later. The operator sees the same work appear twice, in
 * two places, for reasons that are invisible to them.
 *
 * Existing rows are all NULL and stay that way — the derivation already
 * classifies them correctly, and a backfill would have been an UPDATE against
 * live data to reach the answer the app already gives.
 */
export type CampaignKind = "campaign" | "creative_batch";

export function isCampaignKind(value: unknown): value is CampaignKind {
  return value === "campaign" || value === "creative_batch";
}

export function resolveCampaignKind(
  declared: string | null | undefined,
  assetTypes: readonly string[],
): CampaignKind {
  if (isCampaignKind(declared)) return declared;
  return isCreativeOnlyCampaign(assetTypes) ? "creative_batch" : "campaign";
}
