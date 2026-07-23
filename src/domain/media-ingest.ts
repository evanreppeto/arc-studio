/**
 * Pure contracts for bringing outside media into the library — the "use your
 * own tools" on-ramp. A workspace's creative can come from anywhere (their own
 * Higgsfield, Gemini, Canva, a photographer's Drive, a script); what the app
 * guarantees is the record: every asset carries its origin, its external
 * lineage when known — and an honest "unverified" when not — and enters held
 * for review (`available_to_arc` defaults false) like every other import.
 *
 * Pure parsing/normalization only. Fetching, scanning, and persistence live in
 * `src/lib/media-library/`.
 */

/** External lineage supplied by the pushing tool. All optional — absence is
 *  recorded honestly rather than guessed. */
export type ExternalMediaProvenance = {
  /** The tool that made the asset, e.g. "higgsfield", "gemini", "canva". */
  tool?: string;
  /** Model/preset identifier when the tool is generative. */
  model?: string;
  /** The generation prompt, when the tool used one. */
  prompt?: string;
  /** The tool's own job/render id, for tracing back. */
  jobId?: string;
  /** Where the original lives in the source tool, when addressable. */
  sourceUrl?: string;
};

const PROVENANCE_LIMITS: Record<keyof ExternalMediaProvenance, number> = {
  tool: 60,
  model: 120,
  prompt: 4000,
  jobId: 200,
  sourceUrl: 2000,
};

/** Normalize caller-supplied external provenance: trim, cap lengths, drop
 *  empties and non-strings. Unknown keys are ignored. */
export function parseExternalMediaProvenance(value: unknown): ExternalMediaProvenance {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const out: ExternalMediaProvenance = {};
  for (const key of Object.keys(PROVENANCE_LIMITS) as Array<keyof ExternalMediaProvenance>) {
    const raw = record[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, PROVENANCE_LIMITS[key]);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

/**
 * Human-readable lineage rows for an asset's stored provenance, for the asset
 * detail card. First tuple element is the lineage-dot palette key the Library
 * already styles ("ai" = generative steps, "upload" = source links). The
 * generation prompt is returned separately — it's a paragraph, not a step.
 * Alternate origin keys written by the ingest paths (`fetchedFrom` from the
 * media API, `googleDriveWebUrl` from Drive import) fill the "Original" row
 * when no explicit sourceUrl was declared.
 */
export function describeExternalMediaProvenance(value: unknown): {
  rows: Array<[string, string]>;
  prompt: string | null;
} {
  const parsed = parseExternalMediaProvenance(value);
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const rows: Array<[string, string]> = [];

  if (parsed.tool) rows.push(["ai", `Made in ${parsed.tool}${parsed.model ? ` · ${parsed.model}` : ""}`]);
  else if (parsed.model) rows.push(["ai", `Model · ${parsed.model}`]);
  if (parsed.jobId) rows.push(["ai", `Source job · ${parsed.jobId}`]);

  const original =
    parsed.sourceUrl ??
    (typeof record.fetchedFrom === "string" && record.fetchedFrom
      ? record.fetchedFrom
      : typeof record.googleDriveWebUrl === "string" && record.googleDriveWebUrl
        ? record.googleDriveWebUrl
        : null);
  if (original) {
    let host = original;
    try {
      host = new URL(original).hostname;
    } catch {
      /* not a URL — show it as given */
    }
    rows.push(["upload", `Original · ${host}`]);
  }

  return { rows, prompt: parsed.prompt ?? null };
}

const TAG_STOPWORDS = new Set([
  "the", "and", "for", "with", "final", "copy", "new", "img", "image", "file",
  "untitled", "screenshot", "export", "version", "draft", "edit", "edited",
]);

/**
 * Deterministic starter tags for an ingested asset: readable filename tokens
 * plus the source tool. No inference, no network — a human (or Arc, later) can
 * refine them; these just keep imports findable instead of untagged.
 */
export function deriveMediaIngestTags(input: { fileName: string; tool?: string | null }): string[] {
  const stem = (input.fileName.split(/[\\/]/).pop() ?? "").replace(/\.[a-zA-Z0-9]+$/, "");
  const tokens = stem
    .split(/[^a-zA-Z]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !TAG_STOPWORDS.has(token));
  const tags: string[] = [];
  const push = (tag: string) => {
    if (tag && !tags.includes(tag)) tags.push(tag);
  };
  const tool = input.tool?.trim().toLowerCase();
  if (tool) push(tool.replace(/[^a-z0-9]+/g, "-"));
  for (const token of tokens) {
    if (tags.length >= 6) break;
    push(token);
  }
  return tags;
}

export type MediaIngestPayload = {
  fileName: string;
  /** Exactly one of these supplies the content. */
  sourceUrl: string | null;
  contentBase64: string | null;
  /** Optional override; otherwise resolved from the fetch response / filename. */
  contentType: string | null;
  folderId: string | null;
  tags: string[];
  /** Held for review by default — pushing a file never auto-arms Arc reuse. */
  availableToArc: boolean;
  provenance: ExternalMediaProvenance;
};

export type MediaIngestParseResult =
  | { ok: true; value: MediaIngestPayload }
  | { ok: false; errors: Array<{ code: string; message: string }> };

const MAX_FILENAME = 200;
const MAX_TAGS = 12;

/** Validate a `POST /api/v1/media` body. Pure — content fetching and type/size
 *  enforcement happen at the edge where the bytes exist. */
export function parseMediaIngestPayload(payload: unknown): MediaIngestParseResult {
  const errors: Array<{ code: string; message: string }> = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: [{ code: "invalid_payload", message: "Body must be a JSON object." }] };
  }
  const record = payload as Record<string, unknown>;

  const fileName = typeof record.fileName === "string" ? record.fileName.trim().slice(0, MAX_FILENAME) : "";
  if (!fileName) errors.push({ code: "file_name_required", message: "fileName is required." });

  const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl.trim() : "";
  const contentBase64 = typeof record.contentBase64 === "string" ? record.contentBase64.trim() : "";
  if (!sourceUrl && !contentBase64) {
    errors.push({ code: "content_required", message: "Provide sourceUrl (https) or contentBase64." });
  } else if (sourceUrl && contentBase64) {
    errors.push({ code: "content_ambiguous", message: "Provide sourceUrl or contentBase64, not both." });
  }
  if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) {
    errors.push({ code: "source_url_https", message: "sourceUrl must be an https:// URL." });
  }

  const rawTags = Array.isArray(record.tags) ? record.tags : [];
  const tags = rawTags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase().slice(0, 40))
    .filter(Boolean)
    .slice(0, MAX_TAGS);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      fileName,
      sourceUrl: sourceUrl || null,
      contentBase64: contentBase64 || null,
      contentType: typeof record.contentType === "string" && record.contentType.trim() ? record.contentType.trim() : null,
      folderId: typeof record.folderId === "string" && record.folderId.trim() ? record.folderId.trim() : null,
      tags,
      availableToArc: record.availableToArc === true,
      provenance: parseExternalMediaProvenance(record.provenance),
    },
  };
}
