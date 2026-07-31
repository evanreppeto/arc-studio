"use client";

import { useEffect } from "react";

import {
  buildTouch,
  mergeTouch,
  parseAttributionRecord,
  serializeAttributionRecord,
} from "@/domain/signup-attribution";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/signup-attribution/shared";

/**
 * Records which channel brought this visitor here (BSR-586).
 *
 * Mounted once in the root layout. On every page load it builds a touch from the
 * URL and referrer, merges it into the existing record (first touch is written
 * once and never overwritten), and stores the result in a first-party cookie so
 * the server can read it when a waitlist form or a signup is submitted.
 *
 * WHY A COOKIE AND NOT localStorage: the signup path is a server-side form POST.
 * A cookie arrives with that request automatically; localStorage would need
 * client JS to attach it to every submission and would silently miss any
 * no-JS or intercepted path.
 *
 * WHAT IS STORED: campaign parameters, the referrer HOST, and the landing path.
 * No email, no name, no IP, no cross-site identifier — the sanitisation happens
 * in the domain module before anything is written. This is first-party
 * measurement of a channel, not a profile of a person.
 *
 * Deliberately silent: attribution is never worth breaking a page over, so every
 * failure path here ends in "do nothing."
 */
export function AttributionCapture() {
  useEffect(() => {
    try {
      // document.cookie is a flat string; find ours without a parser dependency.
      const existingRaw = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${ATTRIBUTION_COOKIE}=`))
        ?.slice(ATTRIBUTION_COOKIE.length + 1);

      const existing = existingRaw
        ? parseAttributionRecord(decodeURIComponent(existingRaw))
        : null;

      const incoming = buildTouch({
        search: window.location.search,
        referrer: document.referrer,
        path: window.location.pathname,
        selfHost: window.location.host,
        at: new Date().toISOString(),
      });

      const merged = mergeTouch(existing, incoming);

      // Nothing changed — skip the write rather than refreshing the expiry on
      // every page view, which would quietly extend the cookie indefinitely.
      if (
        existing &&
        merged.firstTouch.at === existing.firstTouch.at &&
        merged.lastTouch.at === existing.lastTouch.at
      ) {
        return;
      }

      const value = encodeURIComponent(serializeAttributionRecord(merged));
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie =
        `${ATTRIBUTION_COOKIE}=${value}; Max-Age=${ATTRIBUTION_COOKIE_MAX_AGE_SECONDS}` +
        `; Path=/; SameSite=Lax${secure}`;
    } catch {
      // Cookies disabled, storage partitioned, or a malformed URL. Measurement
      // is optional; the page is not.
    }
  }, []);

  return null;
}
