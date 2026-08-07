import { reasonIfUnavailable, unavailable } from "@/lib/observability/unavailable";
import { humanizePersonaLabel, orderedStages, PIPELINE_OBJECT_KEYS, type PipelineObjectKey } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";
import { getCrmMentionSamples, getCrmNavCounts, getCrmOverviewData, type CrmObjectKey, type CrmObjectRow } from "@/lib/crm/read-model";
import { listCampaignNames } from "@/lib/campaigns/read-model";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { getPipelineStages } from "@/lib/pipeline-stages/read-model";
import { getProductLanguage } from "@/lib/product-language";
import { getAppSettings } from "@/lib/settings/store";

import { type KpiCell } from "../_components/kpi-strip";
import { toRow } from "./_data/row-vm";
import { CrmBoard, type CrmObjectVM, type CrmRowVM } from "./_components/crm-board";
import type { CustomFieldDefinition, CustomFieldObjectKey } from "@/domain";
import { listFieldDefinitions } from "@/lib/custom-fields/definitions";
import { getCustomFieldsForRecords } from "@/lib/custom-fields/values";
import { reportDegraded } from "@/lib/observability/report-degraded";
import { listCustomObjects } from "@/lib/custom-objects/definitions";
import { countCustomRecords, listCustomRecords } from "@/lib/custom-objects/records";
import { customRecordToRow } from "./_data/custom-row-vm";

/** How many custom fields become list columns. See the note at the call site. */
const MAX_CUSTOM_COLUMNS = 2;

export async function generateMetadata() {
  const ctx = await getCurrentWorkspaceContext();
  const [appSettings, businessProfile] = await Promise.all([
    getAppSettings(ctx.orgId).catch(() => null),
    getBusinessProfile(ctx.orgId).catch(() => null),
  ]);
  const { crmLabel } = getProductLanguage(appSettings?.industry || businessProfile?.industry, appSettings?.objectLabels);
  return { title: `${crmLabel} — Arc Studio` };
}

const OBJECT_KEYS: CrmObjectKey[] = ["companies", "contacts", "properties", "leads", "jobs", "outcomes"];

export default async function CrmPage() {
  const tenant = await getCurrentWorkspaceContext().catch(() => null);
  const orgId = tenant?.orgId ?? "";
  const workspaceId = tenant?.workspaceId ?? null;
  const [samples, navCounts, overview, personaOptions, appSettings, businessProfile, campaigns] = await Promise.all([
    getCrmMentionSamples().catch(() => ({}) as Partial<Record<CrmObjectKey, CrmObjectRow[]>>),
    getCrmNavCounts().catch(unavailable("crm.navCounts", orgId)),
    // Correctly silent (BSR-546): the KPI strip and the pickers below are
    // enrichment around the record list. Their absence is VISIBLE — an empty
    // strip, an empty dropdown — so an operator can see something is off
    // without an alert, and the records themselves still render.
    getCrmOverviewData().catch(unavailable("crm.overview", orgId)),
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
    listCampaignNames(orgId || undefined, undefined, workspaceId).catch(() => []),
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
  const productLanguage = getProductLanguage(appSettings?.industry || businessProfile?.industry, appSettings?.objectLabels);

  // A failed counts read is NOT an empty CRM. Without this the object tiles
  // render 0 across the board, indistinguishable from a workspace with no
  // records — the confusion that hid a live outage on /campaigns (BSR-542).
  const loadError = reasonIfUnavailable(navCounts);
  const counts = navCounts.status === "live" ? navCounts.counts : null;

  // The KPI strip describes THESE records — the ones in the table below it.
  //
  // It used to read `getAnalyticsOverview`, a 30-day marketing funnel belonging
  // to the Analytics screen. On a live workspace that merely answered a
  // different question than the tabs did; in the offline preview the two came
  // from two independently authored fixture sets, and the header read
  // "Leads 710" directly above a Leads tab reading 11 (BSR-656).
  //
  // `getCrmOverviewData` is the CRM's own computation over the same source the
  // tabs count, so the header and the tabs cannot disagree in either mode.
  // Count-style metrics with no time series, which is what these are: the
  // `delta` line here is a qualifier ("3 need review"), not a percentage
  // change, so it belongs in `sublabel` rather than the trend slot.
  //
  // The NOUNS come from the same place the tabs get theirs. BSR-656 made the
  // header count the same records as the tabs; it still called them something
  // else, because the read-model has no vocabulary and hardcoded ours. Live,
  // that printed "Companies 8" directly above a tab reading "Organizations 8" —
  // one number, two names, and no way to tell they were the same thing. Every
  // industry template mismatched on at least one stat.
  const kpis: KpiCell[] =
    overview.status === "live"
      ? overview.stats.map((stat) => ({
          label: stat.objectKey
            ? [productLanguage.crmObjects[stat.objectKey].label, stat.qualifier].filter(Boolean).join(" ")
            : stat.label,
          value: typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value,
          sublabel: stat.delta,
        }))
      : [];

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

  // The workspace's OWN object types, appended after the six. A failed read is
  // reported rather than swallowed: returning none silently removes tabs the
  // operator created, which reads as data loss.
  const customObjects = await listCustomObjects(orgId).catch((error) => {
    reportDegraded(error, { scope: "crm.listCustomObjects", surface: "primary", detail: { orgId } });
    return [];
  });

  for (const object of customObjects) {
    try {
      const [records, count] = await Promise.all([
        listCustomRecords(orgId, object),
        countCustomRecords(orgId, object),
      ]);
      rowsByKey[object.key] = records.map((r) => customRecordToRow(object.key, r));
      objects.push({
        key: object.key,
        isCustom: true,
        label: object.labelPlural,
        noun: object.labelPlural.toLowerCase(),
        nameHeader: object.labelSingular,
        addLabel: `Add ${object.labelSingular.toLowerCase()}`,
        filterPlaceholder: `Filter ${object.labelPlural.toLowerCase()}…`,
        count,
      });
    } catch (error) {
      reportDegraded(error, { scope: "crm.customObjectRows", surface: "primary", detail: { orgId, object: object.key } });
    }
  }

  // The tenant's custom fields: values onto each row (searchable + displayable)
  // and the column set per object. Capped at MAX_CUSTOM_COLUMNS columns because
  // the table's built-in columns are fixed-width; every field stays searchable
  // and is shown in full on the record page, so nothing is hidden outright.
  const customColumnsByKey: Record<string, { key: string; label: string }[]> = {};
  const customFieldDefsByKey: Record<string, CustomFieldDefinition[]> = {};
  if (orgId) {
    await Promise.all(
      [...OBJECT_KEYS, ...customObjects.map((o) => o.key)].map(async (key) => {
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
        } catch (error) {
          // A missing/unavailable field layer must never take the CRM board
          // down — the board is the product's front door. But it must not go
          // quiet either: swallowing this renders the tenant's OWN schema as
          // simply absent, which reads as data loss rather than an outage. Keep
          // degrading, stop asserting — the same call the settings field panel
          // makes with the same read.
          reportDegraded(error, {
            scope: "crm.customFields",
            surface: "secondary",
            detail: { orgId, object: key },
          });
        }
      }),
    );
  }

  return <CrmBoard loadError={loadError} objects={objects} rowsByKey={rowsByKey} defaultKey="contacts" kpis={kpis} personaOptions={personaOptions} campaigns={campaigns} customColumnsByKey={customColumnsByKey} customFieldDefsByKey={customFieldDefsByKey} stageOptions={stageOptions} />;
}
