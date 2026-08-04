/**
 * Pure logic for the Arc chat surface. No I/O. Mentions, message validation,
 * and deterministic thread titles (this app has no LLM — titles are derived,
 * not generated).
 */

export const MENTION_TYPES = [
  "campaign",
  "lead",
  "company",
  "contact",
  "property",
  "job",
  "outcome",
  "persona",
  "vault",
] as const;

export type MentionType = (typeof MENTION_TYPES)[number];

export type ArcMention = {
  type: MentionType;
  id: string;
  label: string;
  href: string;
};

export type ArcMediaKind = "image" | "video";

/** Where a piece of creative came from (CLAUDE.md: Asset Review and Provenance). */
export type ArcMediaSource = "bsr_real" | "ai_generated" | "composite" | "stock" | "external";
/** Review/approval state of an asset or media item. */
export type ArcAssetStatus = "draft" | "revision" | "approved" | "rejected";

const MEDIA_SOURCES: readonly ArcMediaSource[] = ["bsr_real", "ai_generated", "composite", "stock", "external"];
const ASSET_STATUSES: readonly ArcAssetStatus[] = ["draft", "revision", "approved", "rejected"];

/** A piece of media Arc generated, attached to a reply via metadata.media. */
export type ArcMedia = {
  kind: ArcMediaKind;
  url: string;
  thumbnailUrl?: string;
  poster?: string; // video poster frame
  caption?: string;
  alt?: string;
  href?: string; // optional link (e.g. open in gallery / approval)
  // Provenance + review metadata — what it is, where it came from, whether it's safe.
  source?: ArcMediaSource;
  sourceId?: string; // approved-media source id when reusing real BSR media
  jobId?: string; // generation job id (AI)
  model?: string; // generation model (AI)
  format?: string; // aspect/format label: "1:1" | "4:5" | "9:16" | "16:9" | "pdf" | "mp4" | …
  status?: ArcAssetStatus;
  riskFlags?: string[]; // e.g. "embedded text", "claim risk", "privacy/redaction"
};

export class ArcMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcMessageError";
  }
}

export const MAX_ARC_MESSAGE = 4000;
const MAX_TITLE = 60;

