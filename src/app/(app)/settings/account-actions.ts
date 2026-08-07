"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { getAuthMode } from "@/lib/auth/auth-mode";
import { authEmailRedirectOrigin } from "@/lib/auth/email-redirect";
import { requireOperator } from "@/lib/auth/operator";
import { createSupabaseAuthServerClient, getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Personal-account actions for Settings → Account.
 *
 * The section had exactly three things in it — an email it could not change, an
 * avatar, and Sign out — under a heading promising "your profile and active
 * sign-in session". Meanwhile `profiles.full_name` was written once at sign-up
 * and then read forever: it names you in the sidebar, in the greeting, and as
 * the inviter on every invitation email this workspace sends. There was no way
 * to correct it. Same for a password: the reset routes existed, but only for
 * someone locked out at the sign-in screen, never for someone signed in.
 *
 * Nothing here touches another user. Every write is scoped to the caller's own
 * auth id, and the password path only ever asks Supabase to email the address
 * already on the session — this action never handles a password itself.
 */
export type AccountWriteResult = { ok: true; persisted: boolean; message?: string } | { ok: false; error: string };

/** Your own display name. Shown app-wide and on invitations you send. */
export async function saveDisplayNameAction(input: { fullName: string }): Promise<AccountWriteResult> {
  await requireOperator();

  const fullName = (input.fullName ?? "").trim();
  if (!fullName) return { ok: false, error: "Enter a name, or leave the current one." };
  if (fullName.length > 80) return { ok: false, error: "Names are limited to 80 characters." };

  if (!isSupabaseAdminConfigured()) return { ok: true, persisted: false };

  const user = await getSupabaseAuthenticatedUser().catch(() => null);
  if (!user?.id) return { ok: false, error: "Sign in again to change your name." };

  try {
    const admin = getSupabaseAdminClient();
    // Both stores, because both are read. `resolveViewerName` prefers the auth
    // metadata and falls back to the profile row, so writing only one of them
    // leaves the app showing whichever copy it happens to reach first.
    const { error: profileError } = await admin
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", user.id);
    if (profileError) throw profileError;

    const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...(user.user_metadata ?? {}), full_name: fullName },
    });
    if (metaError) throw metaError;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save your name." };
  }

  // The shell renders this, and it is server-rendered.
  revalidatePath("/", "layout");
  revalidatePath("/settings");
  return { ok: true, persisted: true, message: "Name updated." };
}

/**
 * Emails a password-reset link to the address on the current session.
 *
 * Deliberately not an in-app "type your old password, type a new one" form:
 * this file must never receive a password. Supabase sends the link and owns the
 * exchange, exactly as the locked-out flow does.
 */
export async function sendPasswordResetAction(): Promise<AccountWriteResult> {
  await requireOperator();

  if (getAuthMode() !== "supabase") {
    return { ok: false, error: "Password changes aren't available on this deployment." };
  }

  const user = await getSupabaseAuthenticatedUser().catch(() => null);
  const email = user?.email?.trim();
  if (!email) return { ok: false, error: "No email on this session, so there's nowhere to send the link." };

  try {
    const supabase = await createSupabaseAuthServerClient();
    // Same pinning rule as the sign-up / forgot-password routes: Supabase
    // validates redirectTo against its allow-list and silently swaps in the
    // project Site URL on a miss, so send one predictable host. A server action
    // has no request URL, so the current host is the fallback.
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? "https";
    const origin = authEmailRedirectOrigin(host ? `${proto}://${host}` : "");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    // Unlike the signed-out route, there is no address to probe here — it is the
    // one already on the session — so a failure is reported rather than hidden
    // behind a uniform "check your email".
    if (error) return { ok: false, error: error.message };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not send the reset link." };
  }

  return { ok: true, persisted: true, message: `Reset link sent to ${email}.` };
}
