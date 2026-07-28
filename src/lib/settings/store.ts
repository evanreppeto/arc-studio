import { cache } from "react";

import { type SupabaseClient } from "@supabase/supabase-js";

import { normalizeConsentMode, type ArcMode, type ArcRoute, type JourneyConsentMode } from "@/domain";

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/server";

// Operator-editable app settings. Persisted in the `app_settings` key/value table;
// NEVER secrets (those stay in env). Untyped SupabaseClient param — the table isn't
// in the generated database.types yet, matching the connections/vault layers.

export type AppSettings = {
  workspaceName: string;
  workspaceProfile: WorkspaceProfile;
  industry: string;
  productLabel: string;
  assistantName: string;
  assistantTone: AssistantTone;
  assistantResponseStyle: AssistantResponseStyle;
  approvalStrictness: ApprovalStrictness;
  brandShortName: string;
  brandLogoUrl: string;
  brandFaviconUrl: string;
  supportEmail: string;
  markDefaultMode: ArcMode;
  markDefaultRoute: ArcRoute;
  appearanceAccent: AppearanceAccent;
  appearanceDensity: AppearanceDensity;
  appearanceMotion: AppearanceMotion;
  imageModel: string;
  videoModel: string;
  /** How the journey collector treats consent for this workspace. Enforced server-side. */
  journeyConsentMode: JourneyConsentMode;
  /**
   * Sender identity stamped into the footer of every outbound marketing email.
   * `emailPostalAddress` is legally required (CAN-SPAM and equivalents) and has
   * no safe default, so the send path refuses while it is blank rather than
   * inventing one.
   */
  emailSenderName: string;
  emailPostalAddress: string;
  emailPermissionReminder: string;
};

export type AppearanceAccent = "gold" | "blue" | "red" | "steel" | "emerald";
export type AppearanceDensity = "comfortable" | "compact";
export type AppearanceMotion = "standard" | "reduced";
export type WorkspaceProfile = "individual" | "company" | "agency";
export type AssistantTone = "direct" | "friendly" | "formal" | "sales";
export type AssistantResponseStyle = "brief" | "balanced" | "detailed";
export type ApprovalStrictness = "light" | "standard" | "strict";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  workspaceName: "Arc",
  workspaceProfile: "company",
  industry: "",
  productLabel: "Marketing",
  assistantName: "Arc",
  assistantTone: "direct",
  assistantResponseStyle: "balanced",
  approvalStrictness: "standard",
  brandShortName: "AR",
  brandLogoUrl: "/brand/arc-mark.png",
  brandFaviconUrl: "/icon.png",
  supportEmail: "",
  markDefaultMode: "act",
  markDefaultRoute: "fast",
  appearanceAccent: "gold",
  appearanceDensity: "comfortable",
  appearanceMotion: "standard",
  imageModel: "",
  videoModel: "",
  journeyConsentMode: "implied",
  emailSenderName: "",
  emailPostalAddress: "",
  emailPermissionReminder: "",
};

export const DEFAULT_SUPPORT_EMAIL = "support@bigshouldersmp.com";

/** Trim + cap a workspace name. Empty input falls back to the default at save time. */
export function normalizeWorkspaceName(input: string): string {
  return input.trim().slice(0, 80);
}

/** Trim + cap display labels. Empty input falls back at save/merge time. */
export function normalizeDisplayLabel(input: string, fallback: string, max = 80): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return (trimmed || fallback).slice(0, max);
}

/** Short brand mark used when no uploaded logo exists. */
export function normalizeBrandShortName(input: string): string {
  const cleaned = input.trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return (cleaned || DEFAULT_APP_SETTINGS.brandShortName).slice(0, 4);
}

/**
 * Accept only safe image-ish sources for user-facing logos: app-relative paths,
 * http(s) URLs, or small data:image payloads from the upload control.
 */
export function normalizeBrandUrl(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value.slice(0, 1500);
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value.slice(0, 1500);
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value) && value.length <= 750_000) {
    return value;
  }
  return "";
}

