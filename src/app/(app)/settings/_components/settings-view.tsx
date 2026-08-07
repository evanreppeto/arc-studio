"use client";

import { useRouter } from "next/navigation";
import { KpiStrip } from "../../_components/kpi-strip";
import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";

import type { SettingsTeamInvite, SettingsTeamMember, SettingsTeamView, WorkspaceActivityEntry } from "@/lib/auth/team-view";
import type { WaitlistView } from "@/lib/waitlist/read-model";
import type { HealthConsoleView } from "@/lib/observability/health-console";
import type { SuppressionView } from "@/lib/email-suppression/read-model";
import type { CustomFieldDefinition, CustomFieldObjectKey, ObjectLabelOverride, PipelineObjectKey, PipelineStage } from "@/domain";

import { CATS, CONNECTORS, DCAT } from "./connector-catalog";
import { CustomFieldsPanel } from "./custom-fields-panel";
import { ObjectLabelsPanel } from "./object-labels-panel";
import { PipelineStagesPanel } from "./pipeline-stages-panel";
import type { LoopState } from "@/lib/observability/health-grading";
import { ASSIGNABLE_WORKSPACE_ROLES, WORKSPACE_ROLES, roleLabel } from "@/lib/auth/workspace-roles";
import type { SettingsWorkspace, SettingsWorkspacesView } from "@/lib/auth/workspaces-view";
import type { SettingsUsageView } from "@/lib/ai-usage/settings-summary";
import type { ConnectorSpendView } from "@/lib/connectors/spend-summary";

import {
  connectorMatchesIndustry,
  derivedShortLabel,
  describeConnectorCost,
  findConnector,
  formatFeedsInput,
  formatServicePointsInput,
  parseFeedsInput,
  parseNewsQueriesInput,
  parseServicePointsInput,
  parseWeatherCategories,
  DEMO_DATA_LABEL,
  parseWeatherServiceArea,
  WEATHER_CATEGORIES,
  WORKSPACE_ACCENT_SWATCHES,
  workspaceInitials,
  type ConnectorCostTier,
  type ConnectorStatus,
  type WeatherCategory,
  type WorkspaceAccentKey,
} from "@/domain";
import type { ConnectorView } from "@/lib/connectors/read-model";
import type { SettingsConnectorsView } from "@/lib/connectors/settings-connectors";
import type { EffectiveAgentConnection } from "@/lib/agent/connection";
import type { SettingsBillingView } from "@/lib/billing/settings-billing";
import { INDUSTRY_OPTIONS } from "@/lib/personas/industry-templates";
import type { PersonaOption } from "@/lib/personas/read-model";
import { canonicalIndustryKey, type CrmObjectLanguage, type ProductLanguageObjectKey } from "@/lib/product-language";
import { IMAGE_MODELS, VIDEO_MODELS, type AppSettings } from "@/lib/settings/store";

import { createBillingPortalAction, createCheckoutSessionAction, updateOrgPlanAction } from "../billing-actions";

import { AppImage } from "../../_components/app-image";

import { saveDisplayNameAction, sendPasswordResetAction } from "../account-actions";
import {
  cancelInvite,
  changeMemberRole,
  createInvite,
  createWorkspace,
  removeMember,
  saveAppearanceSettings,
  saveEmailIdentitySettings,
  suppressEmailAddress,
  saveGeneralSettings,
  saveMediaDefaults,
  saveRunnerDisplayName,
  switchWorkspace,
  updateWorkspaceIdentityAction,
} from "../actions";
import {
  removeUserAvatarAction,
  removeWorkspaceLogoAction,
  saveUserAvatarAction,
  saveWorkspaceLogoAction,
} from "../branding-actions";
import { connectConnector, disconnectConnector, runConnectorImport, runCsvImportAction, saveConnectorConfig, sendSlackDigestAction, testConnector, toggleConnectorEnabled } from "../connectors-actions";
import { removeResendKey, saveResendKey, setEmailConnectionEnabled, testEmailConnection } from "../connections-actions";
import type { ConnectionView } from "@/lib/connections/read-model";
import { setConnectorSpendCap } from "../spend-actions";
import { Modal } from "../../_components/modal";
import { BrandBadge } from "./brand-badge";
import { ImageUploadField } from "./image-upload-field";
import { NewWorkspaceModal, type NewWorkspaceValue } from "./new-workspace-modal";
import { WorkspaceIdentityModal, type WorkspaceIdentityValue } from "./workspace-identity-modal";
import { sendTestOpsAlert } from "../alert-actions";

import { toStatus, type SaveStatus, type SettingsWriteResult } from "./save-status";

/**
 * Roles an owner/admin may actually assign, straight from the catalog the server
 * guard uses. This was a hand-written array that led with "Owner" — a role
 * `changeWorkspaceMemberRole` rejects unconditionally (`ASSIGNABLE_WORKSPACE_ROLES`
 * excludes it by design, and the Roles tab says so: "Granted at onboarding").
 * Picking it was a guaranteed error. The invite popup carried a third, separately
 * hardcoded copy of the same list. One source now.
 */
const ROLE_OPTIONS = ASSIGNABLE_WORKSPACE_ROLES.map((role) => roleLabel(role));

const ICON: Record<string, string> = {
  health: '<path d="M3 12h4l2-5 3 10 2-5h7"/>',
  waitlist: '<path d="M4 7h10M4 12h10M4 17h6"/><path d="M15 17l2 2 4-4"/>',
  general: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 00-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.3 2.5h4l.3-2.5a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5a7 7 0 00.1-1z"/>',
  appearance: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 000 18 4 4 0 000-8 3 3 0 010-6 4 4 0 000-4z"/>',
  team: '<circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="9" r="2.5"/><path d="M3 19c0-3 2-4.5 5-4.5M21 19c0-3-2-4.5-5-4.5M9 19c0-2 1.5-3 3-3s3 1 3 3"/>',
  workspaces: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/>',
  connections: '<path d="M8 12l-3 3a3 3 0 004 4l3-3M16 12l3-3a3 3 0 00-4-4l-3 3M9 15l6-6"/>',
  // Two form inputs of unequal width — "the shape of a record". Deliberately not
  // the four-square grid (overview/workspaces) or the CRM toolbar's column glyph.
  records: '<rect x="3" y="5" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="12" height="5" rx="1.5"/>',
  agent: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V5M9 13h.01M15 13h.01M9 16h6"/>',
  media: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  account: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>',
  usage: '<path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6"/>',
  system: '<path d="M12 3v3M12 18v3M5 12H2M22 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};
const CHECK = '<path d="M5 12l4 4L19 6"/>';
const Ic = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: d }} />;

const NAVGROUPS = [
  // "Records" holds both halves of the CRM schema — the fields on a record and
  // the stages it moves through — as sub-tabs. They were two rail rows under
  // their own RECORDS heading, which spent a group header and two rows on one
  // idea and read as two unrelated screens.
  { g: "WORKSPACE", items: [["overview", "Overview"], ["general", "Organization & brand"], ["appearance", "Appearance"], ["team", "Team"], ["workspaces", "Workspaces"], ["records", "Records"]] },
  { g: "ARC", items: [["connections", "Connections"]] },
  { g: "ACCOUNT", items: [["account", "Account"], ["usage", "Usage & billing"]] },
  // Labelled "Media models" in the rail while its own heading said "Image &
  // video quality" and its breadcrumb said a third thing. One name.
  { g: "ADVANCED", items: [["media", "Image & video"]] },
] as const;
/**
 * Rail status dot colours by state. There used to be a constant map painting
 * Connections and System status green permanently — a green dot beside
 * "Connections" while zero connectors were active, and beside "System status"
 * while every row under it read "Not connected". A dot that is always green
 * reports nothing and quietly certifies everything. `dotFor` below derives it.
 */
const DOT_COLOR: Record<"ok" | "warn" | "err", string> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--priority)" };

// Sections with in-section tabs. The breadcrumb + tab bar render from these.
const SUBTABS: Record<string, string[]> = {
  general: ["Organization", "Agent", "Email"],
  team: ["Members", "Invites", "Roles", "Activity"],
  connections: ["Live", "Roadmap"],
  records: ["Fields", "Stages", "Names"],
  usage: ["Overview", "Connectors", "By day", "By model", "Recent"],
};

/**
 * Sections that used to have their own rail row, mapped to where they live now.
 * A `?s=fields` link someone saved (or a CRM link written before the merge) has
 * to keep landing on the fields editor rather than silently falling back to the
 * overview.
 */
const LEGACY_SECTIONS: Record<string, { section: string; tab: string }> = {
  fields: { section: "records", tab: "Fields" },
  stages: { section: "records", tab: "Stages" },
  // "System status" was three derived rows that restated the Overview cards and
  // the Connections pills, under a green chip that contradicted them. The rows
  // are worth keeping; a whole rail section for them was not — they live on
  // Overview now, which already promises "your workspace at a glance — health".
  system: { section: "overview", tab: "" },
};
const SECTION_LABEL: Record<string, string> = {
  ...Object.fromEntries(NAVGROUPS.flatMap((g) => g.items.map((it) => [it[0], it[1]]))),
  waitlist: "Waitlist",
  health: "Health",
};

// Synonyms so search jumps on intent, not just the literal section name.
const SECTION_KEYWORDS: Record<string, string> = {
  // Overview absorbed the old System status section, so it answers for services too.
  overview: "home dashboard health status services supabase resend probe system",
  health: "health prod production status uptime env flags connectors runner heartbeat failures observability incident",
  waitlist: "waitlist signups leads early access launch interest",
  general: "workspace name industry support email brand from-name identity logo image icon avatar mark upload account type agent assistant",
  appearance: "theme accent color colour dark light density motion look feel",
  team: "members invite invitation role permission access seat owner admin remove leave",
  workspaces: "switch organization org tenant logo sidebar colour color rename",
  connections: "integration api token credential connector gemini higgsfield mcp vault resend slack hubspot mailchimp webhook weather csv import",
  records: "custom field property attribute column schema text number date choice currency link record type pipeline stage status funnel won lost qualified closed rename reorder archive vocabulary",
  media: "models image video audio gemini veo higgsfield generation default aspect quality",
  account: "profile photo security sign-in login session sign out name display name avatar password reset credentials",
  usage: "billing cost spend tokens runs plan cap invoice budget",
};

/**
 * Extra search terms for individual sub-tabs.
 *
 * Tab destinations used to carry only `"<section label> <tab>"` as their haystack,
 * so the two controls that most often send someone to Settings in the first place
 * were unreachable by name: "logo" matched nothing, and "postal" — the field whose
 * absence hard-blocks every outbound email — matched nothing either. Someone
 * debugging "why won't my email send" got "No settings match “postal”."
 */
const TAB_KEYWORDS: Record<string, string> = {
  "general/Email": "postal address mailing sender from name unsubscribe compliance can-spam permission reminder footer blocked",
  "general/Agent": "agent assistant arc name display rename",
  "general/Organization": "logo brand mark image upload industry vertical support email account type",
  "team/Invites": "invite invitation pending revoke expire",
  "team/Roles": "role permission capability owner admin marketer reviewer viewer",
  "team/Activity": "audit log history changes",
  "records/Fields": "custom field attribute column schema",
  "records/Stages": "pipeline stage status funnel won lost qualified",
  "records/Names": "rename label vocabulary object names wording",
  "usage/Connectors": "spend cap metered lookups budget refuse",
  "connections/Roadmap": "planned coming soon future integrations",
};

// ---- reusable controls ----
function Seg({ opts, active, value, onChange }: { opts: string[]; active?: string; value?: string; onChange?: (v: string) => void }) {
  const [internal, setInternal] = useState(active ?? opts[0]);
  const v = value ?? internal;
  return (
    <div className="seg">
      {opts.map((o) => (
        <button type="button" key={o} className={o === v ? "on" : ""} aria-pressed={o === v} onClick={() => (onChange ? onChange(o) : setInternal(o))}>{o}</button>
      ))}
    </div>
  );
}

// Small inline save-status line, styled like the other feedback spans in this file.

function Status({ status }: { status: SaveStatus }) {
  if (!status) return null;
  return <span style={{ fontSize: 12, color: status.tone === "ok" ? "var(--ok-text)" : "var(--red-text)" }}>{status.text}</span>;
}
/**
 * Loop state → pill styling. `unknown` deliberately reads as a warning rather
 * than as neutral: on this screen, "we can't tell" is a problem to chase, not a
 * shrug. Grading it green is how silent failures stayed hidden.
 */
const LOOP_PILL: Record<LoopState, string> = { live: "ok", degraded: "warn", down: "err", off: "off", unknown: "warn" };
const LOOP_WORD: Record<LoopState, string> = { live: "Live", degraded: "Degraded", down: "Down", off: "Off", unknown: "Unknown" };

function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`spill ${kind}`}><span className="pd" />{children}</span>;
}
function Row({ label, desc, children }: { label: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return <div className="srow"><div className="sl"><div className="slt">{label}</div>{desc && <div className="sld">{desc}</div>}</div><div className="sc">{children}</div></div>;
}
/**
 * Prove the ops alert channel actually works, from the screen an operator opens
 * when something is wrong.
 *
 * Alerting you cannot test is alerting you do not trust — and the worst time to
 * discover a stale webhook URL or an archived channel is during the incident it
 * was meant to announce.
 */
function TestAlertRow() {
  const [status, setStatus] = useState<SaveStatus>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="panel">
      <div className="panel-h"><h2>Alert channel</h2></div>
      <div className="panel-b">
        <Row
          label="Send a test alert"
          desc="Posts to the platform ops channel through the same path a real failure takes."
        >
          <span className="pillrow">
            <button
              type="button"
              className="btn sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await sendTestOpsAlert();
                  setStatus(res.ok ? { tone: "ok", text: res.message } : { tone: "err", text: res.error });
                })
              }
            >
              {pending ? "Sending…" : "Send test alert"}
            </button>
            <Status status={status} />
          </span>
        </Row>
      </div>
    </div>
  );
}

function Panel({ title, tag, foot, children }: { title: ReactNode; tag?: ReactNode; foot?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-h"><h2>{title}</h2>{tag}</div>
      <div className="panel-b">{children}</div>
      {foot && <div className="panel-f"><Ic d={CHECK} />{foot}</div>}
    </div>
  );
}
// A green "Active" chip used to sit on nine panels — the plan, the member list,
// the invite list, the agent name, the ROLES REFERENCE GUIDE, the activity log,
// the spend cap. It graded nothing and was never false, so it read as
// reassurance the panel had not earned. Panels that genuinely have a state
// (Services, connectors, email) derive their own pill; the rest carry none.
const Head = ({ t, d }: { t: string; d: string }) => <div className="sechead"><h2>{t}</h2><p>{d}</p></div>;

// Breadcrumb trail: Settings › Section [› Sub-tab | › Detail]. Any crumb with an
// onClick steps back to that level; the last crumb is the current page.
type Crumb = { label: string; onClick?: () => void };
function Crumbs({ trail }: { trail: Crumb[] }) {
  return (
    <div className="crumbs">
      {trail.map((c, i) => (
        <span key={c.label + i} style={{ display: "contents" }}>
          {i > 0 && <span className="sep">›</span>}
          {c.onClick ? <button onClick={c.onClick}>{c.label}</button> : <span className="cur">{c.label}</span>}
        </span>
      ))}
    </div>
  );
}


// Real connectors (CONNECTOR_REGISTRY) get functional cards; the rest of the
// catalog below is an honest roadmap. Logo + credential copy per real key.
const CONNECTOR_META: Record<string, { c: string; l: string; credLabel: string; credHint: string }> = {
  "gemini-research": {
    c: "#88b6d8",
    l: "Gem",
    credLabel: "Gemini API key",
    credHint: "From Google AI Studio. Stored encrypted in your Vault — never shown again, never sent to the browser.",
  },
  higgsfield: {
    c: "#c8a24a",
    l: "Hf",
    credLabel: "Higgsfield API token",
    credHint: "From your Higgsfield account. Stored securely, and only ever used to make drafts that wait for your approval.",
  },
  "weather-signals": {
    c: "#7fb89a",
    l: "Wx",
    credLabel: "",
    credHint: "No credential — reads live NWS/NOAA alerts (public API) and proposes opportunities from the weather you opt into. Configure the states or map points to watch.",
  },
  "rss-signals": {
    c: "#8a9bd8",
    l: "Fd",
    credLabel: "",
    credHint: "No credential — reads the public RSS/Atom feeds you list and proposes a timely-response opportunity per fresh item. Add the feed URLs to watch.",
  },
  "news-search": {
    c: "#c99a6a",
    l: "Nw",
    credLabel: "GNews API key",
    credHint: "A free key from gnews.io. Stored encrypted in your Vault — never shown again. Then add the search terms to watch below.",
  },
  "slack-alerts": {
    c: "#4a154b",
    l: "Sl",
    credLabel: "Slack Incoming Webhook URL",
    credHint: "Create an Incoming Webhook in Slack (Apps → Incoming Webhooks), pick the channel, and paste the https://hooks.slack.com/… URL. Stored in your Vault; used only for the alerts you send.",
  },
  "reviews-signals": {
    c: "#e0a94a",
    l: "Rv",
    credLabel: "Google Business Profile",
    credHint: "Connect your Google Business Profile (and optionally Yelp) to pull recent reviews. Stored in your Vault; used read-only — it proposes opportunities and never replies.",
  },
  "competitor-ads": {
    c: "#c47f7f",
    l: "Ad",
    credLabel: "Meta Ad Library access token",
    credHint: "Optional — competitor ad intel is included, so you only need your own Meta token to search on your own rate-limit budget. Stored in your Vault. Read-only competitive intel from Meta's official API — it proposes defensive opportunities and never contacts anyone. (Google has no official ads-transparency API, so this is Meta-only.)",
  },
  "webhook-dispatch": {
    c: "#9aa0ac",
    l: "Wh",
    credLabel: "",
    credHint: "No credential — the endpoint URL lives in config. Sends only from the human-approved path.",
  },
  "hubspot-import": {
    c: "#ff7a59",
    l: "Hs",
    credLabel: "HubSpot token",
    credHint: "A HubSpot private-app token (or OAuth access token) with read-only contact scopes. Stored in your Vault; used read-only — it imports contacts and never writes back to HubSpot.",
  },
  "csv-import": {
    c: "#6ea88f",
    l: "Cv",
    credLabel: "",
    credHint: "No account to connect — set a default persona, then paste a CSV of contacts. Columns are auto-mapped; leads dedupe on email/phone.",
  },
  "mailchimp-import": {
    c: "#ffe01b",
    l: "Mc",
    credLabel: "Mailchimp API key",
    credHint: "From Mailchimp → Account → Extras → API keys (the '…-us21' form). Stored in your Vault; used read-only — imports members, never writes back.",
  },
  "gemini-media": {
    c: "#c8a24a",
    l: "Md",
    credLabel: "Gemini API key",
    credHint: "Optional — included on platform credits (metered, spend-capped). Add your own Google AI Studio key (billing enabled) to generate on your account instead.",
  },
  "lead-enrichment": {
    c: "#5b8def",
    l: "En",
    credLabel: "Enrichment vendor API key",
    credHint: "From your firmographic data vendor. Stored in your Vault. Read-only; each lookup is metered against your spend cap.",
  },
};

