"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Signed-in error boundary. There was none, so an uncaught render error fell
 * through to Next's stock error page — which in development shows a stack trace
 * and in production shows a bare "Application error" with no next step.
 *
 * The message never includes `error.message`: it can carry a database string or
 * an internal identifier, and the operator can act on neither. The digest is
 * shown because it is the one thing that makes a support conversation useful.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Route it to whatever is listening (Sentry is wired at the app level).
    console.error("[app] render error:", error);
  }, [error]);

  return (
    <section className="state-page">
      <p className="state-eyebrow">Something broke</p>
      <h1>This screen didn&apos;t load</h1>
      <p className="state-body">
        The rest of your workspace is unaffected, and nothing was sent or changed. Try again — if it
        keeps happening, the reference below tells support exactly which failure this was.
      </p>
      <div className="state-actions">
        <button type="button" className="btn gold" onClick={reset}>
          Try again
        </button>
        <Link className="btn ghost" href="/home">
          Go to Home
        </Link>
        <Link className="btn ghost" href="/support">
          Contact support
        </Link>
      </div>
      {error.digest ? <p className="state-ref">Reference: {error.digest}</p> : null}
    </section>
  );
}
