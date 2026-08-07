import Link from "next/link";
import { notFound } from "next/navigation";

import { entityTypeFromCrmObjectKey, isPipelineObjectKey, orderedStages, type CustomFieldObjectKey } from "@/domain";
import { getCustomFieldsForRecord } from "@/lib/custom-fields/values";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getCrmRecordData, type CrmObjectKey } from "@/lib/crm/read-model";
import { getRecordNotes, getRecordTasks, getRecordTimeline } from "@/lib/interactions/read-model";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { getPipelineStages } from "@/lib/pipeline-stages/read-model";
import { getProductLanguage } from "@/lib/product-language";
import { getAppSettings } from "@/lib/settings/store";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";

import { RecordView, type RecordActivity } from "./_components/record-view";
import { CustomRecordView } from "./_components/custom-record-view";
import { getCustomObjectByKey } from "@/lib/custom-objects/definitions";
import { getCustomRecord } from "@/lib/custom-objects/records";
import { reportDegraded } from "@/lib/observability/report-degraded";
import "./record.css";

export const metadata = { title: "Record — Arc CRM" };

const VALID_KEYS: CrmObjectKey[] = ["companies", "contacts", "properties", "leads", "jobs", "outcomes"];

const EMPTY_ACTIVITY: RecordActivity = { timeline: [], notes: [], tasks: [] };

export default async function CrmRecordPage({
  params,
}: {
  params: Promise<{ objectKey: string; recordId: string }>;
}) {
  const { objectKey, recordId } = await params;
  // A key that is not one of the six may still be a tenant-defined type. The
  // built-in wins on purpose — that is why those keys are reserved when a
  // custom object is created.
  if (!VALID_KEYS.includes(objectKey as CrmObjectKey)) {
    return <CustomRecordPage objectKey={objectKey} recordId={decodeURIComponent(recordId)} />;
  }

  const id = decodeURIComponent(recordId);
  const record = await getCrmRecordData(objectKey as CrmObjectKey, id, undefined, "Arc");
  if (record.status === "not_found") notFound();
  // The workspace's own word for its CRM — "Matters", "Accounts", "Customers".
  // Resolved before the early return below, which also renders the back-link.
  const ctxForLabel = await getCurrentWorkspaceContext().catch(() => null);
  const [settingsForLabel, profileForLabel] = ctxForLabel?.orgId
    ? await Promise.all([
        // Vocabulary, as on /crm: failing these relabels the record's own
        // back-link and object nouns to our internal ones without looking broken.
        getAppSettings(ctxForLabel.orgId).catch((error) => {
          reportDegraded(error, { scope: "crm.record.getAppSettings", surface: "secondary" });
          return null;
        }),
        getBusinessProfile(ctxForLabel.orgId).catch((error) => {
          reportDegraded(error, { scope: "crm.record.getBusinessProfile", surface: "secondary" });
          return null;
        }),
      ])
    : [null, null];
  const crmLabel = getProductLanguage(settingsForLabel?.industry || profileForLabel?.industry, settingsForLabel?.objectLabels).crmLabel;

  if (record.status !== "live") {
    return (
      <div className="arc-record">
        <div className="recband">
          <Link className="back" href="/crm">
            <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: '<path d="M15 5l-7 7 7 7"/>' }} />
            Back to {crmLabel}
          </Link>
          <p style={{ padding: "24px 4px", color: "var(--muted)" }}>{record.message}</p>
        </div>
      </div>
    );
  }

  // Real interactions for the Activity tab, scoped to this record. Each degrades
  // to empty on its own so an unavailable feed never takes the record down.
  const entityType = entityTypeFromCrmObjectKey(objectKey);
  let activity: RecordActivity = EMPTY_ACTIVITY;
  if (entityType) {
    const orgId = (await getCurrentWorkspaceContext()).orgId;
    const [timeline, notes, tasks] = await Promise.all([
      // PRIMARY, despite being a tab. A failure here doesn't show an error — it
      // renders "no activity yet", which is a false STATEMENT ABOUT A CUSTOMER
      // rather than a missing panel. An operator reading "no notes, no calls"
      // concludes nobody has followed up and acts on that. Wrong data that
      // drives a decision is the worst degraded state in the app.
      getRecordTimeline(entityType, id, orgId).catch((error) => {
        reportDegraded(error, { scope: "crm.record.timeline", surface: "primary", detail: { entityType, id } });
        return null;
      }),
      getRecordNotes(entityType, id, orgId).catch((error) => {
        reportDegraded(error, { scope: "crm.record.notes", surface: "primary", detail: { entityType, id } });
        return null;
      }),
      getRecordTasks(entityType, id, orgId).catch((error) => {
        reportDegraded(error, { scope: "crm.record.tasks", surface: "primary", detail: { entityType, id } });
        return null;
      }),
    ]);
    activity = {
      timeline: timeline?.status === "live" ? timeline.entries : [],
      notes: notes?.status === "live" ? notes.notes : [],
      tasks: tasks?.status === "live" ? tasks.tasks : [],
    };
  }

  // Correctly silent (BSR-546): picker options. An empty dropdown is visible.
  const personaOptions = await getOrgPersonaOptions().catch(() => []);

  // The org's own stages, so the edit picker offers this tenant's vocabulary
  // rather than a hardcoded list that may no longer map to anything.
  const stageOptions =
    ctxForLabel?.orgId && isPipelineObjectKey(objectKey)
      ? orderedStages(await getPipelineStages(ctxForLabel.orgId, objectKey)).map((s) => ({
          key: s.key,
          label: s.label,
        }))
      : undefined;

  // The tenant's own custom fields for this object, with this record's values.
  // Degrades to empty on its own: a record must still render if the field layer
  // is unavailable (or its migration hasn't been applied yet).
  const customFields = ctxForLabel?.orgId
    ? await getCustomFieldsForRecord(ctxForLabel.orgId, objectKey as CustomFieldObjectKey, id).catch(
        () => [],
      )
    : [];

  return <RecordView
      crmLabel={crmLabel}
      customFields={customFields}
      record={record} activity={activity} personaOptions={personaOptions} stageOptions={stageOptions} />;
}


/**
 * A record of a tenant-defined object type.
 *
 * Split out rather than branched inline: almost none of the built-in page's
 * loads apply — no pipeline stages, no personas, no relationship graph, no
 * interactions — and running them for an object that has none would be a page
 * of empty panels built from six wasted queries.
 */
async function CustomRecordPage({ objectKey, recordId }: { objectKey: string; recordId: string }) {
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  const orgId = ctx?.orgId ?? "";
  const object = await getCustomObjectByKey(orgId, objectKey).catch(() => null);
  if (!object) notFound();

  const record = await getCustomRecord(orgId, object, recordId).catch(() => null);
  if (!record) notFound();

  const [customFields, appSettings, businessProfile] = await Promise.all([
    getCustomFieldsForRecord(orgId, objectKey as CustomFieldObjectKey, recordId).catch(() => []),
    getAppSettings(orgId).catch(() => null),
    orgId ? getBusinessProfile(orgId).catch(() => null) : Promise.resolve(null),
  ]);
  const { crmLabel } = getProductLanguage(
    appSettings?.industry || businessProfile?.industry,
    appSettings?.objectLabels,
  );

  return (
    <CustomRecordView
      objectKey={object.key}
      objectLabel={object.labelPlural}
      singularLabel={object.labelSingular}
      crmLabel={crmLabel}
      record={{
        id: record.id,
        title: record.title,
        subtitle: record.subtitle,
        updatedAt: record.updatedAt,
        archivedAt: record.archivedAt,
      }}
      customFields={customFields}
    />
  );
}