/** Accept a valid email, or empty (support email is optional). */
export function isValidSupportEmail(input: string): boolean {
  const trimmed = input.trim();
  return trimmed === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

type SettingRow = { key: string; value: unknown };

function logAppSettingsFallback(message: string): void {
  if (
    process.env.DEBUG_APP_SETTINGS !== "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  ) {
    return;
  }
  console.warn(`app_settings lookup failed, using defaults: ${message}`);
}

function appArcMode(value: unknown): ArcMode {
  return value === "ask" || value === "act" || value === "draft" ? value : DEFAULT_APP_SETTINGS.markDefaultMode;
}

function appArcRoute(value: unknown): ArcRoute {
  return value === "fast" || value === "standard" ? value : DEFAULT_APP_SETTINGS.markDefaultRoute;
}

export function appAppearanceAccent(value: unknown): AppearanceAccent {
  return value === "gold" || value === "blue" || value === "red" || value === "steel" || value === "emerald"
    ? value
    : DEFAULT_APP_SETTINGS.appearanceAccent;
}

export function appAppearanceDensity(value: unknown): AppearanceDensity {
  return value === "comfortable" || value === "compact" ? value : DEFAULT_APP_SETTINGS.appearanceDensity;
}

export function appAppearanceMotion(value: unknown): AppearanceMotion {
  return value === "standard" || value === "reduced" ? value : DEFAULT_APP_SETTINGS.appearanceMotion;
}

export function appWorkspaceProfile(value: unknown): WorkspaceProfile {
  return value === "individual" || value === "company" || value === "agency"
    ? value
    : DEFAULT_APP_SETTINGS.workspaceProfile;
}

export function appAssistantTone(value: unknown): AssistantTone {
  return value === "direct" || value === "friendly" || value === "formal" || value === "sales"
    ? value
    : DEFAULT_APP_SETTINGS.assistantTone;
}

export function appAssistantResponseStyle(value: unknown): AssistantResponseStyle {
  return value === "brief" || value === "balanced" || value === "detailed"
    ? value
    : DEFAULT_APP_SETTINGS.assistantResponseStyle;
}

export function appApprovalStrictness(value: unknown): ApprovalStrictness {
  return value === "light" || value === "standard" || value === "strict"
    ? value
    : DEFAULT_APP_SETTINGS.approvalStrictness;
}

export const IMAGE_MODELS = [
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
] as const;
export const VIDEO_MODELS = ["veo-3.1-generate-preview", "veo-3.1-fast-generate-preview"] as const;

/** "" = Auto (inherit env/default); otherwise must be an allow-listed id. */
export function appImageModel(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" || (IMAGE_MODELS as readonly string[]).includes(v) ? v : "";
}
export function appVideoModel(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" || (VIDEO_MODELS as readonly string[]).includes(v) ? v : "";
}

export function mergeAppSettingsRows(rows: SettingRow[]): AppSettings {
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const str = (key: string, fallback: string) => (typeof map.get(key) === "string" ? (map.get(key) as string) : fallback);
  return {
    workspaceName: normalizeDisplayLabel(str("workspace_name", ""), DEFAULT_APP_SETTINGS.workspaceName),
    workspaceProfile: appWorkspaceProfile(map.get("workspace_profile")),
    industry: normalizeDisplayLabel(str("industry", ""), DEFAULT_APP_SETTINGS.industry, 60),
    productLabel: normalizeDisplayLabel(str("product_label", ""), DEFAULT_APP_SETTINGS.productLabel, 42),
    assistantName: normalizeDisplayLabel(str("assistant_name", ""), DEFAULT_APP_SETTINGS.assistantName, 32),
    assistantTone: appAssistantTone(map.get("assistant_tone")),
    assistantResponseStyle: appAssistantResponseStyle(map.get("assistant_response_style")),
    approvalStrictness: appApprovalStrictness(map.get("approval_strictness")),
    brandShortName: normalizeBrandShortName(str("brand_short_name", DEFAULT_APP_SETTINGS.brandShortName)),
    brandLogoUrl: normalizeBrandUrl(str("brand_logo_url", DEFAULT_APP_SETTINGS.brandLogoUrl)),
    brandFaviconUrl: normalizeBrandUrl(str("brand_favicon_url", DEFAULT_APP_SETTINGS.brandFaviconUrl)) || DEFAULT_APP_SETTINGS.brandFaviconUrl,
    supportEmail: str("support_email", DEFAULT_APP_SETTINGS.supportEmail),
    markDefaultMode: appArcMode(map.get("arc_default_mode")),
    markDefaultRoute: appArcRoute(map.get("arc_default_route")),
    appearanceAccent: appAppearanceAccent(map.get("appearance_accent")),
    appearanceDensity: appAppearanceDensity(map.get("appearance_density")),
    appearanceMotion: appAppearanceMotion(map.get("appearance_motion")),
    imageModel: appImageModel(map.get("image_model")),
    videoModel: appVideoModel(map.get("video_model")),
    journeyConsentMode: normalizeConsentMode(map.get("journey_consent_mode")),
    emailSenderName: str("email_sender_name", "").trim(),
    // Multi-line on purpose — a postal address renders as written.
    emailPostalAddress: str("email_postal_address", "").trim(),
    emailPermissionReminder: str("email_permission_reminder", "").trim(),
  };
}

export function getSupportContactEmail(
  settings: Pick<AppSettings, "supportEmail">,
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    settings.supportEmail.trim() ||
    env.OPERATOR_SUPPORT_EMAIL?.trim() ||
    env.OPERATOR_EMAIL?.trim() ||
    DEFAULT_SUPPORT_EMAIL
  );
}

