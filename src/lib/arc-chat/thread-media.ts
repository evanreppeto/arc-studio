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
  campaignId: string | null;
  assetId: string | null;
};

/**
 * Flatten one reply's creative for an inline panel.
 *
 * Two sources, because the runner writes to both and only one of them carries
 * the approval: an action card holds the asset it drafted AND the `{campaignId,
 * assetId}` that asset is pending under, while `metadata.media` is the reply's
 * media array with no approval attached. Cards are read first so a render that
 * appears in both comes back approvable rather than inert; the url is the
 * identity for that dedupe.
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
      campaignId: approval?.campaignId ?? null,
      assetId: approval?.assetId ?? null,
    });
  };
  for (const card of message.actions ?? []) push(card.media, card.approval, card.title ?? null);
  for (const media of message.media ?? []) push(media, undefined, null);
  return out;
}
