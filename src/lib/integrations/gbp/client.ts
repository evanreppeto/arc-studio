/**
 * The single door to Google Business Profile. Every GBP call in the app goes
 * through `gbpGet`, and `gbpGet` can only ever issue a GET.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The OAuth scope behind these credentials is `business.manage`, which is a
 * WRITE scope. Nearly every field readable on a location — categories, hours,
 * service area, description, website, phone, address, service items — is also
 * PATCHable with the same token. A GBP listing is a customer's public
 * storefront, so writing to it is an outbound, world-visible action, and no
 * outbound action may happen without explicit human approval.
 *
 * Before this module the read-only property was a convention: the call sites
 * simply happened to pass `method: "GET"`. Nothing stopped the next one from
 * not doing so, and the failure would be invisible in review — a `method` key
 * in an options object. Here the method is not a parameter at all. There is no
 * argument a caller can pass to make this write.
 *
 * Anything Arc finds that ought to change on a profile is an approval-gated
 * recommendation for the operator to apply, never a call from here.
 */

export const GBP_TIMEOUT_MS = 8000;

export type GbpGetResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number | null; error: string };

export type GbpGetOptions = {
  /** Injected in tests so no live network is hit. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Issue a read against the Business Profile APIs.
 *
 * Returns a structured result rather than throwing, so each caller decides its
 * own posture: a detection scan degrades to empty (a provider hiccup must not
 * sink the run), while an operator-facing "Test connection" probe reports the
 * status so the card can say *token rejected* rather than *no data*.
 */
export async function gbpGet(url: string, accessToken: string, opts: GbpGetOptions = {}): Promise<GbpGetResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? GBP_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      // Hard-coded, and deliberately not reachable from the signature above.
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, error: `Google returned ${res.status}` };
    return { ok: true, status: res.status, json: (await res.json()) as unknown };
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error ? error.message : "Google unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate the stored location config into the name the modern APIs expect.
 *
 * `config.gbpLocation` holds `accounts/{accountId}/locations/{locationId}`,
 * because the **v4** reviews endpoint is keyed on the account-scoped form. Both
 * the Business Information and Performance v1 APIs key on the bare
 * `locations/{locationId}` instead.
 *
 * Passing the stored string straight through returns 404 — and the reviews
 * connector's existing handler renders that as "location not found — check the
 * location resource name", which blames the operator for a format mismatch they
 * did not cause. Hence one shared translation with a test on the real string.
 */
export function toBusinessInformationName(configLocation: string | null | undefined): string | null {
  const raw = (configLocation ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!raw) return null;
  // Already bare: locations/{id}
  const bare = /^locations\/([^/]+)$/.exec(raw);
  if (bare) return `locations/${bare[1]}`;
  // Account-scoped: accounts/{a}/locations/{id}
  const scoped = /^accounts\/[^/]+\/locations\/([^/]+)$/.exec(raw);
  if (scoped) return `locations/${scoped[1]}`;
  return null;
}
