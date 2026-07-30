import { reasonIfUnavailable, unavailable } from "@/lib/observability/unavailable";
import { humanizePersonaLabel, orderedStages, PIPELINE_OBJECT_KEYS, type PipelineObjectKey } from "@/domain";
import { getAnalyticsOverview } from "@/lib/analytics/overview";
import { getCurrentOrgId } from "@/lib/auth/org";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { getCrmMentionSamples, getCrmNavCounts, type CrmObjectKey, type CrmObjectRow } from "@/lib/crm/read-model";
import { listCampaignNames } from "@/lib/campaigns/read-model";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { getPipelineStages } from "@/lib/pipeline-stages/read-model";
import { getProductLanguage } from "@/lib/product-language";
import { getAppSettings } from "@/lib/settings/store";

import { type KpiCell } from "../_components/kpi-strip";
import { CrmBoard, type CrmObjectVM, type CrmRowVM } from "./_components/crm-board";
import type { CustomFieldDefinition, CustomFieldObjectKey } from "@/domain";
import { listFieldDefinitions } from "@/lib/custom-fields/definitions";
import { getCustomFieldsForRecords } from "@/lib/custom-fields/values";
import { reportDegraded } from "@/lib/observability/report-degraded";

/** How many custom fields become list columns. See the note at the call site. */
const MAX_CUSTOM_COLUMNS = 2;

export const metadata = { title: "CRM — Arc Studio" };

const OBJECT_KEYS: CrmObjectKey[] = ["companies", "contacts", "properties", "leads", "jobs", "outcomes"];

