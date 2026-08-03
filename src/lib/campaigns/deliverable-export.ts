import { type CampaignWorkspaceAsset } from "./read-model";

/**
 * "Let me keep this and send it myself" — the download half of the BYO posture.
 *
 * `external-send.ts` already hands an operator an approved EMAIL: subject, HTML,
 * plain text, and a resolved audience CSV, with attribution stamped in. But it
 * is email-shaped end to end (it builds an email payload and resolves an email
 * audience), so an approved SMS, ad, landing page, or creative brief had no way
 * out of the app at all. This module is the channel-agnostic complement: it
 * turns any approved deliverable — or a whole campaign's worth of them — into a
 * Markdown file the operator can keep, paste, or hand to whoever sends.
 *
 * Two rules carry over from the send path and are not negotiable here:
 *
 * 1. **The approval gate applies to leaving, not just to sending.** Only an
 *    asset an operator actually approved is exportable. Draft copy must not
 *    escape the review loop just because the exit is a file instead of a wire.
 * 2. **The app still sends nothing.** This produces text. Whether it ever
 *    reaches a person is the operator's decision, made in their own tool.
 *
 * Pure by construction — `now` is injected rather than read — so the output is
 * deterministic and testable.
 */

/** An approved asset is the only exportable one. Mirrors external-send's gate. */
export function isExportable(asset: Pick<CampaignWorkspaceAsset, "status">): boolean {
  return /^approved/i.test(asset.status);
}

export const NOTHING_APPROVED =
  "Nothing here is approved yet. Approve a deliverable first — the export gate is the same as the send gate.";

/** Filesystem-safe slug for a download filename. Never returns an empty string. */
export function exportSlug(title: string): string {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "deliverable";
}

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body}\n`;
}

/**
 * One approved deliverable as Markdown: what it is, what it says, and what
 * came attached. Media are listed as links rather than embedded — the file
 * stays plain text, and the URLs are the same ones the Library serves.
 */
export function buildDeliverableExport(
  asset: CampaignWorkspaceAsset,
  context: { campaignName: string; now: string },
): string {
  const lines: string[] = [`# ${asset.title}\n`];

  lines.push(
    [
      `- **Campaign:** ${context.campaignName}`,
      `- **Channel:** ${asset.channel || "—"}`,
      `- **Status:** ${asset.status}`,
      `- **Exported:** ${context.now}`,
    ].join("\n") + "\n",
  );

  const body = asset.body.trim();
  lines.push(section("Copy", body || "_This deliverable carries no copy — see the attached media below._"));

  const attachable = asset.media.filter((m) => m.origin !== "referenced");
  if (attachable.length > 0) {
    lines.push(
      section(
        "Attached media",
        attachable.map((m) => `- [${m.title}](${m.url})${m.mimeType ? ` — ${m.mimeType}` : ""}`).join("\n"),
      ),
    );
  }

  const notes = asset.complianceNotes.trim();
  if (notes) lines.push(section("Compliance notes", notes));

  if (asset.blockedPhrases.length > 0) {
    lines.push(section("Blocked phrases found in this copy", asset.blockedPhrases.map((p) => `- ${p}`).join("\n")));
  }

  return lines.join("\n");
}

/**
 * Every approved deliverable in one file — "download the campaign". Unapproved
 * work is omitted rather than marked, so the file cannot be mistaken for a
 * record of what was reviewed.
 */
export function buildCampaignExport(
  campaign: { name: string; persona: string; objective: string | null },
  assets: CampaignWorkspaceAsset[],
  now: string,
): { content: string; approvedCount: number; omittedCount: number } {
  const approved = assets.filter(isExportable);
  const omitted = assets.length - approved.length;

  const header = [
    `# ${campaign.name}\n`,
    [
      `- **Audience:** ${campaign.persona}`,
      ...(campaign.objective ? [`- **Objective:** ${campaign.objective}`] : []),
      `- **Approved deliverables:** ${approved.length}`,
      `- **Exported:** ${now}`,
    ].join("\n") + "\n",
    omitted > 0
      ? `> ${omitted} deliverable(s) are not approved yet and are deliberately not included.\n`
      : "",
    "---\n",
  ]
    .filter(Boolean)
    .join("\n");

  const body = approved.length
    ? approved.map((a) => buildDeliverableExport(a, { campaignName: campaign.name, now })).join("\n---\n\n")
    : `_${NOTHING_APPROVED}_\n`;

  return { content: `${header}\n${body}`, approvedCount: approved.length, omittedCount: omitted };
}
