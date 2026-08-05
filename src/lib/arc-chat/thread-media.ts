import type { ArcActionApproval, ArcActionCard, ArcMedia } from "@/domain";

/**
 * One piece of creative Arc produced, flattened to what an inline review surface
 * needs: the file, what it is, and the approval it belongs to.
 *
 * `campaignId`/`assetId` are what make it actionable rather than decorative —
 * without them there is nothing to approve and the render is a picture you can
 * look at and not act on.
 */
export type ArcThreadMedia = {
  kind: "image" | "video";
  url: string;
  caption: string | null;
  format: string | null;
  /** Provenance as the runner tagged it — `ai_generated`, `composite`, … It is
   *  what tells a generated SCENE (safe to reuse as a canvas background, since
   *  generation strips text by design) from a finished COMPOSITE that already
   *  has the logo and copy burned into its pixels. */
  source: string | null;
  campaignId: string | null;
  assetId: string | null;
};

/**
 * Flatten one reply's creative for an inline panel.
 *
 * **Action cards are where the creative actually is.** Censused on prod
 * 2026-08-05 across all 51 Arc replies: `metadata.actions` carried media on 5
 * cards, and `metadata.media` was populated on **zero**. An earlier note here
 * claimed the runner "writes to both" — it does not, and reading that as parity
 * would send the next person looking in the wrong place. `metadata.media` is
 * still read below because the type allows it and a runner change would start
 * filling it, but treat it as the unused branch it is, not a co-equal source.
 *
 * A card is the only place the approval lives (`{campaignId, assetId}`), so
 * cards are read first: a url appearing in both must come back approvable rather
 * than inert. The url is the identity for that dedupe.
 *
 * Two things the census settled about the shape:
 * - `media.caption` was null on all five, so `card.title` is what actually names
 *   every tile an operator sees ("Service Van — Driveway Morning (Logo Added)").
 *   The fallback is load-bearing, not a nicety.
 * - Media rides on cards both WITH and WITHOUT an approval (4 and 1 of the 5), so
 *   both branches are real traffic. The panel renders the approval-less one as an
 *   unattached tile rather than offering a button with nothing behind it.
 * - `format` is free text from the runner ("4:3" appears, which is not one of
 *   Studio's four formats). It is displayed, never looked up — keep it that way.
 * - `source` was present on all five: 3 `ai_generated`, 2 `composite`. Studio
 *   only offers "Use as background" for the former — see the note there.
 *
 * Pure on purpose: `arc/actions.ts` is `"use server"` and may only export async
 * functions, and this is the piece worth testing.
 */
export function toArcThreadMedia(message: {
  media?: ArcMedia[] | null;
  actions?: ArcActionCard[] | null;
}): ArcThreadMedia[] {
  const out: ArcThreadMedia[] = [];
  const seen = new Set<string>();
  const push = (media: ArcMedia | undefined, approval: ArcActionApproval | undefined, fallbackCaption: string | null) => {
    if (!media?.url || seen.has(media.url)) return;
    seen.add(media.url);
    out.push({
      kind: media.kind === "video" ? "video" : "image",
      url: media.url,
      caption: media.caption?.trim() || fallbackCaption?.trim() || null,
      format: media.format ?? null,
      source: media.source ?? null,
      campaignId: approval?.campaignId ?? null,
      assetId: approval?.assetId ?? null,
    });
  };
  for (const card of message.actions ?? []) push(card.media, card.approval, card.title ?? null);
  // Unused on every prod row censused so far — see the note above. Kept so a
  // runner that starts populating metadata.media doesn't silently show nothing.
  for (const media of message.media ?? []) push(media, undefined, null);
  return out;
}