// costTier badge — HYBRID cost model (BSR-372 meters later; here we just label it).
const COST_TIER_BADGE: Record<ConnectorCostTier, { label: string; title: string }> = {
  free: { label: "Free", title: "No cost — bypasses metering." },
  byo_key: { label: "Your key", title: "Uses your own provider key/credits — bypasses metering." },
  metered: { label: "Metered", title: "Billed through your Arc usage (BSR-372)." },
};

/** The badge reflects the credential mode ACTUALLY in effect: a connector
 *  running on the platform's key reads "Included" (metered against the plan),
 *  flipping back to "Your key" the moment the workspace stores its own. */
function costBadgeFor(view: Pick<ConnectorView, "costTier" | "activeCredentialSource" | "activeCostTier">): { label: string; title: string } {
  if (view.activeCredentialSource === "platform") {
    return {
      label: "Included",
      title: "Runs on platform credits — metered against your plan, spend-capped. Store your own key to use your own account instead.",
    };
  }
  return COST_TIER_BADGE[view.activeCostTier] ?? COST_TIER_BADGE[view.costTier];
}

const CONNECTOR_KIND_LABEL: Record<string, string> = {
  mcp_tool: "Tool",
  signal_source: "Signal source",
  channel: "Channel",
  import_source: "Import",
};

// Per-connector config editors (no-credential connectors). Each maps a form field
// to/from one key of the workspace_connectors.config jsonb. A connector may expose
// several — saveConnectorConfig merges, so each Save touches only its own key.
//   text   — a single string value
//   csv    — a comma-separated list
//   points — one "lat,lng [label]" per line (a point contains a comma, so it can't
//            live in a csv field; this is why points were unreachable before)
//   feeds  — one feed URL per line, optional "kind:" prefix + label (a URL can't
//            live in a csv field for the same reason)
//   categories — a fixed set of checkboxes (free text can't express a closed
//            enum: a typo'd category would silently watch nothing)
type ConfigFieldKind = "text" | "persona" | "csv" | "points" | "feeds" | "queries" | "categories";
type ConfigField = { key: string; kind: ConfigFieldKind; label: string; placeholder: string; hint: string };

/**
 * Placeholder for the persona-key fields.
 *
 * This used to be `persona_homeowner_emergency` — a real key from one tenant's
 * taxonomy, which read as a CONFIGURED VALUE rather than an example of the
 * format. An empty field then looked identical to a set one, so an operator
 * could believe their audience was chosen when nothing was stored. It is also
 * one workspace's persona shown to every workspace.
 *
 * The replacement is deliberately not a valid key: a placeholder's job is to
 * show the shape, and it must be impossible to mistake for data.
 */
const PERSONA_PLACEHOLDER = "your-persona-key";

// The workspace's own personas, provided once at the SettingsView root so the
// connector "Default persona" field can render a picker instead of a free-text box
// (a typo'd key otherwise fails the import late). Empty → the field falls back to a
// plain input, so offline/no-persona workspaces still work.
const PersonaOptionsContext = createContext<readonly PersonaOption[]>([]);

/**
 * Per-connector config fields.
 *
 * Placeholders are EXAMPLES, and this UI is shown to every workspace — so they
 * must not be one tenant's real data. They used to be: "Big Shoulders
 * Restoration" and "ServPro Chicago" named an actual company and its actual
 * competitor, "roof, storm, water damage" was one trade's vocabulary, and
 * "IL, WI, IN" / "Chicago / Naperville" were one workspace's real service area.
 * The geographic examples now describe a single, plainly fictional business so
 * nothing here reads as somebody's live configuration.
 */
const CONFIG_FIELDS: Record<string, ConfigField[]> = {
  "weather-signals": [
    {
      key: "states",
      kind: "csv",
      label: "Service area — whole states",
      placeholder: "CO, UT, NM",
      hint: "Comma-separated two-letter US state codes. Watches every active NWS/NOAA alert statewide — broad, so a metro-area business usually wants points below instead. No API key needed.",
    },
    {
      key: "points",
      kind: "points",
      label: "Service area — points",
      placeholder: "39.7392,-104.9903 Downtown\n39.7294,-104.8319 East side",
      hint: "One lat,lng per line, with an optional label. Only alerts whose area actually covers a point become opportunities — the right choice when you serve a metro, not a whole state. Use either or both.",
    },
    {
      key: "eventCategories",
      kind: "categories",
      label: "Weather worth surfacing",
      placeholder: "",
      hint: "Which alerts become opportunities. Property damage is the default and suits most trades; enable the others only if that weather drives work for you — extreme heat for HVAC, air quality for filtration and ventilation, marine for waterfront. Each writes its own claim, so a heat card never says a heatwave damaged a building.",
    },
    {
      key: "persona",
      // `text` here while the other three persona fields were `persona` pickers,
      // so this one alone accepted a typo that fails silently at detection time.
      kind: "persona",
      label: "Audience persona (optional)",
      placeholder: PERSONA_PLACEHOLDER,
      hint: "A persona key from your workspace's own taxonomy — who a weather-response campaign should target. Leave blank and the opportunity still carries the weather evidence; you pick the audience when you draft.",
    },
  ],
  "rss-signals": [
    {
      key: "feeds",
      kind: "feeds",
      label: "Feeds to watch",
      placeholder: "brand: https://www.google.com/alerts/feeds/…  My brand alerts\ncompetitor: https://competitor.com/blog/feed\nhttps://news.example.com/rss  Industry news",
      hint: "One feed URL per line. Optional prefix — brand:, competitor:, or industry: (default) — sets the angle, and any text after the URL is a label. A fresh item in any of them becomes a timely-response opportunity.",
    },
    {
      key: "keywords",
      kind: "csv",
      label: "Only surface items mentioning… (optional)",
      placeholder: "a service you sell, your city, a competitor",
      hint: "Comma-separated. When set, only feed items mentioning one of these words become opportunities — the way to tame a noisy industry feed. Leave blank to surface every fresh item.",
    },
  ],
  "news-search": [
    {
      key: "queries",
      kind: "queries",
      label: "Search terms to watch",
      placeholder: "brand: Your company name\ncompetitor: A competitor's name\nyour city + a service you sell",
      hint: "One search term per line. Optional prefix — brand:, competitor:, or industry: (default) — sets the angle. Each fresh news article matching a term becomes a timely-response opportunity. Needs a GNews key above.",
    },
  ],
  "webhook-dispatch": [
    {
      key: "endpoint",
      kind: "text",
      label: "Endpoint URL",
      placeholder: "https://example.com/hooks/arc",
      hint: "Approved messages POST here — only from the human-approved send path.",
    },
  ],
  "reviews-signals": [
    {
      key: "gbpLocation",
      kind: "text",
      label: "Business location",
      placeholder: "accounts/123456789/locations/987654321",
      hint: "The Google Business Profile location resource name whose reviews Arc reads. Find it in the Business Profile API (accounts.locations.list) — reviews are fetched per location.",
    },
  ],
  "competitor-ads": [
    {
      key: "competitors",
      kind: "csv",
      label: "Competitors to watch",
      placeholder: "Competitor One, Competitor Two",
      hint: "Advertiser or brand names to search the Meta Ad Library for. Each becomes a search term; matching advertisers become competitor-signal opportunities.",
    },
    {
      key: "countries",
      kind: "csv",
      label: "Countries",
      placeholder: "US, CA",
      hint: "ISO country codes the ads reached — Meta requires at least one. Note: outside the EU the Ad Library API only exposes political & social-issue ads.",
    },
  ],
  "hubspot-import": [
    {
      key: "defaultPersona",
      kind: "persona",
      label: "Default persona",
      placeholder: PERSONA_PLACEHOLDER,
      hint: "A persona key from your workspace (see the Personas page) assigned to imported contacts — there is no auto-classifier. A per-record override is set with the personaProperty config key.",
    },
  ],
  "csv-import": [
    {
      key: "defaultPersona",
      kind: "persona",
      label: "Default persona",
      placeholder: PERSONA_PLACEHOLDER,
      hint: "A persona key from your workspace (see the Personas page) for imported leads — they carry a required persona. A `persona` column in your CSV overrides it per row. Set this, then paste your CSV below.",
    },
  ],
  "mailchimp-import": [
    {
      key: "audienceId",
      kind: "text",
      label: "Audience (list) id",
      placeholder: "a1b2c3d4e5",
      hint: "The Mailchimp audience to import. Find it in Mailchimp → Audience → Settings → 'Audience name and defaults' → Audience ID.",
    },
    {
      key: "defaultPersona",
      kind: "persona",
      label: "Default persona",
      placeholder: PERSONA_PLACEHOLDER,
      hint: "A persona key from your workspace (see the Personas page) assigned to every imported member — they carry a required persona.",
    },
  ],
  "lead-enrichment": [
    {
      key: "endpoint",
      kind: "text",
      label: "Vendor endpoint URL",
      placeholder: "https://api.vendor.example/v1/companies/find",
      hint: "Your firmographic vendor's company-lookup endpoint. Each import looks up companies here (metered) to derive account tier.",
    },
  ],
};
const CONNECTOR_STATUS_PILL: Record<ConnectorStatus, { kind: string; label: string }> = {
  connected: { kind: "ok", label: "Connected" },
  not_configured: { kind: "off", label: "Not set up" },
  // Not "Paused": `disabled` is simply `!enabled`, so a connector nobody has
  // ever switched on was reading as one that had been running and got suspended.
  disabled: { kind: "warn", label: "Off" },
  error: { kind: "err", label: "Error" },
  // The integration isn't written. "Planned" rather than "Not connected", which
  // would imply connecting is something you could go and do.
  unavailable: { kind: "off", label: "Not available yet" },
};

// The 44-entry MEDIA_MODELS literal, PCOL provider colours, and the
// RosterModel/MODEL_CAT_* metadata that fed the removed "Roster" tab lived
// here. They were a hand-copy of src/domain/higgsfield-models.ts kept in sync
// by memory. The catalog has one home again.
/** Two-letter monogram for a brand mark (still used by the logo upload field). */
const pinit = (p: string) => { const w = p.split(/[\s-]+/); return (w.length > 1 ? w[0][0] + w[1][0] : p.slice(0, 2)).toUpperCase(); };

const EMPTY_USAGE: SettingsUsageView = {
  isDemo: false, configured: false, tokensLabel: "0", runsLabel: "0", costLabel: "$0.00",
  // No invented cap. "$80" matched no plan tier we sell ($2 / $25 / $75 / $250),
  // and it was rendered verbatim whenever the usage read failed.
  capLabel: "—", pctOfCap: 0, isNearCap: false, rangeLabel: "Last 30 days",
  daily: [], recent: [], byModel: [],
};

// The 5 named accents from globals.css (html[data-accent="…"]). Swatch colors are
// the representative --accent of each theme so the picker previews the real thing.
const ACCENTS: { key: AppSettings["appearanceAccent"]; color: string }[] = [
  { key: "gold", color: "#c8a24a" },
  { key: "blue", color: "#5bb7e8" },
  { key: "red", color: "#d98080" },
  { key: "steel", color: "#aeb5c2" },
  { key: "emerald", color: "#7fb89a" },
];
const DENSITY_LABEL: Record<AppSettings["appearanceDensity"], string> = { comfortable: "Comfortable", compact: "Compact" };
const MOTION_LABEL: Record<AppSettings["appearanceMotion"], string> = { standard: "Standard", reduced: "Reduced" };
const PROFILE_LABEL: Record<AppSettings["workspaceProfile"], string> = { individual: "Individual", company: "Company", agency: "Agency" };

