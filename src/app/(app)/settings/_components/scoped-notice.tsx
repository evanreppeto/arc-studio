"use client";

/**
 * "Showing People · Show all" — the banner for an editor a deep link narrowed.
 *
 * Both Records editors list every CRM object at once, which is the right shape
 * for the screen and the wrong landing for "manage the fields on *this* record":
 * you arrive at the top of a six-object list still looking for the one you came
 * from. A link that names an object narrows the editor to it instead.
 *
 * Narrowing has to be stated. A silently short list is indistinguishable from a
 * workspace that only has one record type, which is exactly the kind of quiet
 * partial view that gets mistaken for the whole truth.
 */
export function ScopedNotice({ label, onShowAll }: { label: string; onShowAll: () => void }) {
  return (
    <div className="scoped" role="status">
      <span>
        Showing <b>{label}</b>
      </span>
      <span aria-hidden>·</span>
      <button type="button" onClick={onShowAll}>
        Show all record types
      </button>
    </div>
  );
}
