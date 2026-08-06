/**
 * The Library's per-operator view preferences.
 *
 * How the shelf is arranged is a personal setting, not workspace data: which
 * view, how big the tiles are, how wide the folder rail is, which folders are
 * open. It lives in `localStorage` rather than the database for exactly that
 * reason — nothing here changes what anyone else sees, and a round trip to
 * persist a column width would be absurd.
 *
 * Read through `useSyncExternalStore`, not a `useState` + `useEffect` hydrate.
 * `localStorage` does not exist during the server render, so a lazy initializer
 * would either throw there or disagree with the client on the first paint;
 * `getServerSnapshot` answers that case honestly with the defaults and React
 * re-renders once with the real values. (Setting state from an effect is also a
 * lint error in this repo — see overlay-portal.tsx.)
 */

export type TileSize = "s" | "m" | "l";
export type SortBy = "recent" | "name" | "used";

export type LibraryPrefs = {
  viewMode: "grid" | "list";
  tile: TileSize;
  railWidth: number;
  sortBy: SortBy;
  /** Folder id → open. Keyed by folder id, so it survives renames. */
  expanded: Record<string, boolean>;
};

/** Min: the narrowest the rail can be and still show a two-word folder name.
 *  Max: past this the gallery stops being the subject of the screen. */
export const RAIL_MIN = 208;
export const RAIL_MAX = 460;

/** Grid tile widths. The thumbnail height scales with them in CSS. */
export const TILE_SIZES: Record<TileSize, { min: number; thumb: number; label: string }> = {
  s: { min: 132, thumb: 104, label: "Small" },
  m: { min: 172, thumb: 134, label: "Medium" },
  l: { min: 236, thumb: 182, label: "Large" },
};

const KEY = "arc.library.prefs";

const DEFAULTS: LibraryPrefs = {
  viewMode: "grid",
  tile: "m",
  railWidth: 276,
  sortBy: "recent",
  // The demo tree's two parent folders, so the backend-less preview opens with
  // its nesting visible rather than looking like a flat list.
  expanded: { brand: true, real: true },
};

function clampRail(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(value)))
    : DEFAULTS.railWidth;
}

function parse(raw: string | null): LibraryPrefs {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<LibraryPrefs>;
    return {
      viewMode: value.viewMode === "list" ? "list" : "grid",
      tile: value.tile === "s" || value.tile === "l" ? value.tile : "m",
      railWidth: clampRail(value.railWidth),
      sortBy: value.sortBy === "name" || value.sortBy === "used" ? value.sortBy : "recent",
      expanded: value.expanded && typeof value.expanded === "object" ? value.expanded : DEFAULTS.expanded,
    };
  } catch {
    // A corrupt or hand-edited value is not worth surfacing: fall back to the
    // defaults, which the next write replaces.
    return DEFAULTS;
  }
}

const listeners = new Set<() => void>();
/** The last raw string seen, and the object parsed from it. `getSnapshot` must
 *  return a stable identity while nothing has changed, or React re-renders in a
 *  loop — re-parsing on every call would hand back a new object each time. */
let lastRaw: string | null = null;
let snapshot: LibraryPrefs = DEFAULTS;
let primed = false;

export function subscribeLibraryPrefs(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getLibraryPrefs(): LibraryPrefs {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // Private mode / storage disabled — defaults, and no further attempts fail
    // loudly on the way past.
    return snapshot;
  }
  if (!primed || raw !== lastRaw) {
    lastRaw = raw;
    snapshot = parse(raw);
    primed = true;
  }
  return snapshot;
}

export function getServerLibraryPrefs(): LibraryPrefs {
  return DEFAULTS;
}

export function setLibraryPrefs(patch: Partial<LibraryPrefs>): void {
  const next = { ...getLibraryPrefs(), ...patch, railWidth: clampRail(patch.railWidth ?? getLibraryPrefs().railWidth) };
  snapshot = next;
  primed = true;
  try {
    lastRaw = JSON.stringify(next);
    window.localStorage.setItem(KEY, lastRaw);
  } catch {
    // Unwritable storage still gets the in-memory update, so the session
    // behaves; it just won't be there next time.
  }
  for (const listener of listeners) listener();
}
