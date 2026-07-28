import { NextResponse } from "next/server";

import { getAuthMode } from "@/lib/auth/auth-mode";
import { authEmailRedirectOrigin } from "@/lib/auth/email-redirect";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const origin = new URL(request.url).origin;

  if (getAuthMode() !== "supabase") {
    return NextResponse.redirect(new URL("/forgot-password?error=config", origin), { status: 303 });
  }

  // Fire the reset email. We deliberately ignore whether the address exists and
  // always show the same "check your email" result, so this can't be used to
  // probe which emails have accounts.
  //
  // The RESPONSE stays uniform; the LOG does not. Swallowing the reason as well
  // as the outcome meant a rejected request — an unlisted redirect, a rate
  // limit, an SMTP failure — was indistinguishable from a delivered email, and
  // the only way to tell was to notice auth.users.recovery_sent_at had stayed
  // null. Constant-response, not constant-silence.
  if (email) {
    try {
      const supabase = await createSupabaseAuthServerClient();
      // Same pinned origin as the sign-up route: Supabase validates redirectTo
      // against its allow-list and silently swaps the project Site URL on a
      // miss, so the app must send one predictable host rather than whatever
      // host served this request.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${authEmailRedirectOrigin(origin)}/auth/callback?next=/reset-password`,
      });
      if (error) {
        console.warn(`[auth] password reset was not sent: ${error.message}`);
      }
    } catch (error) {
      console.warn(
        `[auth] password reset threw: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return NextResponse.redirect(new URL("/forgot-password?success=sent", origin), { status: 303 });
}
