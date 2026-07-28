import { type SupabaseClient } from "@supabase/supabase-js";

import { type EmailBrand, type EmailSenderIdentity } from "@/domain";

/**
 * Reads the per-workspace sender identity and brand used to wrap outbound email.
 *
 * The postal address is legally required and cannot be defaulted, so it is
 * returned as-is (possibly empty) and the caller gates on it — quietly
 * substituting a placeholder would put a false address on a real email.
 */

/** Signing key for unsubscribe links. */
export function getUnsubscribeSecret(): string {
  // A dedicated secret is preferred. Falling back to the service-role key keeps
  // unsubscribe links working on deployments that predate this feature — the
  // alternative is a footer whose link 400s, which is worse than the coupling.
  // Rotating the service-role key invalidates outstanding links; set
  // EMAIL_UNSUBSCRIBE_SECRET to decouple them.
  return (
    process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

export type WorkspaceEmailIdentity = {
  identity: Partial<EmailSenderIdentity>;
  brand: EmailBrand;
};

// app_settings.value is jsonb — a plain string setting arrives as a JSON
// string, so it needs unwrapping rather than direct use.
type SettingsRow = { key: string; value: unknown };

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

const SENDER_NAME_KEY = "email_sender_name";
const POSTAL_ADDRESS_KEY = "email_postal_address";
const PERMISSION_REMINDER_KEY = "email_permission_reminder";

export async function loadWorkspaceEmailIdentity(
  orgId: string,
  client: SupabaseClient,
): Promise<WorkspaceEmailIdentity> {
  const empty: WorkspaceEmailIdentity = { identity: {}, brand: {} };
  if (!orgId) return empty;

  try {
    const { data, error } = await client
      .from("app_settings")
      .select("key,value")
      .eq("org_id", orgId)
      .in("key", [SENDER_NAME_KEY, POSTAL_ADDRESS_KEY, PERMISSION_REMINDER_KEY]);
    if (error) return empty;

    const byKey = new Map((data ?? []).map((row: SettingsRow) => [row.key, asText(row.value)]));

    // Brand supplies the logo and accent so each workspace's mail looks like
    // theirs without anyone configuring it twice. Absent brand is fine — the
    // wrapper falls back to the sender name and the default accent.
    const { data: profile } = await client
      .from("business_profiles")
      .select("logo_url,accent,display_name")
      .eq("org_id", orgId)
      .maybeSingle<{ logo_url: string | null; accent: string | null; display_name: string | null }>();

    return {
      identity: {
        // Fall back to the business name so an operator who filled in the brand
        // profile isn't blocked on retyping it here.
        senderName: byKey.get(SENDER_NAME_KEY) || profile?.display_name?.trim() || "",
        postalAddress: byKey.get(POSTAL_ADDRESS_KEY) || "",
        permissionReminder: byKey.get(PERMISSION_REMINDER_KEY) || undefined,
      },
      brand: {
        logoUrl: profile?.logo_url ?? null,
        accentHex: profile?.accent ?? null,
      },
    };
  } catch {
    return empty;
  }
}

/**
 * Whether this contact has opted out.
 *
 * `contacts.email_unsubscribed_at` has existed since 2026-07-10 but nothing read
 * it, so an unsubscribed contact would still receive mail. Failing CLOSED here
 * is deliberate: if the lookup errors we report suppressed rather than sending,
 * because emailing someone who opted out is the worse outcome.
 */
export async function isContactSuppressed(
  contactId: string | null,
  client: SupabaseClient,
): Promise<{ suppressed: boolean; reason?: string }> {
  if (!contactId) return { suppressed: false };
  try {
    const { data, error } = await client
      .from("contacts")
      .select("email_unsubscribed_at")
      .eq("id", contactId)
      .maybeSingle<{ email_unsubscribed_at: string | null }>();
    if (error) {
      return { suppressed: true, reason: "Could not verify the recipient's email consent, so the send was held." };
    }
    if (data?.email_unsubscribed_at) {
      return { suppressed: true, reason: "This contact unsubscribed from email, so nothing was sent." };
    }
    return { suppressed: false };
  } catch {
    return { suppressed: true, reason: "Could not verify the recipient's email consent, so the send was held." };
  }
}