export function SettingsView({ brandName, workspaceName = "", email, viewerName = "", session = null, avatarUrl = null, workspaceLogoUrl = null, team, usage, connectorSpend = null, billing = null, settings, connectors, workspaces, emailConnection = null, liveSendEnabled = true, agentConnection = null, personaOptions = [], hubspotOAuthConfigured = false, googleOAuthConfigured = false, waitlist = null, health = null, suppression = null, customFields = [], crmObjectLabels, pipelineStages = null, pipelineOccupancy = null, pipelineObjectLabels, industryObjectLanguage, industrySectionLabel, savedObjectLabels = {} }: { brandName: string; workspaceName?: string; email: string; viewerName?: string; session?: AccountSession | null; avatarUrl?: string | null; workspaceLogoUrl?: string | null; team: SettingsTeamView; usage: SettingsUsageView | null; connectorSpend?: ConnectorSpendView | null; billing?: SettingsBillingView | null; settings: AppSettings; connectors: SettingsConnectorsView; workspaces: SettingsWorkspacesView; emailConnection?: ConnectionView | null; liveSendEnabled?: boolean; agentConnection?: EffectiveAgentConnection | null; personaOptions?: readonly PersonaOption[]; hubspotOAuthConfigured?: boolean; googleOAuthConfigured?: boolean; waitlist?: WaitlistView | null; health?: HealthConsoleView | null; suppression?: SuppressionView | null; customFields?: CustomFieldDefinition[]; crmObjectLabels: Record<CustomFieldObjectKey, string>; pipelineStages?: Record<PipelineObjectKey, PipelineStage[]> | null; pipelineOccupancy?: Record<PipelineObjectKey, Record<string, number>> | null; pipelineObjectLabels: Record<PipelineObjectKey, string>; industryObjectLanguage: Record<ProductLanguageObjectKey, CrmObjectLanguage>; industrySectionLabel: string; savedObjectLabels?: Partial<Record<ProductLanguageObjectKey, ObjectLabelOverride>> }) {
  const [cur, setCur] = useState("overview");
  // Health and the waitlist are platform-level, not workspace-level: the server
  // sends null unless the viewer is a platform admin, so the group — and every
  // section in it — is absent for everyone else.
  const platformItems: ReadonlyArray<readonly [string, string]> = [
    ...(health ? [["health", "Health"] as const] : []),
    ...(waitlist ? [["waitlist", "Waitlist"] as const] : []),
  ];
  const navGroups: ReadonlyArray<{ g: string; items: ReadonlyArray<readonly [string, string]> }> = platformItems.length
    ? [...NAVGROUPS, { g: "PLATFORM", items: platformItems }]
    : NAVGROUPS;
  const memberCount = team.members.length;
  const pendingCount = team.invites.length;
  // `usage === null` means the read FAILED (page.tsx reports it as degraded), not
  // that the workspace spent nothing. Keep the two apart everywhere a figure is
  // rendered — EMPTY_USAGE is a shape to render empty states from, never an
  // answer about money.
  const usageUnavailable = usage === null;
  const usageView = usage ?? EMPTY_USAGE;
  const [navQ, setNavQ] = useState("");
  const [connCat, setConnCat] = useState("All");
  const [connQ, setConnQ] = useState("");
  const [sub, setSub] = useState<Record<string, string>>({});
  const [connSel, setConnSel] = useState<string | null>(null);
  // Which CRM object a deep link arrived pointing at (?o=leads). The Records
  // editors list every object at once, so a "manage the fields on this record"
  // link from CRM has to say which row it meant or it drops you at the top of a
  // six-object list to find it yourself.
  const [focusObject, setFocusObject] = useState<string | null>(null);
  const router = useRouter();

  // Deep-linkable navigation: the section + sub-tab live in the URL (?s=…&t=…),
  // so Back/Forward step through sub-pages and a shared link lands on the exact
  // one. Client-only history sync — no server round-trip.
  useEffect(() => {
    const apply = () => {
      const p = new URLSearchParams(window.location.search);
      const raw = p.get("s");
      const legacy = raw ? LEGACY_SECTIONS[raw] : undefined;
      const s = legacy?.section ?? raw;
      // Deep-linking a platform section without the data (i.e. not a platform
      // admin) falls back to overview rather than rendering an empty shell.
      const section = s && SECTION_LABEL[s] && (s !== "waitlist" || waitlist) && (s !== "health" || health) ? s : "overview";
      const t = legacy?.tab ?? p.get("t");
      setCur(section);
      setConnSel(section === "connections" ? p.get("c") : null);
      setFocusObject(p.get("o"));
      if (t && SUBTABS[section]?.includes(t)) setSub((prev) => ({ ...prev, [section]: t }));
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, [health, waitlist]);

  const navTo = (section: string, tab?: string) => {
    setCur(section);
    setConnSel(null);
    // Moving under your own steam widens the editors again. The scope came from
    // the link, not from a choice you made here, so it should not survive you
    // navigating somewhere else in Settings.
    setFocusObject(null);
    if (tab && SUBTABS[section]?.includes(tab)) setSub((s) => ({ ...s, [section]: tab }));
    const first = SUBTABS[section]?.[0];
    const activeT = tab ?? sub[section] ?? first;
    const p = new URLSearchParams();
    if (section !== "overview") p.set("s", section);
    if (activeT && activeT !== first) p.set("t", activeT);
    const qs = p.toString();
    window.history.pushState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  };

  // Drill into a single connector's detail page (deep-linked ?s=connections&c=key).
  const openConnector = (key: string) => {
    setCur("connections");
    setConnSel(key);
    window.history.pushState(null, "", `${window.location.pathname}?s=connections&c=${encodeURIComponent(key)}`);
  };
  const closeConnector = () => {
    setConnSel(null);
    window.history.pushState(null, "", `${window.location.pathname}?s=connections`);
  };

  /**
   * Real deployment/workspace health, derived from the SAME props the rest of
   * Settings renders from — never asserted. Replaces a hardcoded all-green array
   * that told every deployment its Gemini key was "Present" and its runner
   * "Connected · 2m ago". Each row links to the screen where you'd fix it.
   */
  const systemStatus = (() => {
    const rows: { label: string; desc?: string; kind: string; value: string; go?: { label: string; run: () => void } }[] = [];

    // A connected workspace is proof Supabase is reachable — this view was rendered from it.
    rows.push({
      label: "Workspace database",
      desc: connectors.configured ? "The workspace database is reachable." : "No workspace is connected, so changes cannot be saved.",
      kind: connectors.configured ? "ok" : "warn",
      value: connectors.configured ? "Connected" : "Not connected",
    });

    if (emailConnection) {
      const e = emailConnection;
      const ready = e.enabled && (e.credentialPresent || Boolean(e.envVar));
      rows.push({
        label: "Email delivery (Resend)",
        desc: !liveSendEnabled ? "Live sending is paused by the deployment safety lock." : e.fromEmail ? `From ${e.fromEmail}.` : "No from-address set.",
        kind: !ready ? "warn" : liveSendEnabled ? "ok" : "warn",
        value: !e.credentialPresent && !e.envVar ? "No key" : !e.enabled ? "Disabled" : liveSendEnabled ? "Ready" : "Key set · sending off",
        go: { label: "Manage", run: () => openConnector("resend") },
      });
    }

    if (agentConnection) {
      const h = agentConnection.health;
      const seen = h.lastSeenAt ? new Date(h.lastSeenAt).toLocaleString() : null;
      rows.push({
        label: "Arc agent",
        desc: !agentConnection.enabled ? "Disabled for this workspace." : h.lastError ? h.lastError : seen ? `Last seen ${seen}.` : "No check-in recorded yet.",
        kind: !agentConnection.enabled ? "warn" : h.lastStatus === "ok" ? "ok" : h.lastStatus ? "err" : "warn",
        value: !agentConnection.enabled ? "Disabled" : h.lastStatus === "ok" ? "Healthy" : h.lastStatus ?? "Never checked in",
        go: { label: "Agent", run: () => navTo("general", "Agent") },
      });
    }

    // Connector health comes straight from the connectors read-model — no guessing
    // which providers a deployment has.
    for (const c of connectors.connectors.filter((v) => v.enabled || v.status === "error")) {
      rows.push({
        label: c.label,
        kind: c.status === "connected" ? "ok" : c.status === "error" ? "err" : "warn",
        value: c.status === "connected" ? "Connected" : c.status === "error" ? "Last test failed" : c.status.replace(/_/g, " "),
        go: { label: "Manage", run: () => openConnector(c.key) },
      });
    }

    return rows;
  })();

  // Search jumps to a destination (section, sub-tab, or connector), not just a
  // rail filter. Each entry carries synonyms so intent-y queries land right.
  type Dest = { label: string; sub?: string; keywords: string; go: () => void };
  const destinations: Dest[] = [];
  for (const grp of navGroups) {
    for (const [key, label] of grp.items) {
      destinations.push({ label, keywords: `${label} ${grp.g} ${SECTION_KEYWORDS[key] ?? ""}`, go: () => navTo(key) });
      for (const tab of SUBTABS[key] ?? []) {
        destinations.push({
          label,
          sub: tab,
          keywords: `${label} ${tab} ${TAB_KEYWORDS[`${key}/${tab}`] ?? ""}`,
          go: () => navTo(key, tab),
        });
      }
    }
  }
  for (const v of connectors.connectors) {
    destinations.push({ label: "Connections", sub: v.label, keywords: `connections ${v.label} ${v.key} connector integration`, go: () => openConnector(v.key) });
  }
  if (emailConnection) {
    destinations.push({ label: "Connections", sub: "Resend", keywords: "connections resend email send delivery from address", go: () => openConnector("resend") });
  }
  const q = navQ.trim().toLowerCase();
  const results = q
    ? destinations
        .map((d) => {
          const hay = `${d.label} ${d.sub ?? ""}`.toLowerCase();
          const score = hay.startsWith(q) ? 3 : hay.includes(q) ? 2 : d.keywords.toLowerCase().includes(q) ? 1 : 0;
          return { d, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((r) => r.d)
    : [];
  const selectResult = (d: Dest) => { d.go(); setNavQ(""); };

  // Active in-section tab + the tab bar for the current section (null if none).
  const activeSub = SUBTABS[cur] ? sub[cur] ?? SUBTABS[cur][0] : null;
  const subCounts: Record<string, Record<string, number>> = {
    // The Live grid renders the email connection alongside the connector rows,
    // so counting only `connectors` said 15 while 16 cards were on screen.
    connections: { Live: connectors.connectors.length + (emailConnection ? 1 : 0) },
    team: { Members: team.members.length, Invites: team.invites.length },
    // Fields counts what you've defined; Stages counts pipelines, not stages —
    // there is no single stage count across three separate pipelines.
    records: { Fields: customFields.filter((d) => d.active).length },
  };
  const subBar = SUBTABS[cur] ? (
    <div className="subtabs">
      {SUBTABS[cur].map((t) => (
        <button key={t} className={t === activeSub ? "on" : ""} onClick={() => navTo(cur, t)}>
          {t}{subCounts[cur]?.[t] != null ? <span className="sct">{subCounts[cur][t]}</span> : null}
        </button>
      ))}
    </div>
  ) : null;
  // Every connector that actually exists for this workspace, including the email
  // connection (which is its own read-model, not a `connectors` row). The
  // Roadmap tab subtracts this set so nothing shipped can be listed as planned.
  const liveConnectorKeys = new Set<string>([
    ...connectors.connectors.map((v) => v.key),
    ...(emailConnection ? ["resend"] : []),
  ]);
  const selectedConnector = connSel && connSel !== "resend" ? connectors.connectors.find((v) => v.key === connSel) ?? null : null;
  const resendModalOpen = connSel === "resend";
  // "Recommended for your business" — real connectors whose verticals match the
  // workspace industry (BSR-371). Tailored, non-universal; empty when no industry set.
  const workspaceIndustry = (settings.industry ?? "").trim();
  const recommendedConnectors = workspaceIndustry
    ? connectors.connectors.filter((v) => connectorMatchesIndustry(findConnector(v.key)?.verticals ?? [], workspaceIndustry))
    : [];

  // Overview cards read from live workspace data — never hardcoded. Connections active counts
  // enabled connectors + email; runner status reflects the agent_connections heartbeat.
  // The workspace's OWN industry. This row was the literal string
  // "Company · Restoration & home services" for every tenant — every other row
  // in this panel is live data, so a law firm read its own settings and was told
  // it was a restoration company. Unset says so rather than guessing a vertical.
  const businessTypeLabel =
    INDUSTRY_OPTIONS.find((o) => o.value === settings.industry)?.label ?? "Not set";

  const activeConnections = connectors.connectors.filter((c) => c.enabled).length + (emailConnection?.enabled ? 1 : 0);

  // Rail dots, derived from the same rows the sections render. `systemStatus`
  // already grades itself; take its worst row rather than asserting green.
  const worstKind = (kinds: string[]): "ok" | "warn" | "err" =>
    kinds.includes("err") ? "err" : kinds.includes("warn") ? "warn" : "ok";
  const dots: Record<string, string> = {
    connections: DOT_COLOR[
      connectors.connectors.some((c) => c.status === "error")
        ? "err"
        : activeConnections === 0
          ? "warn"
          : "ok"
    ],
  };
  // "Runner" is what we call the Cloud Run worker; a customer has no idea what
  // one is, and "Idle" told them nothing about whether Arc was working (BSR-657).
  const runnerValue = !agentConnection?.enabled
    ? "Off"
    : agentConnection.health.lastStatus === "ok"
      ? "Working"
      : agentConnection.health.lastStatus
        ? "Not responding"
        : "Waiting for work";

  const sections: Record<string, ReactNode> = {
    records: activeSub === "Names" ? (
      <>
        <Head
          t="Object names"
          d="What this workspace calls the six record types. Your industry picks these to start with; rename any that don't match how you talk about the work."
        />
        {subBar}
        <ObjectLabelsPanel
          industryLabels={industryObjectLanguage}
          industrySection={industrySectionLabel}
          savedSection={settings.objectLabels.section ?? ""}
          savedObjects={savedObjectLabels}
        />
      </>
    ) : activeSub === "Stages" ? (
      <>
        <Head
          t="Pipeline stages"
          d="The steps your records move through. Rename them to your team's words, reorder them, or add the ones you're missing — reporting follows the meaning you give each stage, not its name."
        />
        {subBar}
        {pipelineStages && pipelineOccupancy ? (
          <PipelineStagesPanel
            stagesByObject={pipelineStages}
            occupancyByObject={pipelineOccupancy}
            objectLabels={pipelineObjectLabels}
            focusObject={focusObject}
          />
        ) : (
          // The read failed. Rendering the default stages here would show a
          // pipeline that may not be this tenant's and invite them to "correct"
          // it, overwriting the one they actually have.
          <div className="panel">
            <div className="panel-b">
              <p className="cxm-hint">
                Your pipeline stages couldn&apos;t be loaded just now, so they aren&apos;t shown —
                editing them against data we couldn&apos;t read could overwrite your setup. Nothing
                has changed. Reload to try again.
              </p>
            </div>
          </div>
        )}
      </>
    ) : (
      <>
        <Head
          t="Custom fields"
          d="Track what the built-in fields don't cover. Fields you add here appear on the record, in the add and edit forms, and in what Arc reads when it drafts."
        />
        {subBar}
        <CustomFieldsPanel
          definitions={customFields}
          objectLabels={crmObjectLabels}
          focusObject={focusObject}
        />
      </>
    ),
    health: health ? (
      <>
        <Head
          t="Health"
          d="Whether production is actually working, in one place — configuration, connections, the Arc agent, and what has recently failed. Platform-wide, across every workspace."
        />
        <TestAlertRow />
        {/* The three answers an operator actually needs. Everything below is the
            evidence behind them. Grading lives in health-grading.ts so "is the
            send loop live?" is a tested rule, not an impression formed by
            scanning pills. */}
        <Panel
          title="Loops"
          tag={<Pill kind={LOOP_PILL[health.overall]}>{LOOP_WORD[health.overall]}</Pill>}
          foot={`Read ${relTime(health.generatedAt)}${health.databaseConfigured ? "" : " — Supabase is not configured, so only env readiness below is real"}`}
        >
          {health.loops.map((loop) => (
            <Row key={loop.key} label={loop.label} desc={loop.detail}>
              <Pill kind={LOOP_PILL[loop.state]}>{LOOP_WORD[loop.state]}</Pill>
            </Row>
          ))}
        </Panel>

        {/* Presence only. No value is ever read into this view — an operator
            needs to know a flag is missing, never what it is set to. */}
        {health.envGroups.map((group) => (
          <Panel
            key={group.capability}
            title={group.capability}
            // The tag reports the CAPABILITY, not a raw unset count. Social has
            // eleven optional variables; "11 unset" reads as eleven problems
            // when it means "not using social", and a panel that cries wolf is
            // one an operator learns to skip (BSR-480).
            tag={
              group.state === "ready"
                ? <span className="tg ok">ready</span>
                : <Pill kind={group.state === "inert" ? "off" : "warn"}>{group.state}</Pill>
            }
          >
            <Row label={<span className="tg">{group.state}</span>} desc={group.detail}>
              <span />
            </Row>
            {group.flags.map((flag) => (
              <Row
                key={flag.name}
                label={
                  <>
                    <code>{flag.name}</code>{" "}
                    {flag.requirement !== "required" && <span className="tg">{flag.requirement}</span>}
                  </>
                }
                desc={flag.purpose}
              >
                {/* An unset OPTIONAL var is a choice, not a fault — only a
                    missing required one is worth a warning colour. */}
                <Pill kind={flag.set ? "ok" : flag.requirement === "required" ? "warn" : "off"}>
                  {flag.set ? "Set" : "Unset"}
                </Pill>
              </Row>
            ))}
          </Panel>
        ))}

        <Panel title="Arc agent" tag={<Pill kind={health.runner.configured ? "ok" : "off"}>{health.runner.configured ? "Configured" : "Not configured"}</Pill>}>
          <Row label="Last heartbeat" desc={health.runner.lastError || "Arc only checks in when there is work, so a quiet period is not by itself a fault."}>
            <Pill kind={health.runner.lastStatus === "ok" ? "ok" : health.runner.lastStatus ? "err" : "warn"}>
              {health.runner.lastSeenAt ? relTime(health.runner.lastSeenAt) : "Never seen"}
            </Pill>
          </Row>
          <Row label="Queue" desc="Work waiting to be picked up. A queue that stops draining is the real stall signal.">
            <span className="pillrow">
              <Pill kind={health.runner.oldestQueuedMinutes !== null && health.runner.oldestQueuedMinutes >= 30 ? "err" : "ok"}>{health.runner.queued} queued</Pill>
              <Pill kind="ok">{health.runner.running} running</Pill>
            </span>
          </Row>
          <Row label="Failures (24h)" desc="Agent tasks that ended in a failed state.">
            <Pill kind={health.runner.failedLast24h > 0 ? "warn" : "ok"}>{health.runner.failedLast24h}</Pill>
          </Row>
        </Panel>

        <Panel title="Pipeline vitals" tag={<span className="tg ok">live</span>}>
          {health.vitals.map((vital) => (
            <Row key={vital.label} label={vital.label} desc={vital.at ? undefined : vital.emptyMeaning}>
              <Pill kind={vital.at ? "ok" : "warn"}>{vital.at ? relTime(vital.at) : "Never"}</Pill>
            </Row>
          ))}
        </Panel>

        <Panel
          title="Connectors"
          tag={<span className="ph-d">{health.connectors.length} across all workspaces</span>}
        >
          {health.connectors.length === 0 ? (
            <Row label="None configured" desc="No workspace has enabled a connector yet.">
              <Pill kind="off">Empty</Pill>
            </Row>
          ) : (
            health.connectors.map((c) => (
              <Row
                key={`${c.workspace}:${c.connectorKey}`}
                label={<>{c.connectorKey} <span className="ph-d">· {c.workspace}</span></>}
                desc={c.lastError || (c.lastTestedAt ? `Last tested ${relTime(c.lastTestedAt)}` : "Never tested.")}
              >
                <span className="pillrow">
                  <Pill kind={c.enabled ? "ok" : "off"}>{c.enabled ? "On" : "Off"}</Pill>
                  {c.enabled && <Pill kind={c.credentialPresent ? "ok" : "err"}>{c.credentialPresent ? "Credential" : "No credential"}</Pill>}
                  {c.lastTestOk === false && <Pill kind="err">Test failed</Pill>}
                </span>
              </Row>
            ))
          )}
        </Panel>

        <Panel
          title="Recent failures"
          tag={health.sentryConfigured ? <span className="tg ok">Sentry on</span> : <Pill kind="warn">Sentry off</Pill>}
        >
          {health.failures.length === 0 ? (
            <Row label="Nothing failed" desc="No agent task is in a failed state.">
              <Pill kind="ok">Clear</Pill>
            </Row>
          ) : (
            health.failures.map((f, i) => (
              <Row key={`${f.at}-${i}`} label={f.source} desc={f.summary}>
                <Pill kind="err">{f.at ? relTime(f.at) : "—"}</Pill>
              </Row>
            ))
          )}
        </Panel>

        <div>
          <button type="button" className="btn" onClick={() => router.refresh()}>
            <Ic d='<path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 00-14-3M4 14a8 8 0 0014 3"/>' />Re-check
          </button>
        </div>
      </>
    ) : null,
    waitlist: waitlist ? (
      <>
        <Head t="Waitlist" d="Everyone who asked for early access from the public site. Platform-wide, not workspace-scoped." />
        <div className="panel">
          <div className="panel-h"><h2>Signups</h2><span className="ph-d" style={{ marginLeft: 6 }}>{waitlist.total.toLocaleString()} total</span></div>
          <div className="panel-b" style={{ paddingTop: 12, paddingBottom: 14 }}>
            <div className="wl-stats">
              <div className="wl-stat"><div className="wl-stat-v">{waitlist.total.toLocaleString()}</div><div className="wl-stat-l">Total signups</div></div>
              <div className="wl-stat"><div className="wl-stat-v">{waitlist.last7.toLocaleString()}</div><div className="wl-stat-l">Last 7 days</div></div>
              {waitlist.bySource.map((row) => (
                <div className="wl-stat" key={row.source}>
                  <div className="wl-stat-v">{row.count.toLocaleString()}</div>
                  <div className="wl-stat-l">{row.source}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2>Recent signups</h2>
            <span className="ph-d" style={{ marginLeft: 6 }}>
              {waitlist.total > waitlist.recent.length
                ? `newest ${waitlist.recent.length} of ${waitlist.total.toLocaleString()}`
                : "newest first"}
            </span>
          </div>
          <div className="panel-b" style={{ padding: waitlist.recent.length === 0 ? "2px 16px" : "0 16px" }}>
            {waitlist.recent.length === 0 ? (
              <div className="sr-empty">No signups yet — they&apos;ll appear here as they come in.</div>
            ) : (
              <div className="wl-rows">
                {waitlist.recent.map((row) => (
                  <div className="wl-row" key={`${row.email}-${row.createdAt}`}>
                    <span className="wl-email">{row.email}</span>
                    <span className="wl-src">{row.source}</span>
                    <span className="wl-when">{new Date(row.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </>
    ) : null,
    overview: (
      <>
        <Head t="Overview" d="Where this workspace stands, and where to change it." />
        {/* ONE list, not a tile row above a table saying the same things.
            There used to be four equal `ovcard` tiles here — Connections
            active, Team members, Arc, "Of this month’s budget" — sitting
            directly on top of a Workspace panel that listed Plan, Business type
            and Team again. So "Team" appeared twice, forty pixels apart, and the
            tile was the WORSE of the two: it read "4" where the row read
            "4 members · 1 pending". Every tile was a button to a settings
            section, which is exactly what the rows already are.

            The tiles also broke two rules to say it: an equal N-column grid
            (DESIGN.md §5), and a 20px serif number treatment wrapped around
            "Waiting for work", which is a sentence. Folding them in loses no
            fact and no destination — every row still carries the button that
            tile was. */}
        <Panel title="Workspace">
          <Row label="Plan"><span className="pillrow"><Pill kind="ok">{billing?.planLabel ?? "—"}</Pill><button className="btn sm" onClick={() => navTo("usage")}>Manage plan</button></span></Row>
          <Row label="Business type"><span className="pillrow"><span className="ptxt">{businessTypeLabel}</span><button className="btn sm" onClick={() => navTo("general")}>Change</button></span></Row>
          {/* A failed team read leaves `members` empty, which rendered "0
              members" — a workspace being told it has nobody in it. Same
              distinction the Members list itself draws (BSR-578). */}
          <Row label="Team"><span className="pillrow"><span className="ptxt">{team.failed ? "Couldn’t be read" : `${memberCount} ${memberCount === 1 ? "member" : "members"}${pendingCount > 0 ? ` · ${pendingCount} pending` : ""}`}</span><button className="btn sm" onClick={() => navTo("team")}>Manage</button></span></Row>
          <Row label="Arc" desc="Whether the agent is picking up work right now."><span className="pillrow"><span className="ptxt">{runnerValue}</span><button className="btn sm" onClick={() => navTo("general", "Agent")}>Open</button></span></Row>
          <Row label="Connections" desc="Tools Arc can use on your behalf."><span className="pillrow"><span className="ptxt">{activeConnections === 0 ? "None yet" : `${activeConnections} on`}</span><button className="btn sm" onClick={() => navTo("connections")}>Manage</button></span></Row>
          {/* "Of this month’s budget" was billing-system vocabulary in the
              primary UI (§4.2). Say what it is: how much of the month’s
              allowance Arc has used. */}
          {/* "0% used" when the read FAILED is a statement about spend we can't
              stand behind — the operator relaxes about a cap they may be near. */}
          <Row label="Usage this month" desc="How much of your monthly allowance Arc has used."><span className="pillrow"><span className="ptxt">{usageUnavailable ? "Couldn’t be read" : `${usageView.pctOfCap}% used`}</span><button className="btn sm" onClick={() => navTo("usage")}>See usage</button></span></Row>
        </Panel>
        {/* Formerly its own "System status" rail section. Every row is derived
            from the same props the rest of Settings renders from, and each links
            to the screen where you'd fix it. */}
        <Panel
          title="Services"
          tag={(() => {
            const kind = worstKind(systemStatus.map((s) => s.kind));
            return <Pill kind={kind}>{kind === "ok" ? "All good" : kind === "warn" ? "Needs attention" : "Failing"}</Pill>;
          })()}
        >
          {systemStatus.map((s) => (
            <Row key={s.label} label={s.label} desc={s.desc}>
              <span className="pillrow">
                <Pill kind={s.kind}>{s.value}</Pill>
                {s.go && <button type="button" className="btn sm" onClick={s.go.run}>{s.go.label}</button>}
              </span>
            </Row>
          ))}
        </Panel>
        <div>
          <button type="button" className="btn" onClick={() => router.refresh()}>
            <Ic d='<path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 00-14-3M4 14a8 8 0 0014 3"/>' />Re-check
          </button>
        </div>
      </>
    ),
    general: (
      <>
        <Head t="Organization & brand" d="Set the organization identity used on generated creative and as the default across Arc. Workspace-only sidebar overrides live under Workspaces." />
        {subBar}
        {activeSub === "Agent" ? (
          <AgentIdentityPanel settings={settings} />
        ) : activeSub === "Email" ? (
          <>
            <EmailIdentityPanel settings={settings} />
            <SuppressionPanel view={suppression} />
          </>
        ) : (
          /* The panel inside repeated this section's own H1 verbatim — "Organization
             & brand" stacked directly on "Organization & brand". */
          <GeneralPanel brandName={brandName} workspaceName={workspaceName || brandName} settings={settings} workspaceLogoUrl={workspaceLogoUrl} />
        )}
      </>
    ),
    appearance: (
      <>
        <Head t="Appearance" d="How the console looks. Accent, density, and motion apply across the whole app and are saved to your workspace." />
        <AppearancePanel settings={settings} />
      </>
    ),
    team: (
      <>
        <Head t="Team" d="Who’s in this workspace, what they can do, and what’s changed. An invite goes out as a branded email from your workspace." />
        {subBar}
        {activeSub === "Invites" ? (
          <TeamInvites workspaceId={team.workspaceId} seedInvites={team.invites} />
        ) : activeSub === "Roles" ? (
          <RolesGuide />
        ) : activeSub === "Activity" ? (
          <ActivityLog entries={team.activity} isDemo={team.isDemo} />
        ) : (
          <TeamMembers team={team} />
        )}
      </>
    ),
    workspaces: (
      <>
        <Head t="Workspaces" d="Each workspace has its own CRM and Arc context. Customize its sidebar name, color, or optional logo override here." />
        <WorkspacesSection view={workspaces} />
      </>
    ),
    connections: (
      <>
        <Head t="Connections" d="What Arc can reach. Each connector is set up per workspace — click one to add its key or switch it on. Keys are stored encrypted, and posting or sending always waits for your approval." />
        {subBar}
        {activeSub === "Roadmap" ? (
          <>
            <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 2px 12px", lineHeight: 1.5 }}>More integrations are planned. They’re listed honestly — connecting from here isn’t available yet. Social posting & email sending will always stay human-approved.</div>
            <div className="connhub-search"><Ic d='<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>' /><input value={connQ} onChange={(e) => setConnQ(e.target.value)} placeholder="Search planned integrations…" /></div>
            <div className="catchips">{CATS.map((c) => <button type="button" key={c} className={`catchip${connCat === c ? " on" : ""}`} aria-pressed={connCat === c} onClick={() => setConnCat(c)}>{c}</button>)}</div>
            <div className="conngrid">
              {/* Roadmap = what is NOT built. This used to exclude exactly two
                  connectors by hardcoded display name, so Resend, Slack,
                  HubSpot, Mailchimp and Webhooks — all shipped, all with a
                  working card one tab away in Live — rendered under a "Planned"
                  badge. Derive it from the Live list instead: a connector that
                  ships now leaves the roadmap on its own. */}
              {CONNECTORS.filter((x) => !x.liveKey || !liveConnectorKeys.has(x.liveKey)).filter((x) => {
                const okCat = connCat === "All" || x.cat === connCat;
                const okQ = !connQ || x.n.toLowerCase().includes(connQ.toLowerCase());
                return okCat && okQ;
              }).map((x) => (
                <div className="ccard" key={x.n} style={{ opacity: 0.72 }}>
                  <div className="ct"><BrandBadge className="clogo" name={x.n} initials={x.l} color={x.c} /><div><div className="cnm">{x.n}</div><div className="ccat">{x.cat}</div></div></div>
                  <div className="cdsc">{x.d || DCAT[x.cat] || ""}</div>
                  <div className="cfoot"><span className="badge">Planned</span><span className="grow" /><span style={{ fontSize: 11, color: "var(--muted)" }}>{x.auth || "oauth"}</span></div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {!connectors.configured && (
              <div className="cnote"><Ic d='<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>' /><div>You’re previewing without a connected workspace, so connectors read as <b>not connected</b> and changes won’t persist. These connectors are real — connect a workspace to store credentials for real.</div></div>
            )}
            {!workspaceIndustry ? (
              <div className="cnote" style={{ marginBottom: 14 }}>
                <Ic d='<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>' />
                {/* Pointed at "General" — a section name that hasn't existed in
                    the rail since it became "Organization & brand". Send people
                    there instead of naming a label they can't find. */}
                <div>
                  Set your <b>industry</b> to get connector recommendations tailored to your business.{" "}
                  <button type="button" className="btn sm" style={{ marginLeft: 4 }} onClick={() => navTo("general", "Organization")}>Set industry</button>
                </div>
              </div>
            ) : recommendedConnectors.length > 0 ? (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 9, margin: "2px 2px 12px" }}>
                  <span style={{ fontFamily: "var(--serif)", fontSize: 14.5, fontWeight: 500, color: "var(--text)" }}>Recommended for your business</span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--accent-contrast)", background: "var(--accent-soft)", border: "1px solid var(--accent-border)", borderRadius: 6, padding: "1px 8px" }}>{workspaceIndustry}</span>
                </div>
                <div className="conngrid">
                  {recommendedConnectors.map((v) => <ConnectorCard key={`rec-${v.key}`} view={v} onOpen={() => openConnector(v.key)} />)}
                </div>
              </div>
            ) : null}
            {recommendedConnectors.length > 0 && (
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)", margin: "2px 2px 10px" }}>All connectors</div>
            )}
            <div className="conngrid">
              {emailConnection && <ResendCard view={emailConnection} liveSendEnabled={liveSendEnabled} onOpen={() => openConnector("resend")} />}
              {connectors.connectors.map((v) => <ConnectorCard key={v.key} view={v} onOpen={() => openConnector(v.key)} />)}
            </div>
          </>
        )}
      </>
    ),
    // The "Roster" sub-tab lived here: a scrolling, read-only list of 44 vendor
    // model names with a per-model popup, in a section whose own copy says "Arc
    // picks the best one for each job — you don't choose one every time". It
    // offered no control, and it duplicated src/domain/higgsfield-models.ts as a
    // hand-copied literal in the view. Deleted, along with its detail popup.
    media: (
      <>
        <Head t="Image & video" d="Arc picks the best engine for each job automatically, and everything it makes is a draft that waits for your approval. The setting below only chooses the fallback." />
        <MediaDefaultsPanel settings={settings} />
      </>
    ),
    account: (
      <>
        <Head t="Account" d="Your name, photo, password, and the session you're signed in on." />
        <AccountPanel email={email} displayName={viewerName} avatarUrl={avatarUrl} session={session} />
      </>
    ),
    usage: (
      <>
        <Head t="Usage & billing" d="What Arc has consumed this period — tokens, runs, and estimated cost, broken down by day and by model." />
        {subBar}
        {activeSub === "Connectors" ? (
          <ConnectorSpendPanel key={connectorSpend ? `cap-${connectorSpend.capDollars}` : "cap-none"} spend={connectorSpend} />
        ) : activeSub === "By day" ? (
          <UsageByDay usage={usageView} />
        ) : activeSub === "By model" ? (
          <UsageByModel usage={usageView} />
        ) : activeSub === "Recent" ? (
          <UsageRecent usage={usageView} />
        ) : usageUnavailable ? (
          <>
            {/* The read failed. Falling through to EMPTY_USAGE printed "0 tokens
                · $0.00 · 0% of your $80 plan cap" — three confident figures
                about money, none of them read from anything, and "$80" matches
                no plan tier we sell. An operator either relaxes about a cap they
                are near or files a bug because their spend vanished. */}
            <div className="panel">
              <div className="panel-h"><h2>This month</h2><Pill kind="warn">Unavailable</Pill></div>
              <div className="panel-b" style={{ padding: 16 }}>
                <p className="cxm-hint" style={{ margin: 0 }}>
                  Your usage couldn&apos;t be read just now, so no figures are shown — a zero here would be a
                  statement about your spend that we can&apos;t stand behind. Nothing has changed, and nothing
                  has stopped. Reload to try again.
                </p>
              </div>
            </div>
            <BillingPlanControl billing={billing} />
          </>
        ) : (
          <>
            <div className="panel">
              <div className="panel-h"><h2>This month</h2><span className="tg ok" style={{ marginLeft: "auto" }}>{usageView.isDemo ? DEMO_DATA_LABEL : "Live"}</span></div>
              <div className="panel-b" style={{ padding: 16 }}>
                {/* The shared strip. This was `repeat(3, 1fr)` — the equal
                    dashboard row DESIGN.md bans — and one of seven hand-rolled
                    KPI grids BSR-658 set out to retire; it lived in a per-route
                    stylesheet the guard for that never scanned. */}
                <KpiStrip
                  items={[
                    { label: "Tokens", value: usageView.tokensLabel },
                    { label: "Agent runs", value: usageView.runsLabel },
                    { label: "Est. cost", value: usageView.costLabel },
                  ]}
                />
                <div className="ubar"><i style={{ width: `${Math.min(usageView.pctOfCap, 100)}%`, ...(usageView.isNearCap ? { background: "var(--warn)" } : {}) }} /></div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7 }}>{usageView.pctOfCap}% of your {usageView.capLabel}{usageView.planLabel ? ` ${usageView.planLabel}` : ""} plan cap · {usageView.rangeLabel}</div>
              </div>
              <div className="panel-f"><Ic d={CHECK} />Usage is scoped to this workspace.</div>
            </div>
            <BillingPlanControl billing={billing} />
            {/* A gold primary button reading "Open usage & billing" used to sit
                here, on the Usage & billing page, calling navTo("usage") — the
                section it was already in. It could not do anything. */}
          </>
        )}
      </>
    ),
  };

  const crumbTrail: Crumb[] = [{ label: "Settings", onClick: () => navTo("overview") }];
  if (SUBTABS[cur] && activeSub) {
    crumbTrail.push({ label: SECTION_LABEL[cur], onClick: () => navTo(cur, SUBTABS[cur][0]) }, { label: activeSub });
  } else {
    crumbTrail.push({ label: SECTION_LABEL[cur] ?? "Overview" });
  }

  return (
    <PersonaOptionsContext.Provider value={personaOptions}>
    <div className="arc-settings">
      <nav className="setnav">
        <div className="setsearch">
          <Ic d='<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>' />
          <input
            value={navQ}
            onChange={(e) => setNavQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && results[0]) selectResult(results[0]); else if (e.key === "Escape") setNavQ(""); }}
            aria-label="Search settings"
            placeholder="Search settings…"
          />
        </div>
        {q ? (
          <div className="searchres">
            {results.length ? (
              results.map((d, i) => (
                <button type="button" key={`${d.label}-${d.sub ?? ""}-${i}`} className={`sr-item${i === 0 ? " on" : ""}`} onClick={() => selectResult(d)}>
                  <span className="sr-label">{d.label}{d.sub ? <> <span className="sr-sep">›</span> <b>{d.sub}</b></> : null}</span>
                </button>
              ))
            ) : (
              <div className="sr-empty">No settings match “{navQ.trim()}”.</div>
            )}
          </div>
        ) : (
          navGroups.map((grp) => (
            <div key={grp.g}>
              <div className="setgrp">{grp.g}</div>
              {grp.items.map((it) => (
                <button type="button" key={it[0]} className={`setitem${it[0] === cur ? " on" : ""}`} aria-current={it[0] === cur ? "page" : undefined} onClick={() => navTo(it[0])}>
                  <Ic d={ICON[it[0]]} /><span>{it[1]}</span>{dots[it[0]] && <span className="sd" style={{ background: dots[it[0]] }} />}
                </button>
              ))}
            </div>
          ))
        )}
      </nav>
      <div className="setmain">
        <div className="setmain-in">
          <Crumbs trail={crumbTrail} />
          {sections[cur]}
        </div>
      </div>
      {selectedConnector && (
        <ConnectorModal view={selectedConnector} configured={connectors.configured} hubspotOAuthConfigured={hubspotOAuthConfigured} googleOAuthConfigured={googleOAuthConfigured} onClose={closeConnector} />
      )}
      {resendModalOpen && emailConnection && <ResendModal view={emailConnection} liveSendEnabled={liveSendEnabled} onClose={closeConnector} />}
    </div>
    </PersonaOptionsContext.Provider>
  );
}

// ---- Plan (Usage & billing, wired) ----
// Owner/admin plan picker wired to updateOrgPlanAction; offline resolves
// optimistically (persisted:false). Mirrors the TeamMembers select pattern.
function BillingPlanControl({ billing }: { billing: SettingsBillingView | null }) {
  const [tier, setTier] = useState<string>(billing?.tier ?? "free");
  const [checkoutTier, setCheckoutTier] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  if (!billing) return null;
  const current = billing.options.find((o) => o.tier === tier) ?? billing.options[0];
  const optionFor = (t: string) => billing.options.find((o) => o.tier === t);

  // Manual override (no Stripe): set the tier directly via org_plans.
  async function change(next: string) {
    const prev = tier;
    setTier(next);
    setBusy(true);
    setStatus(null);
    const res = await updateOrgPlanAction({ tier: next });
    setBusy(false);
    if (!res.ok) {
      setTier(prev);
      setStatus({ tone: "err", text: res.error });
    } else if (res.persisted) {
      setStatus({ tone: "ok", text: `Plan updated to ${optionFor(next)?.label ?? next}.` });
    }
  }

  // Stripe path: redirect to hosted Checkout / Customer Portal.
  async function checkout(next: string) {
    if (!next) return;
    setBusy(true);
    setStatus(null);
    const res = await createCheckoutSessionAction({ tier: next });
    if (res.ok) {
      window.location.href = res.url;
      return;
    }
    setBusy(false);
    setStatus({ tone: "err", text: res.error });
  }
  async function portal() {
    setBusy(true);
    setStatus(null);
    const res = await createBillingPortalAction();
    if (res.ok) {
      window.location.href = res.url;
      return;
    }
    setBusy(false);
    setStatus({ tone: "err", text: res.error });
  }

  const statusSuffix = billing.subscriptionStatus ? ` · ${billing.subscriptionStatus}` : "";

  // The cap this workspace ACTUALLY spends against, not the tier's list price.
  // `billing.capLabel` is resolved from org_plans and honours a negotiated
  // `monthly_cap_cents` override; the `options` catalog never can. Reading the
  // catalog here printed "$2/mo monthly cap" directly beneath a usage meter
  // reading "6% of your $250 Free plan cap" — two answers about the same money,
  // one screen apart, and the wrong one is the reassuring one. The catalog cap
  // is right only while the picker is showing some OTHER tier the operator is
  // considering, which has no resolved cap of its own yet.
  const showingServerTier = tier === billing.tier;
  const effectiveCapLabel = showingServerTier ? billing.capLabel : current.capLabel;
  const capIsNegotiated = showingServerTier && billing.capLabel !== current.capLabel;

  return (
    <Panel title="Plan" foot="Your monthly budget applies to paid lookups and creative.">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 600 }}>{current.label}{statusSuffix}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {effectiveCapLabel} monthly cap
            {capIsNegotiated ? <> · custom cap for this workspace (the {current.label} default is {current.capLabel})</> : null}
          </div>
        </div>
        {billing.stripeConfigured ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="sel" value={checkoutTier} disabled={!billing.canManage || busy} onChange={(e) => setCheckoutTier(e.target.value)}>
              <option value="">Choose a plan…</option>
              {/* "Starter — $25/mo" reads as the PRICE. It is the monthly spend
                  cap; the tier itself sells for something else entirely. Name
                  the number. */}
              {billing.purchasableTiers.map((t) => (
                <option key={t} value={t}>{optionFor(t)?.label} — {optionFor(t)?.capLabel} cap</option>
              ))}
            </select>
            <button className="btn gold" disabled={!billing.canManage || busy || !checkoutTier} onClick={() => checkout(checkoutTier)}>Subscribe / Upgrade</button>
            <button className="btn" disabled={!billing.canManage || busy} onClick={portal}>Manage billing</button>
          </div>
        ) : (
          <select
            className="sel"
            style={{ minWidth: 170 }}
            value={tier}
            disabled={!billing.canManage || busy}
            onChange={(e) => change(e.target.value)}
          >
            {billing.options.map((o) => (
              <option key={o.tier} value={o.tier}>{o.label} — {o.capLabel} cap</option>
            ))}
          </select>
        )}
      </div>
      {!billing.canManage && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Only owners and admins can change the plan.</div>
      )}
      {status && (
        <div style={{ fontSize: 12.5, padding: "8px 2px 0", color: status.tone === "ok" ? "var(--ok-text)" : "var(--red-text)" }}>{status.text}</div>
      )}
    </Panel>
  );
}

// ---- Team members (wired) ----
// Real member list from listWorkspaceTeamAccess (demo fallback offline). Clicking a
// member opens a popup to change their role or remove them (changeMemberRole /
// removeMember); offline they resolve optimistically (persisted:false).
function TeamMembers({ team }: { team: SettingsTeamView }) {
  const [members, setMembers] = useState<SettingsTeamMember[]>(team.members);
  const [selId, setSelId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const wsId = team.workspaceId ?? "";
  const initial = (e: string) => (e.trim()[0] || "?").toUpperCase();
  const selected = selId ? members.find((m) => m.id === selId) ?? null : null;

  return (
    <>
      <Panel title={<>Members <span className="ph-d" style={{ marginLeft: 6 }}>{members.length}</span></>}>
        {/* "No members yet" and "we could not read your team" are opposite
            statements, and the second one used to render as the first — which
            invites an operator to re-invite people who are already there
            (BSR-578). */}
        {team.failed ? (
          <div className="me" style={{ padding: "6px 2px", color: "var(--red-text)" }}>
            Your team couldn&apos;t be loaded just now, so this list is incomplete rather than empty.
            Nothing has changed. Reload to try again.
          </div>
        ) : members.length === 0 ? (
          <div className="me" style={{ padding: "6px 2px", color: "var(--muted)" }}>No members yet.</div>
        ) : (
          members.map((m) => (
            <button type="button" className="mem mem-btn" key={m.id} onClick={() => setSelId(m.id)}>
              <span className="ma">{initial(m.email)}</span>
              <div className="mi"><div className="mn">{m.email}</div><div className="me">{m.roleLabel}{m.pending ? " · invited" : ""}</div></div>
              {m.isOwner && <Pill kind="off">Owner</Pill>}
              <span className="mem-go">Manage →</span>
            </button>
          ))
        )}
        {status && <div style={{ fontSize: 12.5, padding: "8px 2px 0", color: status.tone === "ok" ? "var(--ok-text)" : "var(--red-text)" }}>{status.text}</div>}
      </Panel>
      {selected && (
        <MemberModal
          member={selected}
          workspaceId={wsId}
          onClose={() => setSelId(null)}
          onRoleChanged={(label) => setMembers((ms) => ms.map((x) => (x.id === selected.id ? { ...x, roleLabel: label, role: label.toLowerCase() } : x)))}
          onRemoved={() => { setMembers((ms) => ms.filter((x) => x.id !== selected.id)); setStatus({ tone: "ok", text: `Removed ${selected.email}.` }); setSelId(null); }}
        />
      )}
    </>
  );
}

function MemberModal({ member, workspaceId, onClose, onRoleChanged, onRemoved }: {
  member: SettingsTeamMember;
  workspaceId: string;
  onClose: () => void;
  onRoleChanged: (label: string) => void;
  onRemoved: () => void;
}) {
  const [role, setRole] = useState(member.roleLabel);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);

  async function saveRole() {
    if (role === member.roleLabel) return;
    setPending(true); setStatus(null);
    const res = await changeMemberRole({ workspaceId, membershipId: member.id, role });
    setPending(false);
    if (!res.ok) { setStatus({ tone: "err", text: res.error }); return; }
    onRoleChanged(role);
    setStatus({ tone: "ok", text: res.persisted ? `Role updated to ${role}.` : `Role set to ${role} — connect your workspace to save it.` });
  }

  async function remove() {
    setPending(true); setStatus(null);
    const res = await removeMember({ workspaceId, membershipId: member.id });
    setPending(false);
    if (!res.ok) { setStatus({ tone: "err", text: res.error }); return; }
    onRemoved();
  }

  return (
    <Modal open onClose={onClose} width={440} title="Team member" description={member.email}>
      <div className="cxm">
        {member.isOwner && <div className="cxm-note">This member is the workspace owner — their role can’t be changed and they can’t be removed.</div>}
        <div className="cxm-sec">
          <div className="cxm-label">Role</div>
          <p className="cxm-hint">Controls what they can do across the workspace — approve, draft, or view.</p>
          <div className="cxm-field">
            <select className="sel" value={role} disabled={member.isOwner || pending} onChange={(e) => setRole(e.target.value)}>
              {/* Owner is not assignable, so it is not in ROLE_OPTIONS. The
                  owner's own row still has to render its current role rather
                  than an empty select, so add it back for that row only. */}
              {!ROLE_OPTIONS.includes(role) ? <option key={role}>{role}</option> : null}
              {ROLE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
            <button className="btn gold" disabled={member.isOwner || pending || role === member.roleLabel} onClick={saveRole}>{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
        {!member.isOwner && (
          <div className="cxm-sec">
            <div className="cxm-label">Remove access</div>
            <p className="cxm-hint">{member.email} loses access to this workspace immediately. You can invite them again later.</p>
            <button className="btn danger" disabled={pending} onClick={remove}>Remove from workspace</button>
          </div>
        )}
        {status ? <div className="cxm-statusline"><Status status={status} /></div> : null}
      </div>
    </Modal>
  );
}

// ---- Team invites (wired) ----
// Real invite creation via createInvite; the pending list is seeded from real
// workspace invites. The invite form lives in a popup (matching New workspace).
// Offline (persisted:false) items resolve optimistically.
type PendingInvite = { id: string; email: string; role: string; note: string };

function TeamInvites({ workspaceId, seedInvites }: { workspaceId: string | null; seedInvites: SettingsTeamInvite[] }) {
  const [invites, setInvites] = useState<PendingInvite[]>(seedInvites);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const wsId = workspaceId ?? "";

  async function revoke(inv: PendingInvite) {
    const prev = invites;
    setInvites((list) => list.filter((i) => i.id !== inv.id));
    const res = await cancelInvite({ workspaceId: wsId, inviteId: inv.id });
    if (!res.ok) {
      setInvites(prev);
      setStatus({ tone: "err", text: res.error });
    }
  }

  return (
    <>
      <Panel title={<>Pending invites <span className="ph-d" style={{ marginLeft: 6 }}>{invites.length}</span></>}>
        {invites.length === 0 ? (
          <div className="me" style={{ padding: "6px 2px", color: "var(--muted)" }}>No pending invites — invite a teammate below.</div>
        ) : (
          invites.map((inv) => (
            <div className="mem" key={inv.id}>
              <span className="ma" style={{ color: "var(--muted)", background: "var(--inset)", borderColor: "var(--line-2)" }}>?</span>
              <div className="mi"><div className="mn">{inv.email}</div><div className="me">{inv.note}</div></div>
              <Pill kind="warn">Pending</Pill>
              <button className="btn sm danger" onClick={() => revoke(inv)}>Revoke</button>
            </div>
          ))
        )}
      </Panel>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn gold" onClick={() => setOpen(true)}><Ic d='<path d="M3 12l18-8-8 18-2-7z"/>' />Invite a teammate</button>
        {status && <span style={{ fontSize: 12.5, color: status.tone === "ok" ? "var(--ok-text)" : "var(--red-text)" }}>{status.text}</span>}
      </div>
      {open && (
        <InviteModal
          onClose={() => setOpen(false)}
          onCreated={(inv, message) => { setInvites((prev) => [inv, ...prev]); setStatus({ tone: "ok", text: message }); }}
        />
      )}
    </>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (inv: PendingInvite, message: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Marketer");
  const [expires, setExpires] = useState("14 days");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);

  async function send() {
    const trimmed = email.trim();
    if (!trimmed) { setStatus({ tone: "err", text: "Enter an email address." }); return; }
    const days = parseInt(expires, 10) || 14;
    setPending(true); setStatus(null);
    const res = await createInvite({ email: trimmed, role, expiresInDays: days });
    setPending(false);
    if (!res.ok) { setStatus({ tone: "err", text: res.error }); return; }
    onCreated(
      { id: `local-${crypto.randomUUID()}`, email: trimmed, role, note: `${role} · just now` },
      res.persisted ? res.message ?? "Invite sent." : "Invite added — connect your workspace to send it.",
    );
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title="Invite a teammate"
      description="They’ll get a branded invite email with a single-use code."
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn gold" onClick={send} disabled={pending}>{pending ? "Sending…" : "Send invite"}</button>
        </>
      }
    >
      <div className="cxm">
        <div className="cxm-sec">
          <div className="cxm-label">Email</div>
          <input className="inp" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        </div>
        <div className="cxm-sec">
          <div className="cxm-label">Role</div>
          <p className="cxm-hint">Roles map to what they can do — approve, draft, view.</p>
          <select className="sel" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div className="cxm-sec">
          <div className="cxm-label">Expires</div>
          <select className="sel" value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option>7 days</option><option>14 days</option><option>30 days</option><option>60 days</option>
          </select>
        </div>
        {status ? <div className="cxm-statusline"><Status status={status} /></div> : null}
      </div>
    </Modal>
  );
}

// ---- Workspaces (wired) ----
// Real memberships from listWorkspacesForUser (demo list offline). Switch
// repoints the active-workspace cookie and reloads so the whole app re-tailors;
// create goes through createWorkspace; Customize goes through
// updateWorkspaceIdentityAction. Offline all three resolve optimistically.
//
// Customize works on ANY row you own or administer, not just the active one —
// the identity guard is keyed on the row's workspaceId, so there is no need to
// switch into a workspace just to rename it.
type WorkspaceItem = SettingsWorkspace;

function WorkspacesSection({ view }: { view: SettingsWorkspacesView }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>(view.workspaces);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function saveIdentity(value: WorkspaceIdentityValue): Promise<{ ok: boolean; error?: string }> {
    const res = await updateWorkspaceIdentityAction(value);
    if (!res.ok) return { ok: false, error: res.error };
    setWorkspaces((prev) =>
      prev.map((w) =>
        w.id === value.workspaceId
          ? {
              ...w,
              name: value.name,
              orgName: value.organizationName || w.orgName,
              storedSubtitle: value.subtitle,
              storedShortLabel: value.shortLabel,
              subtitle: value.subtitle || value.organizationName || w.orgName,
              accentKey: (value.accentKey as WorkspaceItem["accentKey"]) ?? null,
              accentColor: value.accentKey ? WORKSPACE_ACCENT_SWATCHES[value.accentKey as WorkspaceAccentKey] : null,
            }
          : w,
      ),
    );
    setStatus({
      tone: "ok",
      text: res.persisted ? `Saved ${value.name}.` : "Preview only here — connect your account to save for real.",
    });
    // The rail renders this too, and it is server-rendered.
    if (res.persisted) window.location.assign("/settings?s=workspaces");
    return { ok: true };
  }

  async function switchTo(w: WorkspaceItem) {
    if (w.active) return;
    setBusy(w.id);
    setStatus(null);
    const res = await switchWorkspace({ workspaceId: w.id });
    setBusy(null);
    if (!res.ok) {
      setStatus({ tone: "err", text: res.error });
      return;
    }
    setWorkspaces((prev) => prev.map((x) => ({ ...x, active: x.id === w.id })));
    if (res.persisted) {
      // The active workspace drives the whole shell — reload so it re-tailors.
      setStatus({ tone: "ok", text: `Switched to ${w.name}. Reloading…` });
      window.location.assign("/settings?s=workspaces");
    } else {
      setStatus({ tone: "ok", text: "Switch is a preview here — connect your account to switch for real." });
    }
  }

  async function create(value: NewWorkspaceValue): Promise<{ ok: boolean; error?: string }> {
    const tempId = `local-${crypto.randomUUID()}`;
    setWorkspaces((prev) => [
      {
        id: tempId,
        name: value.workspaceName,
        meta: "Owner · New workspace",
        active: false,
        subtitle: value.organizationName || value.workspaceName,
        shortLabel: derivedShortLabel(value.organizationName || value.workspaceName),
        storedSubtitle: null,
        storedShortLabel: null,
        accentColor: null,
        accentKey: null,
        logoUrl: null,
        orgName: value.organizationName || value.workspaceName,
        canManage: true,
      },
      ...prev,
    ]);
    setStatus(null);

    const res = await createWorkspace(value);
    if (!res.ok) {
      setWorkspaces((prev) => prev.filter((w) => w.id !== tempId));
      setStatus({ tone: "err", text: res.error });
      return { ok: false, error: res.error };
    }
    setStatus({
      tone: "ok",
      text: res.persisted
        ? `${res.message ?? "Workspace created."} Reloading…`
        : "Workspace added — connect your account to save it.",
    });
    if (res.persisted) {
      // createWorkspace pins the new workspace as active (it repoints the
      // active-workspace cookie), so the optimistic row is both stale — it still
      // says "Switch" next to the workspace you are already in — and carries a
      // local placeholder id that no real switch could target. Reload for the
      // server's list, exactly as switchTo does.
      setWorkspaces((prev) => prev.map((w) => ({ ...w, active: w.id === tempId })));
      window.location.assign("/settings?s=workspaces");
    }
    return { ok: true };
  }

  return (
    <>
      <Panel
        title={<>Your workspaces <span className="ph-d" style={{ marginLeft: 6 }}>{workspaces.length}</span></>}
        foot={view.isDemo ? "Demo workspaces are shown until you connect an account." : "Switching updates the whole app to the selected workspace."}
      >
        {view.failed ? (
          <div className="me" style={{ padding: "6px 2px", color: "var(--red-text)" }}>
            Your workspaces couldn&apos;t be listed just now. This isn&apos;t the full set — reload to try again.
          </div>
        ) : workspaces.length === 0 ? (
          <div className="me" style={{ padding: "6px 2px", color: "var(--muted)" }}>No workspaces yet.</div>
        ) : (
          workspaces.map((w) => (
            <div
              className="mem"
              key={w.id}
              style={w.accentColor ? ({ "--ws-accent": w.accentColor } as React.CSSProperties) : undefined}
            >
              <span className={`ma${w.logoUrl ? " has-image" : ""}`} style={!w.logoUrl && w.accentColor ? { color: w.accentColor, background: `color-mix(in srgb, ${w.accentColor} 16%, transparent)`, borderColor: `color-mix(in srgb, ${w.accentColor} 32%, transparent)` } : undefined}>
                {w.logoUrl ? (
                  <AppImage src={w.logoUrl} alt="" />
                ) : (
                  // The shared monogram rule, so this row matches the rail.
                  workspaceInitials(w.name)
                )}
              </span>
              <div className="mi"><div className="mn">{w.name}</div><div className="me">{w.subtitle} · {w.meta}</div></div>
              {w.canManage && <button className="btn sm" onClick={() => setEditing(w)}>Customize</button>}
              {w.active ? <Pill kind="ok">Active</Pill> : <button className="btn sm" disabled={busy === w.id} onClick={() => switchTo(w)}>{busy === w.id ? "Switching…" : "Switch"}</button>}
            </div>
          ))
        )}
      </Panel>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button className="btn" onClick={() => setOpen(true)}><Ic d='<path d="M12 5v14M5 12h14"/>' />New workspace</button>
        {status && (
          <span style={{ fontSize: 12.5, color: status.tone === "ok" ? "var(--ok-text)" : "var(--red-text)" }}>{status.text}</span>
        )}
      </div>
      <NewWorkspaceModal key={open ? "open" : "closed"} open={open} onClose={() => setOpen(false)} onSubmit={create} />
      <WorkspaceIdentityModal
        key={editing ? `identity-${editing.id}` : "identity-closed"}
        open={Boolean(editing)}
        workspace={editing}
        onClose={() => setEditing(null)}
        onSubmit={saveIdentity}
      />
    </>
  );
}

// ---- General (wired) ----
// Workspace name renames the org + workspace identity (owner/admin gated);
// account type, industry, and support email persist to app_settings. Offline the
// action returns persisted:false and Status says so honestly.
// Sender identity for outbound marketing email. The postal address is legally
// required (CAN-SPAM and equivalents) and has no safe default, so the send path
// refuses while it is blank — this panel is where that gets unblocked, and the
// copy says so rather than leaving an operator to discover it from a failure.
function EmailIdentityPanel({ settings }: { settings: AppSettings }) {
  const [senderName, setSenderName] = useState(settings.emailSenderName ?? "");
  const [postalAddress, setPostalAddress] = useState(settings.emailPostalAddress ?? "");
  const [reminder, setReminder] = useState(settings.emailPermissionReminder ?? "");
  const [status, setStatus] = useState<SaveStatus>(null);
  const [pending, setPending] = useState(false);

  const missingAddress = !postalAddress.trim();

  async function save() {
    setPending(true);
    setStatus(null);
    const res = await saveEmailIdentitySettings({
      senderName: senderName.trim(),
      postalAddress: postalAddress.trim(),
      permissionReminder: reminder.trim(),
    });
    setPending(false);
    setStatus(toStatus(res, "Saved."));
  }

  return (
    <Panel
      title="Email sender identity"
      foot="Stamped into the footer of every marketing email Arc sends, along with a working unsubscribe link."
    >
      {missingAddress && (
        <div className="cerr" style={{ margin: "0 0 12px" }}>
          Outbound email is blocked until a postal address is set. Commercial email legally requires one, so Arc refuses to send without it.
        </div>
      )}
      <Row label="Sender name" desc="Shown in the email footer. Defaults to your organization name.">
        <input className="inp" value={senderName} placeholder="Your business name" onChange={(e) => setSenderName(e.target.value)} maxLength={120} />
      </Row>
      <Row label="Postal address" desc="Required by law on commercial email. A PO box or registered office is fine.">
        <textarea className="inp" rows={3} value={postalAddress} placeholder={"123 Example St\nChicago, IL 60601"} onChange={(e) => setPostalAddress(e.target.value)} maxLength={400} />
      </Row>
      <Row label="Permission reminder" desc="Optional line telling recipients why they're hearing from you. Reduces spam complaints.">
        <input className="inp" value={reminder} placeholder="You're receiving this because you requested a quote." onChange={(e) => setReminder(e.target.value)} maxLength={300} />
      </Row>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0 4px" }}>
        <button className="btn gold" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
        <Status status={status} />
      </div>
    </Panel>
  );
}

/**
 * The suppression register — who this workspace must never email, and why.
 *
 * This screen is the answer to "did the unsubscribe actually work?", which until
 * now had no answer anywhere in the product: the opt-out column was read by three
 * files, none of them a page. It also carries the manual add, because an opt-out
 * given over the phone is legally the same as one given by clicking a link.
 *
 * Filtering is client-side over a capped server load — the cap is stated rather
 * than silently truncating, so "12 suppressed" can't stand in for four thousand.
 */
function SuppressionPanel({ view }: { view: SuppressionView | null }) {
  const [query, setQuery] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<SaveStatus>(null);
  const [pending, setPending] = useState(false);

  const entries = view?.entries ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle ? entries.filter((e) => e.email.includes(needle)) : entries;
  const capped = Boolean(view && view.total > entries.length);

  async function add() {
    setPending(true);
    setStatus(null);
    const res = await suppressEmailAddress({ address, note });
    setPending(false);
    setStatus(toStatus(res, "Suppressed."));
    if (res.ok) {
      setAddress("");
      setNote("");
    }
  }

  return (
    <Panel
      title="Suppression list"
      foot="Checked on every send, native or exported. Nothing on this list can be emailed again."
    >
      {!view ? (
        <p className="sld" style={{ margin: 0 }}>
          Connect your workspace to see who has opted out.
        </p>
      ) : view.failed ? (
        <div className="cerr" style={{ margin: 0 }}>
          Could not read the suppression list, so this isn&apos;t a clean bill of health — it&apos;s an unknown.
          Sending stays gated on the live check either way. {view.failed}
        </div>
      ) : (
        <>
          <Row
            label="Add an address"
            desc="For an opt-out someone gave you by phone, by reply, or in person. This can't be undone from here."
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <input
                className="inp"
                style={{ flex: "1 1 220px" }}
                value={address}
                placeholder="name@example.com"
                onChange={(e) => setAddress(e.target.value)}
                maxLength={320}
              />
              <input
                className="inp"
                style={{ flex: "1 1 200px" }}
                value={note}
                placeholder="Why? (optional)"
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
              />
              <button className="btn" onClick={add} disabled={pending || !address.trim()}>
                {pending ? "Adding…" : "Suppress"}
              </button>
            </div>
          </Row>

          <Row
            label={`${view.total} suppressed`}
            desc={capped ? `Showing the ${entries.length} most recent.` : undefined}
          >
            <input
              className="inp"
              value={query}
              placeholder="Search addresses"
              onChange={(e) => setQuery(e.target.value)}
            />
          </Row>

          <div style={{ padding: "4px 0 0" }}>
            <Status status={status} />
          </div>

          {shown.length === 0 ? (
            <p className="sld" style={{ margin: "10px 0 0" }}>
              {entries.length === 0
                ? "Nobody has opted out yet."
                : `No suppressed address matches "${query.trim()}".`}
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
              {shown.map((entry) => (
                // Grid rather than flex-wrap: a long reason used to push the
                // badge and date onto their own line, so each row aligned
                // differently from the one above it.
                <li
                  key={entry.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "baseline",
                    columnGap: 16,
                    padding: "9px 0",
                    borderTop: "1px solid var(--hairline)",
                  }}
                >
                  <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, wordBreak: "break-all" }}>{entry.email}</span>
                    <span className="sld">
                      {entry.reasonDescription}
                      {entry.detail ? ` ${entry.detail}` : ""}
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
                    <span className="tg">{entry.reasonLabel}</span>
                    <span className="sld">{formatSuppressedAt(entry.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

/** Date only — the hour someone unsubscribed is noise on a compliance register. */
function formatSuppressedAt(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function GeneralPanel({ brandName, workspaceName, settings, workspaceLogoUrl }: { brandName: string; workspaceName: string; settings: AppSettings; workspaceLogoUrl: string | null }) {
  const [name, setName] = useState(workspaceName);
  const [orgName, setOrgName] = useState(brandName);
  const [profile, setProfile] = useState<AppSettings["workspaceProfile"]>(settings.workspaceProfile);
  // Seeded from the RAW stored value, not the canonicalised one. Canonicalising
  // turned "" into "general", so an untouched workspace opened this panel and
  // read "General / other" — a decision it had never made, and one Connections
  // was simultaneously asking it to make.
  const [industry, setIndustry] = useState(settings.industry?.trim() ? canonicalIndustryKey(settings.industry) : "");
  const [email, setEmail] = useState(settings.supportEmail ?? "");
  const [status, setStatus] = useState<SaveStatus>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setStatus(null);
    const res = await saveGeneralSettings({ workspaceName: name.trim(), organizationName: orgName.trim(), workspaceProfile: profile, industry, supportEmail: email.trim() });
    setPending(false);
    setStatus(toStatus(res, "Saved."));
  }

  return (
      <Panel title="Identity" foot="Changes apply across Arc and to generated creative.">
        <Row label="Workspace name" desc="The bold line in the sidebar. Its subtitle, label, and color live under Workspaces → Customize."><input className="inp" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Row>
        <Row label="Organization" desc="Your brand name — used in Arc’s outbound from-name and on generated creative. Separate from the workspace name, so a workspace can be labelled for what it does."><input className="inp" value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={80} /></Row>
        <Row label="Brand logo" desc="Stamped on generated creative and used as the default sidebar logo. A workspace-specific override under Workspaces can replace it in the sidebar. Square PNG or SVG works best.">
          <ImageUploadField
            currentUrl={workspaceLogoUrl}
            fallback={pinit(orgName || brandName)}
            uploadAction={saveWorkspaceLogoAction}
            removeAction={removeWorkspaceLogoAction}
          />
        </Row>
        <Row label="Account type" desc="How Arc frames personas, detectors, and templates."><Seg opts={["Individual", "Company", "Agency"]} value={PROFILE_LABEL[profile]} onChange={(v) => setProfile(v.toLowerCase() as AppSettings["workspaceProfile"])} /></Row>
        <Row label="Industry" desc="Tailors starter audiences, workspace language, and which connectors Arc recommends. Existing records stay unchanged.">
          <select className="sel" value={industry} onChange={(e) => setIndustry(e.target.value ? canonicalIndustryKey(e.target.value) : "")}>
            <option value="">Not set — choose your industry</option>
            {INDUSTRY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Row>
        <Row label="Support email" desc="Used as reply-to on transactional email."><input className="inp" value={email} placeholder="support@yourcompany.com" onChange={(e) => setEmail(e.target.value)} /></Row>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0 4px" }}>
          <button className="btn gold" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
          <Status status={status} />
        </div>
      </Panel>
  );
}

// ---- Appearance (wired) ----
// Instant-save: each change stamps the same data-* attributes the root layout
// sets on load (so the whole app re-skins live) and persists to app_settings.
function AppearancePanel({ settings }: { settings: AppSettings }) {
  const [accent, setAccent] = useState<AppSettings["appearanceAccent"]>(settings.appearanceAccent);
  const [density, setDensity] = useState<AppSettings["appearanceDensity"]>(settings.appearanceDensity);
  const [motion, setMotion] = useState<AppSettings["appearanceMotion"]>(settings.appearanceMotion);
  const [status, setStatus] = useState<SaveStatus>(null);

  // Live re-skin: mirror the current selection onto the same <html> data-*
  // attributes the root layout stamps on load, so the whole app updates at once.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.accent = accent;
    el.dataset.density = density;
    el.dataset.motion = motion;
  }, [accent, density, motion]);

  async function apply(next: Partial<Pick<AppSettings, "appearanceAccent" | "appearanceDensity" | "appearanceMotion">>) {
    const a = next.appearanceAccent ?? accent;
    const d = next.appearanceDensity ?? density;
    const m = next.appearanceMotion ?? motion;
    setAccent(a);
    setDensity(d);
    setMotion(m);
    setStatus(null);
    setStatus(toStatus(await saveAppearanceSettings({ accent: a, density: d, motion: m }), "Saved"));
  }

  return (
      <Panel title="Theme" foot={<>Applies across the app{status ? <> · <Status status={status} /></> : null}</>}>
        <Row label="Accent" desc="Used sparingly — buttons, focus, key numbers.">
          <div className="accsw">{ACCENTS.map(({ key, color }) => <button type="button" key={key} className={`accopt${accent === key ? " on" : ""}`} style={{ background: color }} aria-label={`${key[0].toUpperCase() + key.slice(1)} accent`} aria-pressed={accent === key} title={key[0].toUpperCase() + key.slice(1)} onClick={() => apply({ appearanceAccent: key })} />)}</div>
        </Row>
        <Row label="Density" desc="Comfortable for review, compact for power use.">
          <Seg opts={["Comfortable", "Compact"]} value={DENSITY_LABEL[density]} onChange={(v) => apply({ appearanceDensity: v === "Compact" ? "compact" : "comfortable" })} />
        </Row>
        <Row label="Motion" desc="Reduce if you prefer fewer animations.">
          <Seg opts={["Standard", "Reduced"]} value={MOTION_LABEL[motion]} onChange={(v) => apply({ appearanceMotion: v === "Reduced" ? "reduced" : "standard" })} />
        </Row>
      </Panel>
  );
}

// ---- Agent identity (wired) ----
// assistantName drives getAgentName across the app + Arc’s replies.
function AgentIdentityPanel({ settings }: { settings: AppSettings }) {
  const [name, setName] = useState(settings.assistantName);
  const [saved, setSaved] = useState(settings.assistantName);
  const [status, setStatus] = useState<SaveStatus>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === saved) return;
    setPending(true);
    setStatus(null);
    const res = await saveRunnerDisplayName({ assistantName: trimmed });
    setPending(false);
    if (res.ok) setSaved(trimmed);
    setStatus(toStatus(res, "Saved."));
  }

  return (
    <Panel title="Agent identity" foot="Shown wherever Arc is named.">
      <Row label="Display name" desc="What the agent is called across the app and in Arc’s replies.">
        <span className="pillrow">
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); }} style={{ minWidth: 160 }} maxLength={32} />
          <button className="btn sm gold" onClick={save} disabled={pending || !name.trim() || name.trim() === saved}>{pending ? "Saving…" : "Save"}</button>
          <Status status={status} />
        </span>
      </Row>
    </Panel>
  );
}

// ---- Account (wired) ----
/**
 * Your own profile. Previously three read-only rows plus Sign out, under a
 * heading that promised a "session" it never showed.
 *
 * `full_name` was the sharpest gap: written once at sign-up, then read forever
 * by the sidebar, the greeting, and the "X invited you" line on every invitation
 * this workspace sends — with nothing anywhere in the product to correct it.
 */
export type AccountSession = { lastSignInAt: string | null; createdAt: string | null; provider: string | null };

function AccountPanel({ email, displayName, avatarUrl, session }: {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  session: AccountSession | null;
}) {
  const [name, setName] = useState(displayName);
  const [savedName, setSavedName] = useState(displayName);
  const [nameStatus, setNameStatus] = useState<SaveStatus>(null);
  const [namePending, setNamePending] = useState(false);
  const [pwStatus, setPwStatus] = useState<SaveStatus>(null);
  const [pwPending, setPwPending] = useState(false);
  const initial = (displayName || email || "O").charAt(0).toUpperCase();

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === savedName) return;
    setNamePending(true);
    setNameStatus(null);
    const res = await saveDisplayNameAction({ fullName: trimmed });
    setNamePending(false);
    if (!res.ok) { setNameStatus({ tone: "err", text: res.error }); return; }
    setSavedName(trimmed);
    setNameStatus({ tone: "ok", text: res.persisted ? res.message ?? "Saved." : "Saved here — connect your account to keep it." });
  }

  async function resetPassword() {
    setPwPending(true);
    setPwStatus(null);
    const res = await sendPasswordResetAction();
    setPwPending(false);
    setPwStatus(res.ok ? { tone: "ok", text: res.message ?? "Reset link sent." } : { tone: "err", text: res.error });
  }

  return (
    <>
      <Panel title="Profile" foot="Your name and photo appear across the app and on invitations you send.">
        <Row label="Signed in as">
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", fontFamily: "var(--serif)", fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", border: "1px solid var(--accent-border)" }}>{initial}</span>
            <span>
              <span style={{ fontSize: "12.5px", fontWeight: 600, display: "block" }}>{savedName || email.split("@")[0] || "Operator"}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{email || "No email on this session"}</span>
            </span>
          </span>
        </Row>
        <Row label="Display name" desc="What teammates see next to your activity, and the name on invitations you send.">
          <span className="pillrow">
            <input className="inp" value={name} maxLength={80} style={{ minWidth: 170 }} placeholder="Your name" onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") saveName(); }} />
            <button className="btn sm gold" disabled={namePending || !name.trim() || name.trim() === savedName} onClick={saveName}>{namePending ? "Saving…" : "Save"}</button>
            <Status status={nameStatus} />
          </span>
        </Row>
        <Row label="Profile photo" desc="Shown on your account and across the app. Square works best.">
          <ImageUploadField
            currentUrl={avatarUrl}
            fallback={initial}
            shape="circle"
            uploadAction={saveUserAvatarAction}
            removeAction={removeUserAvatarAction}
          />
        </Row>
      </Panel>

      <Panel title="Sign-in & security" foot="Arc never asks for your password here — the link goes to your email.">
        {/* The heading always claimed to show "your active sign-in session" and
            never showed one. These come from the Supabase user record. */}
        <Row label="Last signed in" desc={session?.provider ? `Signed in with ${session.provider}.` : undefined}>
          <span className="ptxt">{session?.lastSignInAt ? relTime(session.lastSignInAt) : "Not recorded"}</span>
        </Row>
        <Row label="Account created">
          <span className="ptxt">{session?.createdAt ? new Date(session.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Not recorded"}</span>
        </Row>
        <Row label="Password" desc="Sends a reset link to your email address. The old password stays valid until you use it.">
          <span className="pillrow">
            <button className="btn sm" disabled={pwPending || !email} onClick={resetPassword}>{pwPending ? "Sending…" : "Email me a reset link"}</button>
            <Status status={pwStatus} />
          </span>
        </Row>
        <div style={{ padding: "13px 0 4px" }}>
          <form action="/api/auth/sign-out" method="post"><button type="submit" className="btn danger">Sign out</button></form>
        </div>
      </Panel>
    </>
  );
}

// ---- Media defaults (wired) ----
// The built-in Gemini/Veo default — the only media-model default that's actually
// consumed (settings.imageModel/videoModel → the generate-* routes). "" = Auto.
const IMAGE_MODEL_LABELS: Record<string, string> = {
  "": "Auto — Arc picks per task",
  "gemini-3-pro-image": "Gemini 3 Pro Image",
  "gemini-3.1-flash-image": "Gemini 3.1 Flash Image",
  "gemini-2.5-flash-image": "Gemini 2.5 Flash Image",
};
const VIDEO_MODEL_LABELS: Record<string, string> = {
  "": "Auto — Arc picks per task",
  "veo-3.1-generate-preview": "Veo 3.1",
  "veo-3.1-fast-generate-preview": "Veo 3.1 Fast",
};

function MediaDefaultsPanel({ settings }: { settings: AppSettings }) {
  const [imageModel, setImageModel] = useState(settings.imageModel);
  const [videoModel, setVideoModel] = useState(settings.videoModel);
  const [status, setStatus] = useState<SaveStatus>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setStatus(null);
    const res = await saveMediaDefaults({ imageModel, videoModel });
    setPending(false);
    setStatus(toStatus(res, "Saved."));
  }

  // The footer here read "image_model / video_model · read by
  // /api/v1/arc/media/generate-*" — two column names and an API route, shown to
  // an owner-operator on a settings screen.
  return (
    <Panel title="Built-in generation default" foot="Applies when Arc falls back to the built-in engine. Everything it makes is still a draft that waits for your approval.">
      <Row label="Default image model" desc="Used by the built-in Gemini path. Auto follows Arc’s per-task pick.">
        <select className="sel" value={imageModel} onChange={(e) => setImageModel(e.target.value)}>
          {["", ...IMAGE_MODELS].map((m) => <option key={m || "auto"} value={m}>{IMAGE_MODEL_LABELS[m] ?? m}</option>)}
        </select>
      </Row>
      <Row label="Default video model" desc="Used by the built-in Veo path.">
        <select className="sel" value={videoModel} onChange={(e) => setVideoModel(e.target.value)}>
          {["", ...VIDEO_MODELS].map((m) => <option key={m || "auto"} value={m}>{VIDEO_MODEL_LABELS[m] ?? m}</option>)}
        </select>
      </Row>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 0 4px" }}>
        <button className="btn gold" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save defaults"}</button>
        <Status status={status} />
      </div>
    </Panel>
  );
}

// ---- Connector card (launcher) ----
// A summary card for each real connector; the whole card drills into the detail
// page where connect / test / enable / disconnect live.
function ConnectorCard({ view, onOpen }: { view: ConnectorView; onOpen: () => void }) {
  const meta = CONNECTOR_META[view.key] ?? { c: "#9aa0ac", l: view.label.slice(0, 2), credLabel: "API key", credHint: "" };
  const pill = CONNECTOR_STATUS_PILL[view.status];
  const cost = costBadgeFor(view);
  const kindLabel = CONNECTOR_KIND_LABEL[view.kind] ?? view.kind;
  // A connector whose integration doesn't exist can't be connected — the popup
  // says exactly that. The card still invited you to "Connect →", which is the
  // control-that-refuses-on-click the popup copy was written to avoid.
  const cta = view.status === "unavailable"
    ? "Details"
    : view.credentialPresent || view.enabled ? "Manage" : view.credentialOptional || view.platformCredentialAvailable ? "Set up" : "Connect";
  return (
    <button type="button" className="ccard ccard-btn" onClick={onOpen}>
      <div className="ct">
        <BrandBadge className="clogo" name={view.label} initials={meta.l} color={meta.c} />
        <div><div className="cnm">{view.label}</div><div className="ccat">{kindLabel} · {view.access === "read_only" ? "read-only" : "gated write"}</div></div>
      </div>
      <div className="cdsc">{view.description}</div>
      <div className="cfoot">
        <Pill kind={pill.kind}>{pill.label}</Pill>
        <span className="badge" title={cost.title}>{cost.label}</span>
        <span className="grow" />
        <span className="cb-open">{cta} →</span>
      </div>
    </button>
  );
}

// ---- Connector popup (per-workspace setup) ----
// One modal for a single connector: status + a real Test probe, the credential
// connect / rotate / disconnect (or an enable switch for no-credential ones), any
// per-workspace config, and a plain-language "About". Opened from a card click and
// deep-linkable (?s=connections&c=<key>). Nothing here is developer-facing.
function ConnectorModal({ view, configured, hubspotOAuthConfigured = false, googleOAuthConfigured = false, onClose }: { view: ConnectorView; configured: boolean; hubspotOAuthConfigured?: boolean; googleOAuthConfigured?: boolean; onClose: () => void }) {
  const meta = CONNECTOR_META[view.key] ?? { c: "#9aa0ac", l: view.label.slice(0, 2), credLabel: "API key", credHint: "" };
  const reg = findConnector(view.key);
  const pill = CONNECTOR_STATUS_PILL[view.status];
  const cost = costBadgeFor(view);
  // Up-front cost disclosure for metered connectors — shown before you connect /
  // enable (no surprise charges). Rate lives in src/domain/connector-metering.ts.
  const costDisclosure = view.costTier === "metered" ? describeConnectorCost(view.key) : null;
  const costLine = costDisclosure ? `${cost.label} · ${costDisclosure}` : cost.label;
  const kindLabel = CONNECTOR_KIND_LABEL[view.kind] ?? view.kind;
  // No-credential connectors (public signal source, config-only channel) have no
  // secret to store — they are set up by flipping the enable switch.
  const noCredential = view.credentialOptional && view.authKind === "none";
  // No-credential connectors that still expose a live connectivity probe (the NWS
  // weather source reports its active-alert count) get a Test connection button.
  const hasConnectivityTest = view.key === "weather-signals";
  const configFields = CONFIG_FIELDS[view.key] ?? [];

  const [credential, setCredential] = useState("");
  // OAuth round-trip marker: Higgsfield redirects back with ?hf=, HubSpot with
  // ?hs=, Google Business reviews with ?gb=. Seeded at init so no setState-in-effect.
  const oauthMarker =
    view.key === "higgsfield" ? "hf" : view.key === "hubspot-import" ? "hs" : view.key === "reviews-signals" ? "gb" : null;
  const [status, setStatus] = useState<SaveStatus>(() => {
    if (typeof window === "undefined" || !oauthMarker) return null;
    const marker = new URLSearchParams(window.location.search).get(oauthMarker);
    if (!marker) return null;
    return marker === "connected"
      ? { tone: "ok", text: `${view.label} connected.` }
      : { tone: "err", text: `Couldn’t connect ${view.label} (${marker.replace(/_/g, " ")}).` };
  });
  const [pending, setPending] = useState(false);

  // Strip the marker after mount so a refresh doesn't re-show it (no setState).
  useEffect(() => {
    if (!oauthMarker) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(oauthMarker)) return;
    params.delete(oauthMarker);
    window.history.replaceState(null, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
  }, [oauthMarker]);

  async function connect() {
    if (!credential.trim()) { setStatus({ tone: "err", text: "Paste a credential." }); return; }
    setPending(true); setStatus(null);
    const res = await connectConnector({ connectorKey: view.key, credential: credential.trim() });
    setPending(false);
    setStatus(toStatus(res, `${view.label} connected.`));
    if (res.ok) setCredential("");
  }
  async function run(fn: () => Promise<SettingsWriteResult>, ok: string) {
    setPending(true); setStatus(null);
    setStatus(toStatus(await fn(), ok));
    setPending(false);
  }

  // The integration isn't written, so there is nothing to test, key, switch on or
  // configure. Show what it WILL do and why it can't run — an interactive control
  // that refuses on click is a worse answer than no control.
  const isPlanned = view.status === "unavailable";
  const canTest = (!noCredential || hasConnectivityTest) && !isPlanned;

  return (
    <Modal open onClose={onClose} width={480} title={view.label} description={view.description}>
      <div className="cxm">
        {!configured && (
          <div className="cxm-note">You’re previewing without a connected workspace — changes here won’t be saved.</div>
        )}

        <div className="cxm-status">
          <span className="pillrow">
            <Pill kind={pill.kind}>{pill.label}</Pill>
            <span className="badge" title={costLine}>{cost.label}</span>
          </span>
          {canTest && (
            <button className="btn sm" disabled={pending || (!hasConnectivityTest && !view.credentialPresent && !view.platformCredentialAvailable)} onClick={() => run(() => testConnector({ connectorKey: view.key }), `${view.label} connection is healthy.`)}>
              {pending ? "Testing…" : "Test connection"}
            </button>
          )}
        </div>
        {view.lastTestOk === false && view.lastTestError ? (
          <div className="cxm-err">{view.lastTestError}</div>
        ) : view.lastTestedAt ? (
          <div className="cxm-sub">Last tested {relTime(view.lastTestedAt)}.</div>
        ) : null}

        {/* Credential / enable */}
        {isPlanned ? (
          <div className="cxm-sec">
            <div className="cxm-label">Not built yet</div>
            <p className="cxm-hint">
              This connector is in the catalog so you can see it&apos;s coming, but the integration it needs
              doesn&apos;t exist yet — so it can&apos;t be switched on, and it proposes nothing. It&apos;ll become
              available here once that lands. Nothing it ever produces goes outbound without your approval.
            </p>
          </div>
        ) : noCredential ? (
          <div className="cxm-sec">
            <div className="cxm-label">{view.enabled ? "Turned on" : "Turn on"}</div>
            <p className="cxm-hint">{meta.credHint || "No key needed — just switch it on to let Arc use it. Signal sources only propose; channels send only from the approved path."}</p>
            <button className="btn gold" disabled={pending} onClick={() => run(() => toggleConnectorEnabled({ connectorKey: view.key, enabled: !view.enabled }), view.enabled ? "Turned off." : "Turned on.")}>
              {view.enabled ? "Turn off" : "Turn on"}
            </button>
          </div>
        ) : view.credentialPresent ? (
          <div className="cxm-sec">
            <div className="cxm-label">Connected</div>
            <p className="cxm-hint">Paste a new {meta.credLabel} to rotate it, or disconnect to remove it. Your key is stored encrypted and never shown again.</p>
            <div className="cxm-field">
              <input className="inp" type="password" placeholder={`New ${meta.credLabel}`} value={credential} onChange={(e) => setCredential(e.target.value)} />
              <button className="btn gold" disabled={pending || !credential.trim()} onClick={connect}>Save</button>
            </div>
            <div className="cxm-actions">
              <button className="btn sm" disabled={pending} onClick={() => run(() => toggleConnectorEnabled({ connectorKey: view.key, enabled: !view.enabled }), view.enabled ? "Turned off." : "Turned on.")}>{view.enabled ? "Turn off" : "Turn on"}</button>
              <button className="btn sm danger" disabled={pending} onClick={() => run(() => disconnectConnector({ connectorKey: view.key }), `${view.label} disconnected.`)}>Disconnect</button>
            </div>
          </div>
        ) : view.platformCredentialAvailable ? (
          <div className="cxm-sec">
            <div className="cxm-label">{view.enabled ? "Included — turned on" : "Included with your plan"}</div>
            <p className="cxm-hint">
              Works out of the box on platform credits — usage is metered against your plan and spend-capped, and
              nothing it produces goes outbound without your approval. Prefer your own {meta.credLabel}? Paste it
              below and calls run on your account instead (your billing, no metering).
            </p>
            <button className="btn gold" disabled={pending} onClick={() => run(() => toggleConnectorEnabled({ connectorKey: view.key, enabled: !view.enabled }), view.enabled ? "Turned off." : "Turned on.")}>
              {view.enabled ? "Turn off" : "Turn on"}
            </button>
            <div className="cxm-field" style={{ marginTop: 12 }}>
              <input className="inp" type="password" placeholder={`Optional: your own ${meta.credLabel}`} value={credential} onChange={(e) => setCredential(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") connect(); }} />
              <button className="btn sm" disabled={pending || !credential.trim()} onClick={connect}>Save key</button>
            </div>
          </div>
        ) : view.key === "higgsfield" ? (
          <div className="cxm-sec">
            <div className="cxm-label">Option 1 — Cloud API key (recommended for teams)</div>
            <p className="cxm-hint">
              Create a key at cloud.higgsfield.ai → API keys and paste it here. This is the supported path when Arc runs
              in the cloud: the key belongs to your Higgsfield organization, uses your credits, and has no signed-in
              session to expire. The key is verified with Higgsfield before it&apos;s stored.
            </p>
            <div className="cxm-field">
              <input className="inp" type="password" placeholder="Higgsfield Cloud API key" value={credential} onChange={(e) => setCredential(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") connect(); }} />
              <button className="btn gold" disabled={pending || !credential.trim()} onClick={connect}>{pending ? "Verifying…" : "Connect"}</button>
            </div>
            <div className="cxm-label" style={{ marginTop: 16 }}>Option 2 — Personal account (OAuth)</div>
            <p className="cxm-hint">Sign in to your Higgsfield Ultra account. Arc gets its own key for this workspace and refreshes it automatically — no token to copy.</p>
            <button className="btn sm" disabled={pending || !configured} onClick={() => { window.location.href = "/api/connectors/higgsfield/authorize"; }}>Connect with Higgsfield</button>
          </div>
        ) : view.key === "hubspot-import" && hubspotOAuthConfigured ? (
          <div className="cxm-sec">
            <div className="cxm-label">Option 1 — Connect with HubSpot (OAuth)</div>
            <p className="cxm-hint">
              Sign in to HubSpot and authorize read access to your contacts &amp; companies. Arc gets a token for this
              workspace and refreshes it automatically — nothing to copy, and read-only.
            </p>
            <button className="btn gold" disabled={pending || !configured} onClick={() => { window.location.href = "/api/connectors/hubspot/authorize"; }}>Connect with HubSpot</button>
            <div className="cxm-label" style={{ marginTop: 16 }}>Option 2 — Private-app token</div>
            <p className="cxm-hint">{meta.credHint}</p>
            <div className="cxm-field">
              <input className="inp" type="password" placeholder={`Paste your ${meta.credLabel}`} value={credential} onChange={(e) => setCredential(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") connect(); }} />
              <button className="btn sm" disabled={pending || !credential.trim()} onClick={connect}>{pending ? "Connecting…" : "Connect"}</button>
            </div>
          </div>
        ) : view.key === "reviews-signals" ? (
          <div className="cxm-sec">
            <div className="cxm-label">Google Business Profile</div>
            <p className="cxm-hint">
              Sign in to Google and grant read access to your Business Profile. Arc reads recent reviews for the
              location you set below and proposes service-recovery / referral opportunities — it never replies, and
              nothing goes out without your approval.
            </p>
            {googleOAuthConfigured ? (
              <button className="btn gold" disabled={pending || !configured} onClick={() => { window.location.href = "/api/connectors/google-reviews/authorize"; }}>Connect with Google</button>
            ) : (
              <p className="cxm-hint" style={{ opacity: 0.85 }}>
                Google sign-in isn&apos;t switched on here yet. Ask us to enable it and we&apos;ll connect
                Business Profile for your workspace.
              </p>
            )}
          </div>
        ) : (
          <div className="cxm-sec">
            <div className="cxm-label">{meta.credLabel}</div>
            <p className="cxm-hint">{meta.credHint}</p>
            <div className="cxm-field">
              <input className="inp" type="password" placeholder={`Paste your ${meta.credLabel}`} value={credential} onChange={(e) => setCredential(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") connect(); }} />
              <button className="btn gold" disabled={pending} onClick={connect}>{pending ? "Connecting…" : "Connect"}</button>
            </div>
          </div>
        )}

        {/* Per-workspace config (watched locations, endpoint, default persona…) */}
        {!isPlanned && configFields.map((field) => (
          <ConnectorConfigSection key={field.key} view={view} field={field} />
        ))}

        {/* CSV import — the data is pasted here, not fetched from a connected source */}
        {view.key === "csv-import" && !isPlanned ? <CsvImportSection view={view} /> : null}

        {/* Slack alerts — operator-triggered posts to the team channel */}
        {view.key === "slack-alerts" && !isPlanned ? <SlackAlertsSection view={view} /> : null}

        {/* Other import sources — an explicit, deliberate pull from a connected source */}
        {view.kind === "import_source" && view.key !== "csv-import" && !isPlanned ? (
          <div className="cxm-sec">
            <div className="cxm-label">Import contacts</div>
            <p className="cxm-hint">Runs only when you click — never automatically. A re-run updates existing leads (deduped on the source id), never duplicates. Nothing goes outbound.</p>
            <button className="btn gold" disabled={pending || view.status !== "connected"} onClick={() => run(() => runConnectorImport({ connectorKey: view.key }), "Import complete.")}>
              {pending ? "Importing…" : "Import now"}
            </button>
          </div>
        ) : null}

        {/* About */}
        <div className="cxm-sec">
          <div className="cxm-label">About</div>
          <dl className="cxm-about">
            <div><dt>Type</dt><dd>{kindLabel}</dd></div>
            <div><dt>Access</dt><dd>{view.access === "read_only" ? "Read-only" : "Approval-gated"}</dd></div>
            <div><dt>Cost</dt><dd>{costLine}</dd></div>
            <div><dt>Sign-in</dt><dd>{view.authKind === "oauth" ? "Account token" : view.authKind === "api_key" ? "API key" : "None needed"}</dd></div>
            {reg?.verticals.length ? <div><dt>Best for</dt><dd>{reg.verticals.join(", ")}</dd></div> : null}
          </dl>
        </div>

        {status ? <div className="cxm-statusline"><Status status={status} /></div> : null}
      </div>
    </Modal>
  );
}

// Slack alerts: once connected, the operator can post a test message or an
// opportunity digest to their team channel. Buttons only — nothing automatic, so it
// stays inside "no outbound without a human". Internal alerts, never customer-facing.
function SlackAlertsSection({ view }: { view: ConnectorView }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);
  const ready = view.status === "connected";

  async function post() {
    setPending(true); setStatus(null);
    const res = await sendSlackDigestAction();
    setPending(false);
    setStatus(res.ok ? { tone: "ok", text: res.message ?? "Posted." } : { tone: "err", text: res.error });
  }

  return (
    <div className="cxm-sec">
      <div className="cxm-label">Post a digest</div>
      <p className="cxm-hint">
        {ready
          ? "Post a summary of your current open opportunities to Slack on demand — nothing is sent automatically, this button is the only trigger. (Use Test connection above to post a quick check.)"
          : "Paste your Slack webhook URL above and switch this on first — then you can post from here."}
      </p>
      <div className="cxm-actions">
        <button className="btn sm gold" disabled={!ready || pending} onClick={post}>{pending ? "Posting…" : "Post opportunity digest"}</button>
      </div>
      {status ? <div className="cxm-statusline"><Status status={status} /></div> : null}
    </div>
  );
}

// CSV import: paste a CSV, and after the persona is set + connector enabled, import
// leads. The data lives here, not in stored config — so it's its own section, not
// the generic "Import now" that fetches from a connected source.
function CsvImportSection({ view }: { view: ConnectorView }) {
  const [csv, setCsv] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);
  const ready = view.status === "connected";

  async function importCsv() {
    setPending(true); setStatus(null);
    const res = await runCsvImportAction({ csvText: csv });
    setPending(false);
    setStatus(res.ok ? { tone: "ok", text: res.message ?? "Imported." } : { tone: "err", text: res.error });
    if (res.ok) setCsv("");
  }

  return (
    <div className="cxm-sec">
      <div className="cxm-label">Paste CSV</div>
      <p className="cxm-hint">
        {ready
          ? "A header row plus one contact per line. Columns like name, email, phone, company, city/state/zip are auto-detected — order doesn't matter. Leads dedupe on email/phone, so re-importing updates instead of duplicating. Include a last contacted (or last activity) column if your export has one: it's what lets Arc spot who's gone quiet straight away, instead of treating everyone as new."
          : "Set a default persona above and switch this on first — then paste your CSV here."}
      </p>
      <div className="cxm-field stack">
        <textarea
          className="inp"
          rows={5}
          spellCheck={false}
          disabled={!ready || pending}
          placeholder={
            "name,email,company,city,state,last contacted\n" +
            "Jordan Vega,jordan@acme.com,Acme Restoration,Chicago,IL,2026-01-15"
          }
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <button className="btn sm gold" disabled={!ready || pending || !csv.trim()} onClick={importCsv}>
          {pending ? "Importing…" : "Import CSV"}
        </button>
      </div>
      {status ? <div className="cxm-statusline"><Status status={status} /></div> : null}
    </div>
  );
}

// One-value-per-line fields (points, feeds) share a shape: a stacked textarea, a
// parse that reports unreadable lines, and a save that stores the parsed value.
// Each kind supplies its own parse/format + error hint so the editor stays generic.
type LineField = {
  toText: (v: unknown) => string;
  parse: (text: string) => { value: unknown; invalid: string[] };
  errorHint: string;
};
const LINE_FIELDS: Record<"points" | "feeds" | "queries", LineField> = {
  points: {
    toText: (v) => formatServicePointsInput(parseWeatherServiceArea({ points: v }).points),
    parse: (text) => { const r = parseServicePointsInput(text); return { value: r.points, invalid: r.invalid }; },
    errorHint: "each line needs lat,lng (e.g. 41.88,-87.63 Chicago)",
  },
  feeds: {
    toText: (v) => formatFeedsInput(parseFeedsInput(typeof v === "string" ? v : "").feeds),
    parse: (text) => { const r = parseFeedsInput(text); return { value: formatFeedsInput(r.feeds), invalid: r.invalid }; },
    errorHint: "each line needs a feed URL (e.g. competitor: https://blog.example.com/feed)",
  },
  queries: {
    // Queries are stored as the raw one-per-line text (spaces are meaningful), so the
    // stored value round-trips verbatim; parse only surfaces unreadable lines.
    toText: (v) => (typeof v === "string" ? v : ""),
    parse: (text) => { const r = parseNewsQueriesInput(text); return { value: text, invalid: r.invalid }; },
    errorHint: "each line is a search term, optionally prefixed (e.g. competitor: Acme Corp)",
  },
};
function isLineField(kind: ConfigFieldKind): kind is "points" | "feeds" | "queries" {
  return kind === "points" || kind === "feeds" || kind === "queries";
}

// Per-workspace, non-secret config editor inside the connector popup (a signal
// source's watched locations/feeds, a channel's endpoint, an import's default persona).
/**
 * Operator-facing names for the weather categories. The description says what
 * demand the category claims, because that claim is what ends up on the card —
 * enabling one is a statement about your business, not a display preference.
 */
const WEATHER_CATEGORY_LABELS: Record<WeatherCategory, { label: string; hint: string }> = {
  property_damage: { label: "Property damage", hint: "Storms, hail, wind, flood, hard freeze" },
  fire_weather: { label: "Fire weather", hint: "Red Flag Warnings and fire-weather watches — prevention and preparedness demand, before anything burns" },
  extreme_heat: { label: "Extreme heat", hint: "Heat advisories and warnings — cooling and heat-resilience demand" },
  air_quality: { label: "Air quality", hint: "Air quality, stagnation, smoke — filtration and ventilation demand" },
  marine_coastal: { label: "Marine & coastal", hint: "Beach hazards, rip currents, surf, lakeshore flooding" },
};

function configToInput(config: Record<string, unknown>, field: ConfigField): string {
  const v = config[field.key];
  if (field.kind === "csv") return Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "";
  if (isLineField(field.kind)) return LINE_FIELDS[field.kind].toText(v);
  return typeof v === "string" ? v : "";
}

function ConnectorConfigSection({ view, field }: { view: ConnectorView; field: ConfigField }) {
  const isCategories = field.kind === "categories";
  const [value, setValue] = useState(() => configToInput(view.config, field));
  // Parsed through the same domain function the detector uses, so what the boxes
  // show is what detection will actually do — including the property-damage
  // fallback when nothing has been saved yet.
  const [cats, setCats] = useState<WeatherCategory[]>(() =>
    isCategories ? parseWeatherCategories(view.config[field.key]) : [],
  );
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);
  const personaOptions = useContext(PersonaOptionsContext);
  // Render a picker only when we actually know the workspace's personas; otherwise
  // (offline / none defined) fall back to the plain input so the field still works.
  const asPersonaSelect = field.kind === "persona" && personaOptions.length > 0;

  const line = isLineField(field.kind) ? LINE_FIELDS[field.kind] : null;
  // Lines we couldn't read. Shown rather than dropped — silently discarding a typo'd
  // entry leaves the operator believing they're watching something they aren't.
  const invalid = line ? line.parse(value).invalid : [];

  async function save() {
    setPending(true); setStatus(null);
    let next: unknown;
    if (isCategories) next = cats;
    else if (field.kind === "csv") next = value.split(",").map((s) => s.trim()).filter(Boolean);
    else if (line) next = line.parse(value).value;
    else next = value.trim();
    const res = await saveConnectorConfig({ connectorKey: view.key, config: { [field.key]: next } });
    setPending(false);
    setStatus(toStatus(res, `${view.label} settings saved.`));
  }

  return (
    <div className="cxm-sec">
      <div className="cxm-label">{field.label}</div>
      <p className="cxm-hint">{field.hint}</p>
      <div className={line || isCategories ? "cxm-field stack" : "cxm-field"}>
        {isCategories ? (
          <div className="cxm-checks" role="group" aria-label={field.label}>
            {WEATHER_CATEGORIES.map((c) => (
              <label className="cxm-check" key={c}>
                <input
                  type="checkbox"
                  checked={cats.includes(c)}
                  onChange={(e) =>
                    setCats((prev) =>
                      e.target.checked ? [...prev, c] : prev.filter((x) => x !== c),
                    )
                  }
                />
                <span>
                  <b>{WEATHER_CATEGORY_LABELS[c].label}</b>
                  <i>{WEATHER_CATEGORY_LABELS[c].hint}</i>
                </span>
              </label>
            ))}
          </div>
        ) : line ? (
          <textarea
            className="inp"
            rows={4}
            spellCheck={false}
            placeholder={field.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : asPersonaSelect ? (
          <select className="inp" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select a persona…</option>
            {/* Preserve a value that isn't in the current taxonomy (legacy/renamed) so saving doesn't silently drop it. */}
            {value && !personaOptions.some((o) => o.key === value) ? <option value={value}>{value} (not in current personas)</option> : null}
            {personaOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        ) : (
          <input className="inp" placeholder={field.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        <button
          className="btn sm gold"
          disabled={pending || invalid.length > 0 || (isCategories && cats.length === 0)}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {isCategories && cats.length === 0 ? (
        <div className="cxm-statusline">
          {/* Saving an empty set would parse back to property-damage-only, so the
              boxes would say one thing and detection would do another. Refuse it
              instead: turn the connector off if you want it watching nothing. */}
          <Status status={{ tone: "err", text: "Pick at least one — to stop all weather alerts, switch the connector off." }} />
        </div>
      ) : null}
      {invalid.length > 0 && line ? (
        <div className="cxm-statusline">
          <Status status={{ tone: "err", text: `Can't read: ${invalid.join(" · ")} — ${line.errorHint}.` }} />
        </div>
      ) : null}
      {status ? <div className="cxm-statusline"><Status status={status} /></div> : null}
    </div>
  );
}

// ---- Email delivery (Resend) — a connector card + popup, like the rest ----
// The one connection the send path actually reads: `executeResendDispatch` refuses
// unless this is enabled with a from-address, on top of the always-enforced approval
// gate. The Resend API key is stored per workspace in the Vault (like Gemini /
// Higgsfield) and the send path prefers it, falling back to the deployment
// RESEND_API_KEY — so the popup collects the key, plus enable + from + test.
const EMAIL_PILL: Record<ConnectionView["status"], { kind: string; label: string }> = {
  connected: { kind: "ok", label: "Connected" },
  disabled: { kind: "warn", label: "Off" },
  not_configured: { kind: "warn", label: "Key needed" },
  error: { kind: "err", label: "Error" },
};

// Two independent switches gate a send: this workspace's connection (`view.enabled`,
// which the modal toggles) and the deployment kill-switch ARC_SEND_ENABLED. Only the
// first was ever visible, so a fully-configured-but-dark deployment read "Connected"
// while every Confirm-send refused. When the connection is otherwise ready and the
// deployment is dark, say THAT instead — it's the binding constraint.
function emailPill(view: ConnectionView, liveSendEnabled: boolean): { kind: string; label: string; title?: string } {
  if (view.status === "connected" && !liveSendEnabled) {
    return {
      kind: "warn",
      label: "Not armed",
      title: "Resend is configured, but the deployment safety lock is pausing live sending. Approved campaigns will not send until it is armed.",
    };
  }
  return EMAIL_PILL[view.status];
}

function ResendCard({ view, liveSendEnabled, onOpen }: { view: ConnectionView; liveSendEnabled: boolean; onOpen: () => void }) {
  const pill = emailPill(view, liveSendEnabled);
  const cta = view.status === "not_configured" ? "Set up" : "Manage";
  const keyBadge = view.credentialPresent
    ? { label: "Workspace key", title: "Uses this workspace's own Resend key." }
    : view.status !== "not_configured"
      ? { label: "Shared account", title: "Uses the Resend account configured for this deployment." }
      : null;
  return (
    <button type="button" className="ccard ccard-btn" onClick={onOpen}>
      <div className="ct">
        <BrandBadge className="clogo" name="Resend" initials="Re" color="#9aa0ac" />
        <div><div className="cnm">Resend</div><div className="ccat">Channel · email delivery</div></div>
      </div>
      <div className="cdsc">Send approved campaign &amp; transactional email. Sending stays off until you turn it on.</div>
      <div className="cfoot">
        <span title={pill.title}><Pill kind={pill.kind}>{pill.label}</Pill></span>
        {keyBadge ? <span className="badge" title={keyBadge.title}>{keyBadge.label}</span> : null}
        <span className="grow" />
        <span className="cb-open">{cta} →</span>
      </div>
    </button>
  );
}

function ResendModal({ view, liveSendEnabled, onClose }: { view: ConnectionView; liveSendEnabled: boolean; onClose: () => void }) {
  const [from, setFrom] = useState(view.fromEmail ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);
  const pill = emailPill(view, liveSendEnabled);
  const keyPresent = view.status !== "not_configured";
  // A stored workspace key vs. falling back to the deployment env key — the send
  // path prefers the stored one, so say plainly which is in effect.
  const workspaceKey = view.credentialPresent;
  const envFallback = keyPresent && !workspaceKey;

  async function run(fn: () => Promise<SettingsWriteResult>, ok: string) {
    setPending(true); setStatus(null);
    setStatus(toStatus(await fn(), ok));
    setPending(false);
  }

  async function saveKey() {
    if (!apiKey.trim()) return;
    setPending(true); setStatus(null);
    const res = await saveResendKey({ apiKey: apiKey.trim() });
    setStatus(toStatus(res, "Resend key saved."));
    if (res.ok) setApiKey("");
    setPending(false);
  }

  return (
    <Modal open onClose={onClose} width={480} title="Resend" description="Email delivery for approved campaigns. Nothing sends without your approval.">
      <div className="cxm">
        <div className="cxm-status">
          <span className="pillrow"><Pill kind={pill.kind}>{pill.label}</Pill></span>
          <button className="btn sm" disabled={pending} onClick={() => run(() => testEmailConnection(), "Resend connection is healthy.")}>{pending ? "Testing…" : "Test connection"}</button>
        </div>
        {view.lastTestOk === false && view.lastTestError ? (
          <div className="cxm-err">{view.lastTestError}</div>
        ) : view.lastTestedAt ? (
          <div className="cxm-sub">Last tested {relTime(view.lastTestedAt)}.</div>
        ) : null}

        {/* API key — stored per workspace in the Vault (never shown again). */}
        <div className="cxm-sec">
          <div className="cxm-label">API key</div>
          {workspaceKey ? (
            <>
              <p className="cxm-hint">This workspace uses its own Resend key. Paste a new key to rotate it, or remove it to use the shared account. Your key is stored encrypted and never shown again.</p>
              <div className="cxm-field">
                <input className="inp" type="password" placeholder="New Resend API key (re_…)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }} />
                <button className="btn gold" disabled={pending || !apiKey.trim()} onClick={saveKey}>Save</button>
              </div>
              <div className="cxm-actions">
                <button className="btn sm danger" disabled={pending} onClick={() => run(() => removeResendKey(), "Resend key removed.")}>Remove key</button>
              </div>
            </>
          ) : (
            <>
              <p className="cxm-hint">
                {envFallback
                  ? "This workspace is using the shared Resend account. Paste a key to use a dedicated account for this workspace instead."
                  : "Paste your Resend API key to connect this workspace's own Resend account. Stored encrypted and never shown again."}
              </p>
              <div className="cxm-field">
                <input className="inp" type="password" placeholder="Resend API key (re_…)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }} />
                <button className="btn gold" disabled={pending || !apiKey.trim()} onClick={saveKey}>{pending ? "Saving…" : "Connect"}</button>
              </div>
            </>
          )}
        </div>

        <div className="cxm-sec">
          <div className="cxm-label">Sending</div>
          <p className="cxm-hint">Turn on to let approved campaigns send through Resend. Off is a hard stop — the send path refuses immediately.</p>
          {/* This toggle is per-workspace; ARC_SEND_ENABLED is the whole deployment.
              Both must be on, so surface the second here rather than letting
              Confirm-send be the first place anyone finds out. */}
          {!liveSendEnabled ? (
            <div className="cxm-note">
              Live sending is paused by the deployment safety lock, so nothing sends even with this connection on. A platform administrator must arm live sending.
            </div>
          ) : null}
          <button className="btn gold" disabled={pending} onClick={() => run(() => setEmailConnectionEnabled({ enabled: !view.enabled, fromEmail: from.trim() || undefined }), view.enabled ? "Sending disabled." : "Sending enabled.")}>
            {view.enabled ? "Turn off sending" : "Turn on sending"}
          </button>
        </div>

        <div className="cxm-sec">
          <div className="cxm-label">From address</div>
          <p className="cxm-hint">Must be on a domain you’ve verified in Resend. Left blank, Arc uses the deployment default.</p>
          <div className="cxm-field">
            <input className="inp" type="text" placeholder="Arc <hello@yourdomain.com>" value={from} onChange={(e) => setFrom(e.target.value)} />
            <button className="btn gold" disabled={pending || from.trim() === (view.fromEmail ?? "")} onClick={() => run(() => setEmailConnectionEnabled({ enabled: view.enabled, fromEmail: from.trim() || undefined }), "From address saved.")}>Save</button>
          </div>
        </div>

        {status ? <div className="cxm-statusline"><Status status={status} /></div> : null}
      </div>
    </Modal>
  );
}

// ---- Roles & permissions (real reference) ----
// Renders WORKSPACE_ROLES — the same catalog that powers the invite picker and
// the member-management guards, so this guide can't drift from what's enforced.
function RolesGuide() {
  return (
    <Panel title="Roles & permissions" foot="These permissions are shared by invitations and workspace access controls.">
      <div className="roles">
        {WORKSPACE_ROLES.map((r) => (
          <div className="rolecard" key={r.role}>
            <div className="rolehd">
              <span className="rolename">{r.label}</span>
              <span className="badge">{r.role === "owner" ? "Granted at onboarding" : "Assignable"}</span>
            </div>
            <div className="roledesc">{r.summary}</div>
            <ul className="rolecaps">{r.capabilities.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---- Activity log (real audit events) ----
function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}
function actionAccent(action: string): string {
  if (action.startsWith("workspace")) return "var(--accent)";
  if (action.startsWith("connector")) return "#7fb89a";
  if (action.startsWith("member")) return "#88b6d8";
  return "var(--muted)";
}
function ActivityLog({ entries, isDemo }: { entries: WorkspaceActivityEntry[]; isDemo: boolean }) {
  if (!entries.length) {
    return (
      <Panel title="Recent activity">
        <div style={{ padding: "8px 2px", fontSize: 12.5, color: "var(--muted)" }}>No activity yet — member and workspace changes will show up here.</div>
      </Panel>
    );
  }
  return (
    <Panel title="Recent activity" foot={isDemo ? "Demo activity is shown until the workspace is connected." : "Member and workspace changes, newest first."}>
      {entries.map((e) => (
        <div className="actrow" key={e.id}>
          <span className="actdot" style={{ background: actionAccent(e.action) }} />
          <div className="actbody">
            <div className="actsum">{e.summary ?? e.action}</div>
            <div className="actmeta">{e.actorEmail ?? "System"} · {relTime(e.createdAt)}</div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

// ---- Usage breakdowns (real ai_usage_events; demo shape offline) ----
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const usageTag = (isDemo: boolean) => <span className="tg ok">{isDemo ? DEMO_DATA_LABEL : "Live"}</span>;
function UsageEmpty({ label }: { label: string }) {
  return (
    <Panel title="Usage" tag={<span className="tg ok">Live</span>}>
      <div style={{ padding: "8px 2px", fontSize: 12.5, color: "var(--muted)" }}>{label}</div>
    </Panel>
  );
}

function UsageByDay({ usage }: { usage: SettingsUsageView }) {
  const days = usage.daily;
  if (!days.length) return <UsageEmpty label="No daily usage yet — spend will chart here as Arc works." />;
  const max = Math.max(...days.map((d) => d.costCents), 1);
  const total = days.reduce((s, d) => s + d.costCents, 0);
  const peak = days.reduce((a, b) => (b.costCents > a.costCents ? b : a), days[0]);
  return (
    <Panel title="Cost by day" tag={usageTag(usage.isDemo)} foot="ai_usage_events · estimated cost per day, last 30 days">
      <div style={{ padding: "6px 0 2px" }}>
        <div className="daychart">
          {days.map((d) => <div key={d.date} className="daybar" style={{ height: `${Math.max(3, (d.costCents / max) * 100)}%` }} title={`${d.date} · ${usd(d.costCents)}`} />)}
        </div>
        <div className="dayaxis"><span>{days[0].date.slice(5)}</span><span>{days[days.length - 1].date.slice(5)}</span></div>
        <div className="daystat"><span><b>{usd(total)}</b> total</span><span>Peak {usd(peak.costCents)} · {peak.date.slice(5)}</span></div>
      </div>
    </Panel>
  );
}

function UsageByModel({ usage }: { usage: SettingsUsageView }) {
  const rows = usage.byModel;
  if (!rows.length) return <UsageEmpty label="No model usage yet." />;
  const max = Math.max(...rows.map((r) => r.costCents), 1);
  return (
    <Panel title="By model" tag={usageTag(usage.isDemo)} foot="ai_usage_events grouped by model · highest spend first">
      {[...rows].sort((a, b) => b.costCents - a.costCents).map((r) => (
        <div className="usagerow" key={r.model}>
          <div className="ug-name" title={r.model}>{r.model}</div>
          <div className="ug-bar"><i style={{ width: `${Math.max(4, (r.costCents / max) * 100)}%` }} /></div>
          <div className="ug-meta">{r.count.toLocaleString()} runs</div>
          <div className="ug-cost">{usd(r.costCents)}</div>
        </div>
      ))}
    </Panel>
  );
}

function UsageRecent({ usage }: { usage: SettingsUsageView }) {
  const rows = usage.recent;
  if (!rows.length) return <UsageEmpty label="No recent runs yet." />;
  return (
    <Panel title="Recent runs" tag={usageTag(usage.isDemo)} foot="ai_usage_events · newest first">
      {rows.map((r, i) => (
        <div className="usagerow rec" key={`${r.occurredAt}-${i}`}>
          <div className="ug-time">{relTime(r.occurredAt)}</div>
          <div className="ug-model">
            <div className="ug-name" title={r.model}>{r.model}</div>
            <div className="ug-sub">{r.service}{r.tokens ? ` · ${r.tokens.toLocaleString()} tok` : ""} · {r.actor}</div>
          </div>
          <div className="ug-cost">{usd(r.costCents)}</div>
        </div>
      ))}
    </Panel>
  );
}

// ---- Metered-connector spend (BSR-372): per-connector spend, remaining budget,
//      and the spend-cap editor. Raising the cap is the operator's explicit
//      approval of more metered spend. free / byo_key connectors never appear here.
// Keyed on the server cap (see call site) so a saved/revalidated cap re-seeds the
// input via remount — no setState-in-effect (cascading-render lint rule).
function ConnectorSpendPanel({ spend }: { spend: ConnectorSpendView | null }) {
  const [cap, setCap] = useState(String(spend?.capDollars ?? 50));
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(null);

  if (!spend) return <UsageEmpty label="Connector spend appears here once a metered connector is enabled." />;
  const rows = spend.rows;
  const maxCost = Math.max(...rows.map((r) => r.costCents), 1);
  const barTone = spend.isOverCap ? "var(--red-text)" : spend.isNearCap ? "var(--warn)" : undefined;

  async function save() {
    setPending(true);
    setStatus(null);
    const res = await setConnectorSpendCap({ capDollars: Number(cap) });
    setPending(false);
    setStatus(toStatus(res, `Spend cap set to $${Number(cap || 0).toFixed(0)}.`));
  }

  return (
    <>
      <Panel title="Metered connector spend" tag={usageTag(spend.isDemo)} foot="This workspace · this month">
        <div style={{ padding: 4 }}>
          {/* The second of two `.ukpis` rows in this file — the widened guard
              found this one after the first was converted. */}
          <KpiStrip
            items={[
              { label: "Spent", value: spend.spentLabel },
              { label: "Remaining", value: spend.remainingLabel },
              { label: "Spend cap", value: spend.capLabel },
            ]}
          />
          <div className="ubar"><i style={{ width: `${Math.min(spend.pctOfCap, 100)}%`, ...(barTone ? { background: barTone } : {}) }} /></div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 7 }}>
            {spend.pctOfCap}% of your {spend.capLabel} cap · {spend.periodLabel}
            {spend.isOverCap ? " · cap reached — metered runs are refused until you raise it" : spend.isNearCap ? " · nearing your cap" : ""}
          </div>
        </div>
      </Panel>

      <Panel title="Spend cap" foot="Raising the cap is how you approve more spend. Anything over it is refused.">
        {!spend.configured && <div style={{ fontSize: 11.5, color: "var(--muted)", padding: "10px 0 4px", lineHeight: 1.5 }}>You’re previewing without a connected workspace — changes won’t persist here.</div>}
        <Row label="Monthly cap" desc="Paid data lookups (contact details, property records) can spend up to this each month. Anything that would go over is refused — raising the cap is how you approve the extra spend.">
          <span className="pillrow" style={{ alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>$</span>
            <input className="inp" style={{ minWidth: 0, width: 96 }} type="number" min={0} step={5} value={cap} onChange={(e) => setCap(e.target.value)} />
            <button className="btn sm gold" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save cap"}</button>
          </span>
        </Row>
        {status && <div style={{ padding: "8px 0 2px" }}><Status status={status} /></div>}
      </Panel>

      <Panel title="By connector" tag={usageTag(spend.isDemo)} foot="metered connectors only · free / your-key connectors never bill">
        {rows.map((r) => (
          <div className="usagerow" key={r.key}>
            <div style={{ flex: "0 0 180px", minWidth: 0 }}>
              <div className="ug-name" title={r.key}>{r.label}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.disclosure ?? "metered"}
              </div>
            </div>
            <div className="ug-bar"><i style={{ width: `${Math.max(4, (r.costCents / maxCost) * 100)}%` }} /></div>
            <div className="ug-meta">{r.count ? `${r.count} run${r.count === 1 ? "" : "s"} · ${r.units.toLocaleString()} lookups` : "no spend yet"}</div>
            <div className="ug-cost">{r.costLabel}</div>
          </div>
        ))}
      </Panel>
    </>
  );
}