function initials(name: string): string {
  return (
    (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "•"
  );
}

function humanizePersona(persona: string): string {
  const label = humanizePersonaLabel(persona);
  return /^unassigned/i.test(label) ? "" : label;
}

function personaDot(persona: string): string {
  const p = (persona || "").toLowerCase();
  if (/emergency|urgent|storm|hail|flood|fire|burst|water\s*damage/.test(p)) return "#cc6a6a"; // red — urgent
  if (/insurance|adjuster|agent/.test(p)) return "#88b6d8"; // blue
  if (/plumb|partner|contractor|referral|vendor|trade|sub/.test(p)) return "#7fb89a"; // green
  if (/preventative|preventive|maintenance|monitor|inspection/.test(p)) return "#6fae9e"; // teal
  if (/rebuild|restoration|reconstruct|remodel|renov/.test(p)) return "#d8a24a"; // amber
  if (/hoa|board|association|landlord|tenant/.test(p)) return "#9678c8"; // purple
  if (/past|repeat|existing|customer|reactivat/.test(p)) return "#b58fd0"; // light purple
  if (/property|manager|realtor|commercial|reit/.test(p)) return "#c8a24a"; // gold
  return "#c8a24a"; // gold default
}

function scoreColor(score: number): string {
  if (score >= 70) return "var(--ok)";
  if (score >= 40) return "var(--accent)";
  return "var(--muted)";
}

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return value && !/^now$/i.test(value) ? value : "now";
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Absolute time for the second line of the "Last activity" cell (mockup: "10:42 AM" / "Jun 24").
function timeLabel(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toRow(row: CrmObjectRow): CrmRowVM {
  const persona = humanizePersona(row.personaTag);
  // Mockup subtitle is "role · location" (dot-separated, no email). Drop email
  // segments and the slash separators the read-model emits.
  const detailText = (row.detail || row.sourceLabel || "")
    .split(/\s*[/·]\s*/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("@"))
    .slice(0, 2)
    .join(" · ");
  return {
    id: row.id,
    name: row.name,
    detail: detailText,
    initials: initials(row.name),
    isCompany: row.objectKey === "companies",
    statusLabel: row.status || "—",
    statusTone: row.statusTone,
    persona,
    dot: personaDot(row.personaTag),
    score: typeof row.score === "number" ? Math.round(row.score) : null,
    scoreColor: typeof row.score === "number" ? scoreColor(row.score) : "var(--muted)",
    owner: row.owner || "—",
    updatedRel: relativeTime(row.updated),
    updatedTime: timeLabel(row.updated),
    href: row.href,
    company: (row.relationships.find((r) => /compan/i.test(r.label))?.value ?? "").replace(/\s+\d{8,}$/, "").trim(),
    value: row.valueLabel || "",
    tier: "",
    routing: "",
    tasks: row.openTasks ? `${row.openTasks} open` : "",
  };
}

export default async function CrmPage() {
  const orgId = await getCurrentOrgId().catch(() => "");
  const [samples, navCounts, overview, personaOptions, appSettings, businessProfile, campaigns] = await Promise.all([
    getCrmMentionSamples().catch(() => ({}) as Partial<Record<CrmObjectKey, CrmObjectRow[]>>),
    getCrmNavCounts().catch(unavailable("crm.navCounts", orgId)),
    // Correctly silent (BSR-546): the KPI strip and the pickers below are
    // enrichment around the record list. Their absence is VISIBLE — an empty
    // strip, an empty dropdown — so an operator can see something is off
    // without an alert, and the records themselves still render.
    orgId ? getAnalyticsOverview(orgId).catch(() => null) : Promise.resolve(null),
    getOrgPersonaOptions(orgId || undefined).catch(() => []),
    // These two carry the tenant's VOCABULARY (industry -> Matters / Assets /
    // Projects). Failing them doesn't blank the page — it silently relabels
    // every object back to our internal nouns, so a law firm's CRM quietly
    // becomes "Properties" again. Wrong output is worse than missing output,
    // because nothing looks broken. Reported as secondary: the page is still
    // usable, it is just speaking the wrong language.
    getAppSettings(orgId).catch((error) => {
      reportDegraded(error, { scope: "crm.getAppSettings", surface: "secondary", detail: { orgId } });
      return null;
    }),
    orgId
      ? getBusinessProfile(orgId).catch((error) => {
          reportDegraded(error, { scope: "crm.getBusinessProfile", surface: "secondary", detail: { orgId } });
          return null;
        })
      : Promise.resolve(null),
    listCampaignNames(orgId || undefined).catch(() => []),
  ]);

  // The org's own stage names, for the add/edit pickers. getPipelineStages
  // already falls back to the defaults rather than returning empty — an empty
  // status picker would block record creation outright.
  const stageOptions = Object.fromEntries(
    await Promise.all(
      PIPELINE_OBJECT_KEYS.map(async (key) => [
        key,
        orderedStages(await getPipelineStages(orgId, key)).map((s) => ({ key: s.key, label: s.label })),
      ]),
    ),
  ) as Record<PipelineObjectKey, { key: string; label: string }[]>;
  const productLanguage = getProductLanguage(appSettings?.industry || businessProfile?.industry);

  // A failed counts read is NOT an empty CRM. Without this the object tiles
  // render 0 across the board, indistinguishable from a workspace with no
  // records — the confusion that hid a live outage on /campaigns (BSR-542).
  const loadError = reasonIfUnavailable(navCounts);
  const counts = navCounts.status === "live" ? navCounts.counts : null;

  // Real KPI strip for the CRM header — leads volume, lead→won conversion, and
  // won revenue — from the same wired analytics computation the Analytics screen
  // uses (demo-safe; the strip is omitted entirely when unavailable).
  const kpis: KpiCell[] = [];
  if (overview) {
    const byLabel = (l: string) => overview.kpis.find((k) => k.label === l);
    const leadsK = byLabel("Leads");
    const revK = byLabel("Won revenue");
    const wonStage = overview.funnel.find((f) => f.label === "Won");
    if (leadsK)
      kpis.push({
        label: "Leads",
        value: leadsK.value,
        delta: { label: leadsK.deltaLabel, dir: leadsK.dir },
        spark: { points: overview.trend.leads.cur, up: leadsK.dir === "up" },
      });
    if (wonStage) kpis.push({ label: "Lead → won", value: wonStage.note });
    if (revK)
      kpis.push({
        label: "Won revenue",
        value: revK.value,
        delta: { label: revK.deltaLabel, dir: revK.dir },
        spark: { points: overview.trend.revenue.cur, up: revK.dir === "up" },
      });
  }

  const rowsByKey: Record<string, CrmRowVM[]> = {};
  const objects: CrmObjectVM[] = OBJECT_KEYS.map((key) => {
    const meta = productLanguage.crmObjects[key];
    const rows = (samples[key] ?? []).map(toRow);
    rowsByKey[key] = rows;
    return {
      key,
      label: meta.label,
      noun: meta.noun,
      nameHeader: meta.nameHeader,
      addLabel: `Add ${meta.singular}`,
      filterPlaceholder: `Filter ${meta.noun}…`,
      count: counts ? counts[key] : rows.length,
    };
  });

  // The tenant's custom fields: values onto each row (searchable + displayable)
  // and the column set per object. Capped at MAX_CUSTOM_COLUMNS columns because
  // the table's built-in columns are fixed-width; every field stays searchable
  // and is shown in full on the record page, so nothing is hidden outright.
  const customColumnsByKey: Record<string, { key: string; label: string }[]> = {};
  const customFieldDefsByKey: Record<string, CustomFieldDefinition[]> = {};
  if (orgId) {
    await Promise.all(
      OBJECT_KEYS.map(async (key) => {
        try {
          const definitions = await listFieldDefinitions(orgId, key as CustomFieldObjectKey);
          if (definitions.length === 0) return;
          customFieldDefsByKey[key] = definitions;
          customColumnsByKey[key] = definitions
            .slice(0, MAX_CUSTOM_COLUMNS)
            .map((d) => ({ key: d.key, label: d.label }));

          const rows = rowsByKey[key] ?? [];
          if (rows.length === 0) return;
          const byRecord = await getCustomFieldsForRecords(
            orgId,
            key as CustomFieldObjectKey,
            rows.map((r) => r.id),
          );
          for (const row of rows) {
            const entries = byRecord.get(row.id);
            if (!entries) continue;
            const map: Record<string, string> = {};
            for (const e of entries) if (e.display) map[e.definition.key] = e.display;
            if (Object.keys(map).length > 0) row.customFields = map;
          }
        } catch {
          // A missing/unavailable field layer must never take the CRM board
          // down — the board is the product's front door.
        }
      }),
    );
  }

  return <CrmBoard loadError={loadError} objects={objects} rowsByKey={rowsByKey} defaultKey="contacts" kpis={kpis} personaOptions={personaOptions} campaigns={campaigns} customColumnsByKey={customColumnsByKey} customFieldDefsByKey={customFieldDefsByKey} stageOptions={stageOptions} />;
}