export function deriveThreadTitle(firstMessage: string): string {
  const collapsed = firstMessage.replace(/\s+/g, " ").trim();
  if (!collapsed) return "New chat";
  if (collapsed.length <= MAX_TITLE) return collapsed;
  const slice = collapsed.slice(0, MAX_TITLE);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${head.trimEnd()}…`;
}

export function isArcMention(value: unknown): value is ArcMention {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.type === "string" &&
    (MENTION_TYPES as readonly string[]).includes(m.type) &&
    typeof m.id === "string" &&
    m.id.length > 0 &&
    typeof m.label === "string" &&
    typeof m.href === "string"
  );
}

export function parseMentions(value: unknown): ArcMention[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(isArcMention);
}

export function serializeMentions(mentions: ArcMention[]): string {
  return JSON.stringify(mentions.filter(isArcMention));
}

const STRING_FIELDS = ["thumbnailUrl", "poster", "caption", "alt", "href", "sourceId", "jobId", "model", "format"] as const;

function parseRiskFlags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const flags = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return flags.length > 0 ? flags : undefined;
}

/** Parse Arc's attached media from a reply's metadata.media (array or JSON). */
export function parseMedia(value: unknown): ArcMedia[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const out: ArcMedia[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const kind: ArcMediaKind | null = m.kind === "video" ? "video" : m.kind === "image" ? "image" : null;
    const url = typeof m.url === "string" ? m.url.trim() : "";
    if (!kind || !url) continue;

    const media: ArcMedia = { kind, url };
    for (const field of STRING_FIELDS) {
      const v = m[field];
      if (typeof v === "string" && v.trim()) media[field] = v;
    }
    if (typeof m.source === "string" && (MEDIA_SOURCES as readonly string[]).includes(m.source)) {
      media.source = m.source as ArcMediaSource;
    }
    if (typeof m.status === "string" && (ASSET_STATUSES as readonly string[]).includes(m.status)) {
      media.status = m.status as ArcAssetStatus;
    }
    const flags = parseRiskFlags(m.riskFlags);
    if (flags) media.riskFlags = flags;
    out.push(media);
  }
  return out;
}

export function validateArcMessageInput(input: { body: string; mentions: ArcMention[] }): {
  body: string;
  mentions: ArcMention[];
} {
  const body = input.body.replace(/\s+$/g, "").replace(/^\s+/g, "");
  if (!body.trim()) {
    throw new ArcMessageError("Write a message for Arc first.");
  }
  if (body.length > MAX_ARC_MESSAGE) {
    throw new ArcMessageError(`Keep it under ${MAX_ARC_MESSAGE} characters.`);
  }
  return { body, mentions: input.mentions.filter(isArcMention) };
}

export type ArcMode = "ask" | "act" | "draft";
export type ArcRoute = "fast" | "standard";

const ARC_MODES: readonly ArcMode[] = ["ask", "act", "draft"];
const ARC_ROUTES: readonly ArcRoute[] = ["fast", "standard"];

/** Parse the composer's stance; missing/legacy values stay action-capable. */
export function parseArcMode(value: unknown): ArcMode {
  return typeof value === "string" && (ARC_MODES as readonly string[]).includes(value)
    ? (value as ArcMode)
    : "act";
}

/** Parse the model routing hint; anything unrecognized stays on the cheap/fast lane. */
export function parseArcRoute(value: unknown): ArcRoute {
  return typeof value === "string" && (ARC_ROUTES as readonly string[]).includes(value)
    ? (value as ArcRoute)
    : "fast";
}

export type ArcActionFlag = { tone: "ok" | "warn" | "risk"; label: string };
export type ArcActionRow = { name: string; meta?: string; badge?: string; href?: string };
export type ArcActionApproval = { kind: "campaign"; campaignId: string; assetId: string };
/** A deep-link into a pre-filtered in-app view. href must be an in-app path (/…). */
export type ArcAppState = { href: string; filters: string[] };
export type ArcActionCard = {
  kind: "result" | "draft" | "navigate";
  title: string;
  href?: string;
  rows: ArcActionRow[];
  preview?: string;
  flags: ArcActionFlag[];
  approval?: ArcActionApproval;
  // Self-describing fields so a card stands alone in a campaign deck / asset library.
  media?: ArcMedia; // the asset's own visual
  channel?: string; // "Meta / Instagram" | "Email" | "SMS" | …
  format?: string; // aspect/format label
  status?: ArcAssetStatus;
  appState?: ArcAppState;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function parseRows(value: unknown): ArcActionRow[] {
  if (!Array.isArray(value)) return [];
  const out: ArcActionRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const name = str((item as { name?: unknown }).name);
    if (!name) continue;
    out.push({
      name,
      meta: str((item as { meta?: unknown }).meta),
      badge: str((item as { badge?: unknown }).badge),
      href: str((item as { href?: unknown }).href),
    });
  }
  return out;
}

function parseFlags(value: unknown): ArcActionFlag[] {
  if (!Array.isArray(value)) return [];
  const tones = new Set(["ok", "warn", "risk"]);
  const out: ArcActionFlag[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const tone = (item as { tone?: unknown }).tone;
    const label = str((item as { label?: unknown }).label);
    if (typeof tone !== "string" || !tones.has(tone) || !label) continue;
    out.push({ tone: tone as ArcActionFlag["tone"], label });
  }
  return out;
}

function parseApproval(value: unknown): ArcActionApproval | undefined {
  if (!value || typeof value !== "object") return undefined;
  const kind = (value as { kind?: unknown }).kind;
  const campaignId = str((value as { campaignId?: unknown }).campaignId);
  const assetId = str((value as { assetId?: unknown }).assetId);
  if (kind !== "campaign" || !campaignId || !assetId) return undefined;
  return { kind: "campaign", campaignId, assetId };
}

function parseAppState(value: unknown): ArcAppState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const href = str((value as { href?: unknown }).href);
  // In-app routes only — never an external URL.
  if (!href || !href.startsWith("/")) return undefined;
  const rawFilters = (value as { filters?: unknown }).filters;
  const filters = Array.isArray(rawFilters)
    ? rawFilters.filter((f): f is string => typeof f === "string" && f.trim().length > 0).map((f) => f.trim()).slice(0, 6)
    : [];
  return { href, filters };
}

/**
 * One asset, one card.
 *
 * Arc sometimes narrates the same draft twice in a single turn — once as it
 * saves the asset and again to restate the settled state, e.g. "Send-pipeline
 * verification email" followed by "Send-pipeline verification email — pending
 * approval", both carrying the SAME approval.assetId. Nothing deduped them, so
 * DraftPackageCard rendered `cards.length` as "2 assets ready for review ·
 * 0/2 approved" for one asset, and cleanApprovableDrafts handed the same asset
 * to bulk-approve twice.
 *
 * The later emission wins because it carries the settled status, but it keeps
 * the earlier one's POSITION so a restatement can't reorder the deck.
 *
 * Only approval-bearing cards are deduped: a result/navigate card has no stable
 * identity to key on, and guessing one would collapse genuinely distinct cards.
 */
function dedupeByAsset(cards: ArcActionCard[]): ArcActionCard[] {
  const positionByAsset = new Map<string, number>();
  const out: ArcActionCard[] = [];
  for (const card of cards) {
    const assetId = card.approval?.assetId;
    if (!assetId) {
      out.push(card);
      continue;
    }
    const seenAt = positionByAsset.get(assetId);
    if (seenAt === undefined) {
      positionByAsset.set(assetId, out.length);
      out.push(card);
    } else {
      out[seenAt] = card;
    }
  }
  return out;
}

/** Parse Arc's structured action cards from message metadata. Defensive: drops
 *  malformed entries (must have a valid kind + title), dedupes repeated cards
 *  for one asset, never throws. */
export function parseActions(value: unknown): ArcActionCard[] {
  if (!Array.isArray(value)) return [];
  const out: ArcActionCard[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    const title = str((item as { title?: unknown }).title);
    if ((kind !== "result" && kind !== "draft" && kind !== "navigate") || !title) continue;
    const appState = kind === "navigate" ? parseAppState((item as { appState?: unknown }).appState) : undefined;
    // A navigate card with no valid in-app destination is useless — drop it.
    if (kind === "navigate" && !appState) continue;
    const mediaValue = (item as { media?: unknown }).media;
    const media = mediaValue ? parseMedia([mediaValue])[0] : undefined;
    const statusRaw = (item as { status?: unknown }).status;
    const status =
      typeof statusRaw === "string" && (ASSET_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as ArcAssetStatus)
        : undefined;
    out.push({
      kind: kind as "result" | "draft" | "navigate",
      title,
      href: str((item as { href?: unknown }).href),
      rows: parseRows((item as { rows?: unknown }).rows),
      preview: str((item as { preview?: unknown }).preview),
      flags: parseFlags((item as { flags?: unknown }).flags),
      approval: parseApproval((item as { approval?: unknown }).approval),
      media,
      channel: str((item as { channel?: unknown }).channel),
      format: str((item as { format?: unknown }).format),
      status,
      ...(appState ? { appState } : {}),
    });
  }
  return dedupeByAsset(out);
}

/** The approval ids of draft cards safe to bulk-approve: a draft, with an
 *  approval block, not yet decided, and carrying no warn/risk flags. Pure. */
export function cleanApprovableDrafts(cards: ArcActionCard[]): { campaignId: string; assetId: string }[] {
  return cards
    .filter(
      (c) =>
        c.kind === "draft" &&
        c.approval &&
        c.status !== "approved" &&
        c.status !== "rejected" &&
        c.status !== "revision" &&
        !c.flags.some((f) => f.tone === "warn" || f.tone === "risk"),
    )
    .map((c) => ({ campaignId: c.approval!.campaignId, assetId: c.approval!.assetId }));
}

/** A memory line Arc recalled from the brain, surfaced as a chat evidence chip. */
export type ArcRecall = {
  label: string;
  /** The fact in Arc's own words. `label` is the brain's node KEY —
   *  `crm_contacts_empty` — which is an identifier, not something to show a
   *  human. The runner has always written this sentence alongside it and the
   *  parser used to drop it, so every recall surface rendered the key. */
  summary?: string;
  confidence?: number;
  kind?: string;
  nodeId?: string;
};

/**
 * Parse Arc's recalled-memory items from message metadata. Defensive: requires a
 * label, clamps confidence to [0,1], drops malformed entries, never throws.
 *
 * Returns everything it is given (BSR-624). It used to stop at 8, a limit sized
 * for the inline chip row — but the parser is shared, so every other surface
 * inherited a cap meant for a different one. A prod turn recalled 15 facts and
 * the workspace panel reported "8", which is a cap presented as a count.
 * Truncation is the rendering surface's decision, and a surface that truncates
 * has to say so.
 */
export function parseRecall(value: unknown): ArcRecall[] {
  if (!Array.isArray(value)) return [];
  const out: ArcRecall[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const label = str((item as { label?: unknown }).label);
    if (!label) continue;
    const rawConfidence = (item as { confidence?: unknown }).confidence;
    const confidence =
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
        ? Math.min(1, Math.max(0, rawConfidence))
        : undefined;
    out.push({
      label,
      ...(str((item as { summary?: unknown }).summary) ? { summary: str((item as { summary?: unknown }).summary) } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(str((item as { kind?: unknown }).kind) ? { kind: str((item as { kind?: unknown }).kind) } : {}),
      ...(str((item as { nodeId?: unknown }).nodeId) ? { nodeId: str((item as { nodeId?: unknown }).nodeId) } : {}),
    });
  }
  return out;
}

/**
 * A structured question Arc poses to the operator, rendered as an interactive
 * panel (option chips / checkboxes / free text) above the composer instead of a
 * plain-text question. Answering auto-sends the choice as the next message.
 * RUNNER CONTRACT: Arc writes these to `arc_messages.metadata.questions`.
 */
export type ArcQuestion = {
  id: string;
  prompt: string;
  /** Choices to offer; empty means free-text only. */
  options: string[];
  /** Allow selecting several options at once (checkboxes + confirm). */
  multi?: boolean;
  /** Offer a "type your own" free-text fallback alongside any options. */
  allowText?: boolean;
};

/** Parse Arc's structured questions from message metadata. Defensive: drops
 *  malformed entries (must have a prompt and either options or allowText), never throws. */
export function parseQuestions(value: unknown): ArcQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: ArcQuestion[] = [];
  for (const [i, item] of value.entries()) {
    if (!item || typeof item !== "object") continue;
    const prompt = str((item as { prompt?: unknown }).prompt);
    if (!prompt) continue;
    const rawOptions = (item as { options?: unknown }).options;
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => o.trim()).slice(0, 8)
      : [];
    const allowText = (item as { allowText?: unknown }).allowText === true;
    // A question must offer SOME way to answer.
    if (options.length === 0 && !allowText) continue;
    const id = str((item as { id?: unknown }).id) ?? `q${i}`;
    out.push({
      id,
      prompt,
      options,
      multi: (item as { multi?: unknown }).multi === true,
      allowText,
    });
  }
  return out.slice(0, 4);
}

/**
 * Map a stored `campaign_assets.status` onto the four states the chat renders.
 *
 * The chat's action cards carry the status Arc wrote AT DRAFT TIME — a snapshot,
 * not a reference. Decide an asset anywhere outside the chat's own review panel
 * (the campaign page, another session, another device) and the conversation kept
 * asserting the draft-time value: "Needs review" on an asset approved and sent
 * hours earlier, and a `n need review` chip counting work that no longer exists.
 *
 * Exhaustive over the DB enum on purpose. An unmapped status returning undefined
 * would fall back to the same stale snapshot the live lookup exists to replace —
 * the bug would survive its own fix for exactly the statuses nobody tested.
 */
const DB_ASSET_STATUS_TO_ARC: Readonly<Record<string, ArcAssetStatus>> = {
  draft: "draft",
  needs_compliance: "draft",
  pending_approval: "draft",
  pending_owner_approval: "draft",
  blocked: "draft",
  approved: "approved",
  declined: "rejected",
  rejected: "rejected",
  revision_requested: "revision",
  needs_revision: "revision",
  // `archived` is deliberately ABSENT — it says the work is closed, not how it
  // was decided, so it can only be resolved with approved_at. See below.
};

/**
 * The chat-facing status for a stored asset; null when unrecognised.
 *
 * `approvedAt` is required to resolve `archived`, which records that work is
 * CLOSED and says nothing about how it was decided. Mapping it straight to
 * "rejected" made the chat label a campaign's archived-but-approved email
 * "Declined" — a confident false claim about a human decision, on an asset that
 * had actually been approved and delivered. approved_at is that human's
 * signature (the same field the send path treats as authoritative), so it, not
 * the closed-state label, decides which way an archived asset reads.
 */
export function arcAssetStatusFromDb(
  status: string | null | undefined,
  approvedAt?: string | null,
): ArcAssetStatus | null {
  const key = (status ?? "").trim().toLowerCase();
  if (key === "archived") return approvedAt ? "approved" : "rejected";
  return DB_ASSET_STATUS_TO_ARC[key] ?? null;
}
