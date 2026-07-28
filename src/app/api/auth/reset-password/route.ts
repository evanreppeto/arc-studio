import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAuthMode, getSupabaseAnonKey, getSupabaseAuthUrl } from "@/lib/auth/auth-mode";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

/**
 * Is `password` the one the account already has?
 *
 * Asked by trying it, because Supabase stores only the hash and exposes no
 * "verify this password" call. The probe runs on an ISOLATED client — no cookie
 * adapter, `persistSession: false` — so the session it may mint is discarded
 * rather than overwriting the recovery session the caller is holding.
 *
 * Fails OPEN on error: only a definite success proves reuse, and a probe that
 * breaks for an unrelated reason (rate limit, unconfirmed account, network)
 * must not lock someone out of resetting their password.
 */
async function isCurrentPassword(email: string, password: string): Promise<boolean> {
  const url = getSupabaseAuthUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) return false;

  try {
    const probe = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await probe.auth.signInWithPassword({ email, password });
    if (error || !data.session) return false;
    await probe.auth.signOut();
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const origin = new URL(request.url).origin;

  if (getAuthMode() !== "supabase") {
    return NextResponse.redirect(new URL("/reset-password?error=config", origin), { status: 303 });
  }
  if (password.length < 8) {
    return NextResponse.redirect(new URL("/reset-password?error=password", origin), { status: 303 });
  }

  const supabase = await createSupabaseAuthServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The recovery link (via /auth/callback) establishes a session; without it the
  // link is invalid or expired.
  if (!user) {
    return NextResponse.redirect(new URL("/reset-password?error=expired", origin), { status: 303 });
  }

  // Refuse the password the account already has. A reset that accepts the same
  // password looks like it worked and changes nothing — which is the worst
  // outcome when the reason for resetting is a suspected compromise.
  if (user.email && (await isCurrentPassword(user.email, password))) {
    return NextResponse.redirect(new URL("/reset-password?error=reuse", origin), { status: 303 });
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Supabase itself rejects an unchanged password on some configurations; map
    // it to the same specific message rather than the generic failure.
    const reuse = /different from the old password|same.*password/i.test(error.message);
    return NextResponse.redirect(
      new URL(`/reset-password?error=${reuse ? "reuse" : "1"}`, origin),
      { status: 303 },
    );
  }

  return NextResponse.redirect(new URL("/login?reset=1", origin), { status: 303 });
}
