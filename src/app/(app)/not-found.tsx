import Link from "next/link";

/**
 * Signed-in 404. Without this, a missing record — a deleted campaign, a stale
 * bookmark, a mistyped id — rendered Next's stock "404 | This page could not be
 * found." inside the app shell: no product styling, and no way onward except
 * the browser back button.
 *
 * Lives in the (app) group so it inherits the rail and header; the operator
 * stays oriented instead of landing somewhere that looks like a crash.
 */
export default function AppNotFound() {
  return (
    <section className="state-page">
      <p className="state-eyebrow">Not found</p>
      <h1>That page isn&apos;t here</h1>
      <p className="state-body">
        The record may have been deleted, or the link may be out of date. Nothing has gone wrong with
        your workspace.
      </p>
      <div className="state-actions">
        <Link className="btn gold" href="/home">
          Go to Home
        </Link>
        <Link className="btn ghost" href="/crm">
          Browse records
        </Link>
        <Link className="btn ghost" href="/arc">
          Ask Arc
        </Link>
      </div>
    </section>
  );
}
