import { NextResponse } from "next/server";

import {
  isSupabaseAdminConfigured,
  persistWaitlistSignup,
} from "@/lib/waitlist/persistence";
import { notifyWaitlistSignup } from "@/lib/waitlist/notify";
import { readAttributionRecord } from "@/lib/signup-attribution/server";
import { normalizeWaitlistEmail } from "@/lib/waitlist/validate";

/**
 * Public waitlist signup for the landing page (pre-pricing).
 *
 *   POST /api/waitlist  { "email": "you@company.com", "source"?: "landing" }
 *
 * Status codes follow the ingest conventions: 400 invalid, 201 created,
 * 200 already on the list (idempotent), 202 accepted but Supabase not
 * configured (local dev), 502 persistence error.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const payload = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const parsed = normalizeWaitlistEmail(payload.email);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const source =
    typeof payload.source === "string" && payload.source.trim().length > 0
      ? payload.source.trim().slice(0, 64)
      : "landing";

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ status: "not_configured" }, { status: 202 });
  }

  // Which channel produced this signup (BSR-586). Read from the first-party
  // cookie the AttributionCapture component wrote; null when absent or edited
  // into nonsense, which persists as "unattributed" rather than failing.
  const attribution = await readAttributionRecord();

  const result = await persistWaitlistSignup(parsed.email, source, attribution);
  if (!result.ok) {
    return NextResponse.json({ error: "Couldn't save your signup. Try again." }, { status: 502 });
  }

  // Tell the operators — only for genuinely new signups, so re-submitting the
  // form doesn't spam them. Awaited (serverless can freeze after the response)
  // but never allowed to affect the outcome: the row is already saved, so a
  // mail failure must not turn a successful signup into an error.
  if (result.status === "created") {
    await notifyWaitlistSignup({ email: parsed.email, source }).catch(() => undefined);
  }

  return NextResponse.json({ status: result.status }, { status: result.status === "created" ? 201 : 200 });
}
