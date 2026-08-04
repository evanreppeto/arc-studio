/** Longest a list-row name may run before it stops fitting the column. */
const SHORT_NAME_MAX = 46;

/**
 * The list-row name for an opportunity. Pure, so it can be tested apart from
 * the page.
 *
 * Titles are written as "<what> — <where>", and this used to keep only the part
 * before the dash. For weather that deletes the entire distinguishing fact: the
 * live inbox showed two rows both reading "Flood Advisory", one for
 * "Cook, IL / Will, IL" and one for "Cook, IL / DuPage, IL +1 more", with no way
 * to tell them apart without opening each (BSR-732).
 *
 * So the head is preferred only when no sibling row would render the same head;
 * otherwise the fuller title is truncated normally, which keeps as much of the
 * qualifier as the column allows. Truncation loses precision at the tail;
 * splitting lost the whole qualifier however much room there was.
 */
export function shortName(title: string, siblings: readonly string[] = []): string {
  const full = title.trim();
  const head = headOf(full);
  const ambiguous = siblings.some((other) => {
    const sibling = other.trim();
    return sibling !== full && headOf(sibling) === head;
  });
  const chosen = ambiguous ? full : head;
  return chosen.length > SHORT_NAME_MAX ? `${chosen.slice(0, SHORT_NAME_MAX - 2).trim()}…` : chosen;
}

function headOf(title: string): string {
  return title.split(/\s+[—–-]\s+/)[0].trim() || title;
}
