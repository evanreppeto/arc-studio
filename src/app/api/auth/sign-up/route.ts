import { NextResponse } from "next/server";

import { getAuthMode } from "@/lib/auth/auth-mode";
import { getSafeOperatorReturnPath } from "@/lib/auth/operator-shared";
import { authedRedirectLocation } from "@/lib/auth/post-auth-redirect";
import { authEmailRedirectOrigin } from "@/lib/auth/email-redirect";
import {
  clearPendingConfirmationEmail,
  setPendingConfirmationEmail,
} from "@/lib/auth/pending-confirmation";
import { buildSignUpIntent } from "@/lib/auth/sign-up-intent";
import { provisionAuthenticatedUser } from "@/lib/auth/user-provisioning";
import { createSupabaseAuthServerClient } from "@/lib/supabase/auth-server";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const from = getSafeOperatorReturnPath(String(form.get("from") ?? "/"));
  const signUpIntent = buildSignUpIntent({
    firstName: String(form.get("firstName") ?? ""),
    fullName: String(form.get("fullName") ?? ""),
    industry: String(form.get("industry") ?? "general"),
    inviteCode: String(form.get("inviteCode") ?? ""),
    lastName: String(form.get("lastName") ?? ""),
    organizationName: String(form.get("organizationName") ?? ""),
    workspaceIntent: String(form.get("workspaceIntent") ?? "create"),
    workspaceType: String(form.get("workspaceType") ?? "company"),
  });
  const origin = new URL(request.url).origin;

  if (getAuthMode() !== "supabase") {
    return NextResponse.redirect(
      new URL(`/sign-up?error=config&from=${encodeURIComponent(from)}`, origin),
      { status: 303 },
    );
  }

  if (password.length < 8) {
    return NextResponse.redirect(
      new URL(`/sign-up?error=password&from=${encodeURIComponent(from)}`, origin),
      { status: 303 },
    );
  }

  if (!signUpIntent.ok) {
    return NextResponse.redirect(
      new URL(`/sign-up?error=${signUpIntent.error}&from=${encodeURIComponent(from)}`, origin),
      { status: 303 },
    );
  }

  const supabase = await createSupabaseAuthServerClient();
  const emailRedirectTo = new URL("/auth/callback", authEmailRedirectOrigin(origin));
  emailRedirectTo.searchParams.set("next", from);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: signUpIntent.metadata,
      emailRedirectTo: emailRedirectTo.toString(),
    },
  });

  if (error) {
    const normalizedMessage = error.message.toLowerCase();
    const errorCode =
      normalizedMessage.includes("already") || normalizedMessage.includes("registered")
        ? "exists"
        : "1";

    return NextResponse.redirect(
      new URL(`/sign-up?error=${errorCode}&from=${encodeURIComponent(from)}`, origin),
      { status: 303 },
    );
  }

  if (data.user && data.session) {
    const provisioned = await provisionAuthenticatedUser(data.user);
    if (!provisioned.ok) {
      return NextResponse.redirect(
        new URL(`/sign-up?error=provision&from=${encodeURIComponent(from)}`, origin),
        { status: 303 },
      );
    }
    // Session established (email confirmation off) → route straight into the app:
    // invited_member → /welcome, created_owner → `from`, profile_only → /onboarding.
    // Clear any pending-confirmation cookie left over from an earlier attempt so
    // a later visit to /sign-up doesn't resurrect the "check your inbox" screen.
    return clearPendingConfirmationEmail(
      NextResponse.redirect(authedRedirectLocation(provisioned, from, origin), { status: 303 }),
    );
  }

  // No session → email confirmation required; the confirmation link finishes
  // provisioning through /auth/confirm. Remember the address so the sign-up page
  // can render the "check your inbox" screen against it and offer a resend.
  return setPendingConfirmationEmail(
    NextResponse.redirect(
      new URL(`/sign-up?success=check_email&from=${encodeURIComponent(from)}`, origin),
      { status: 303 },
    ),
    email,
  );
}