/**
 * Read one workspace's app settings, merged over defaults. Settings are
 * org-scoped (PK is (org_id, key)); the service-role admin client bypasses RLS,
 * so the org filter is applied explicitly here — mirroring the vault and other
 * read-models. Degrades gracefully to defaults when there's no tenant in
 * context, Supabase isn't configured, or the table hasn't been migrated yet —
 * never throws.
 */
async function readAppSettings(orgId: string | null, client?: SupabaseClient): Promise<AppSettings> {
  if (!orgId) return { ...DEFAULT_APP_SETTINGS };
  const supabase: SupabaseClient | null = client ?? (isSupabaseAdminConfigured() ? getSupabaseAdminClient() : null);
  if (!supabase) return { ...DEFAULT_APP_SETTINGS };

  try {
    const { data, error } = await supabase.from("app_settings").select("key,value").eq("org_id", orgId);
    if (error) {
      logAppSettingsFallback(error.message);
      return { ...DEFAULT_APP_SETTINGS };
    }
    return mergeAppSettingsRows((data ?? []) as SettingRow[]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    logAppSettingsFallback(message);
    return { ...DEFAULT_APP_SETTINGS };
  }
}

// Request-scoped dedup, keyed by org: the root layout, pages, and the Settings
// page's ~7 panels all read the same workspace's settings, so React cache()
// collapses them to ONE app_settings SELECT per (request, org). The
// client-injectable path stays uncached so tests and server actions that pass an
// explicit client are unaffected.
const getAppSettingsForOrg = cache((orgId: string): Promise<AppSettings> => readAppSettings(orgId));

/**
 * Read a workspace's app settings, merged over defaults. Pass the current
 * `orgId` (resolve via getCurrentOrgId in operator contexts, or the Arc token's
 * scope in bearer contexts). No org → app defaults. Never throws.
 */
export function getAppSettings(orgId?: string | null, client?: SupabaseClient): Promise<AppSettings> {
  if (client) return readAppSettings(orgId ?? null, client);
  if (!orgId) return Promise.resolve({ ...DEFAULT_APP_SETTINGS });
  return getAppSettingsForOrg(orgId);
}

/** Upsert one or more settings keys for a workspace. Values are stored as jsonb. */
export async function saveAppSettings(
  client: SupabaseClient,
  orgId: string,
  entries: Record<string, unknown>,
): Promise<void> {
  const rows = Object.entries(entries).map(([key, value]) => ({ key, value, org_id: orgId }));
  const { error } = await client.from("app_settings").upsert(rows, { onConflict: "org_id,key" });
  if (error) throw new Error(`app_settings upsert: ${error.message}`);
}
