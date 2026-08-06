/**
 * Pointing at part of a picture, or a moment in a video.
 *
 * Select-to-revise works on copy because a text selection IS the thing you
 * object to. Creative has no equivalent: "the logo is wrong" leaves Arc to find
 * the logo. So the reviewer draws a box, or pauses on a frame, and the note
 * carries where they meant.
 *
 * Deliberately words, not coordinates. The note is read by Arc when it takes
 * another pass, and by a human reading the review history — "the bottom-right"
 * is meaningful to both, where `x: 0.62, y: 0.71` is meaningful to neither. The
 * percentages ride along in brackets for precision, close enough to ignore.
 */

/** A drawn box, normalized to the rendered image: 0–1 on both axes. */
export type MediaRegion = { x: number; y: number; width: number; height: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Normalize and clamp a box drawn in pixels over a rendered element. */
export function normalizeRegion(box: MediaRegion): MediaRegion {
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  return {
    x,
    y,
    width: clamp01(box.width + x) - x,
    height: clamp01(box.height + y) - y,
  };
}

/**
 * A box smaller than this is a click or a twitch, not a region.
 * 1.5% of each axis — small enough to point at a logo, large enough to reject
 * the stray drag that a click on an image produces.
 */
export const MIN_REGION_SIDE = 0.015;

export function isMeaningfulRegion(box: MediaRegion): boolean {
  const region = normalizeRegion(box);
  return region.width >= MIN_REGION_SIDE && region.height >= MIN_REGION_SIDE;
}

const COLUMN = ["left", "centre", "right"] as const;
const ROW = ["top", "middle", "bottom"] as const;

function band(centre: number): 0 | 1 | 2 {
  if (centre < 1 / 3) return 0;
  if (centre < 2 / 3) return 1;
  return 2;
}

/**
 * Where the box is, in words.
 *
 * Named from its CENTRE rather than its edges: a box nudged over a third-line
 * boundary should not change its name, and the centre is what someone means
 * when they point.
 */
export function describeRegion(box: MediaRegion): string {
  const region = normalizeRegion(box);
  // A box covering most of the frame is not pointing at a part of it.
  if (region.width * region.height >= 0.6) return "most of the image";

  const col = band(region.x + region.width / 2);
  const row = band(region.y + region.height / 2);

  if (col === 1 && row === 1) return "the centre";
  if (col === 1) return `the ${ROW[row]} middle`;
  if (row === 1) return `the ${COLUMN[col]} side`;
  return `the ${ROW[row]}-${COLUMN[col]}`;
}

/** `0:07`, `1:04`, `12:03`. Seconds are what a scrubber shows. */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const pct = (n: number) => `${Math.round(clamp01(n) * 100)}%`;

/**
 * The note that reaches Arc.
 *
 * With neither a region nor a time this is exactly what the reviewer typed —
 * the existing behaviour, so a revision requested without pointing at anything
 * is unchanged.
 */
export function composeMediaNote(input: {
  region?: MediaRegion | null;
  atSeconds?: number | null;
  instruction: string;
}): string {
  const instruction = input.instruction.trim();
  const parts: string[] = [];

  if (typeof input.atSeconds === "number" && Number.isFinite(input.atSeconds)) {
    parts.push(`at ${formatTimecode(input.atSeconds)}`);
  }
  if (input.region && isMeaningfulRegion(input.region)) {
    const region = normalizeRegion(input.region);
    parts.push(
      `${describeRegion(region)} (x ${pct(region.x)}–${pct(region.x + region.width)}, y ${pct(region.y)}–${pct(
        region.y + region.height,
      )})`,
    );
  }

  if (parts.length === 0) return instruction;
  return `About ${parts.join(", ")}: ${instruction}`;
}
