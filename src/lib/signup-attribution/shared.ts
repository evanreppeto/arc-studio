/**
 * Constants shared by the browser writer and the server reader (BSR-586).
 *
 * Kept free of `next/headers` and of any DOM reference so both sides can import
 * it — the client component that writes the cookie and the server code that
 * reads it must agree on the name or attribution silently vanishes between them.
 */

/** First-party cookie holding the attribution record. */
export const ATTRIBUTION_COOKIE = "arc_attr";

/**
 * 90 days. Long enough to cover a realistic consideration window for a
 * considered B2B purchase, short enough that it is not a durable identifier.
 */
export const ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
