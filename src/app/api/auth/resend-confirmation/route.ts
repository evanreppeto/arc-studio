import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getAuthMode } from "@/lib/auth/auth-mode";
import { authEmailRedirectOrigin } from "@/lib/auth/email-redirect";
import { getSafeOperatorReturnPath } from "@/lib/auth/operator-shared";
import {
  PENDING_CONFIRMATION_COOKIE,
  clearPendingConfirmationEmail,
  readPendingConfirmationEmail,
} from "@/lib/auth/pending-confirmation";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

/**
 * Re-send the sign-up confirmation email for the address the browser is already
 * waiting on. The address comes from the httpOnly pending-confirmation cookie,
 * never from the request body — so this can't be pointed at an arbitrary
 * recipient and used as a mail cannon.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const from = getSafeOperatorReturnPath(String(form.get("from") ?? "/"));
  const origin = new URL(request.url).origin;

  const backTo = (status: string) =>
    new URL(
      `/sign-up?success=check_email&resend=${status}&from=${encodeURIComponent(from)}`,
      origin,
    );

  const store = await cookies();
  const email = readPendingConfirmationEmail(store.get(PENDING_CONFIRMATION_COOKIE)?.value);

  if (!email) {
    // Cookie expired or was cleared — there's nothing to resend, so send them
    // back to a clean form rather than a stale confirmation screen.
    return clearPendingConfirmationEmail(
      NextResponse.redirect(
        new URL(`/sign-up?error=resend_expired&from=${encodeURIComponent(from)}`, origin),
        { status: 303 },
      ),
    );
  }

  if (getAuthMode() !== "supabase") {
    return NextResponse.redirect(backTo("error"), { status: 303 });
  }

  const supabase = await createSupabaseAuthServerClient();
  const emailRedirectTo = new URL("/auth/callback", authEmailRedirectOrigin(origin));
  emailRedirectTo.searchParams.set("next", from);

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: emailRedirectTo.toString() },
  });

  if (error) {
    // Supabase rate-limits resends per address; say so specifically instead of
    // letting the operator hammer a button that looks broken.
    const rateLimited = error.status === 429 || (error.code ?? "").includes("rate_limit");
    return NextResponse.redirect(backTo(rateLimited ? "rate_limited" : "error"), { status: 303 });
  }

  return NextResponse.redirect(backTo("sent"), { status: 303 });
}
