import { describe, expect, it } from "vitest";

import { config } from "./proxy";

/**
 * The matcher decides whether the auth gate runs at all, so a path missing from it
 * fails silently and in the worst direction — the gate answers with a 302 to /login
 * and the caller believes it got a real response.
 *
 * That is exactly how Sentry's tunnel broke: the browser SDK POSTed each error to
 * /monitoring, the proxy redirected it to /login, the SDK saw the login page's 200,
 * reported `flushed: true`, and no event ever reached Sentry. Every field was
 * configured correctly; delivery was dead. Only reading the network caught it.
 */

const matched = (pathname: string) => new RegExp(`^${config.matcher[0]}$`).test(pathname);

describe("proxy matcher", () => {
  it("does not gate Sentry's ingest tunnel", () => {
    // Must hold for signed-out visitors above all: /login is where a browser error
    // most needs reporting, and nobody has a session there.
    expect(matched("/monitoring")).toBe(false);
  });

  it.each(["/api/v1/arc/runs", "/_next/static/chunk.js", "/login", "/icon.png"])(
    "does not gate %s",
    (path) => {
      expect(matched(path)).toBe(false);
    },
  );

  it.each(["/home", "/campaigns", "/crm/contacts", "/settings", "/"])("still gates %s", (path) => {
    expect(matched(path)).toBe(true);
  });

  /**
   * Matcher entries are path PREFIXES, so an exemption named after a public/
   * directory also covers any page sharing that name — and an unprotected page
   * renders exactly like a protected one, which is why this needs a test rather
   * than a review. Assets bypass; pages never do.
   */
  it("gates every page route, exempting only the asset directories", () => {
    expect(matched("/brand")).toBe(true);
    expect(matched("/brand/")).toBe(true);
    expect(matched("/effects")).toBe(true);

    // …while the assets those entries exist for still bypass the gate.
    expect(matched("/brand/arc-mark.png")).toBe(false);
    expect(matched("/brand/demo/meridian-logo.png")).toBe(false);
    expect(matched("/effects/grain.png")).toBe(false);
  });

  it("has no exemption that would swallow a page route", () => {
    // Any entry without a trailing slash or a file extension is a prefix that
    // could cover a future page. The auth pages are deliberately public; the
    // rest must be scoped.
    const PUBLIC_PAGES = ["landing", "login", "sign-in", "sign-up", "forgot-password", "reset-password"];
    const INFRA = ["api", "monitoring", "auth/callback", "_next/static", "_next/image"];
    const entries = config.matcher[0].match(/\(\?!([^)]+)\)/)?.[1].split("|") ?? [];
    expect(entries.length).toBeGreaterThan(0);

    const risky = entries.filter(
      (entry) => !entry.endsWith("/") && !entry.includes(".") && !PUBLIC_PAGES.includes(entry) && !INFRA.includes(entry),
    );
    expect(risky, `unscoped matcher exemptions: ${risky.join(", ")}`).toEqual([]);
  });

  it("keeps the tunnel exemption in step with next.config's tunnelRoute", async () => {
    // Two files have to agree; if someone renames tunnelRoute and not this, error
    // reporting goes quiet again with nothing failing.
    const { readFileSync } = await import("node:fs");
    const cfg = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    const tunnel = cfg.match(/tunnelRoute:\s*["'`]\/([a-z0-9-]+)["'`]/i)?.[1];
    expect(tunnel, "next.config.ts must declare a tunnelRoute").toBeTruthy();
    expect(matched(`/${tunnel}`)).toBe(false);
  });
});
