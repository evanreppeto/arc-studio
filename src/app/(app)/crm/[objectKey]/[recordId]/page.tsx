import Link from "next/link";
import { notFound } from "next/navigation";

import { entityTypeFromCrmObjectKey } from "@/domain";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getCrmRecordData, type CrmObjectKey } from "@/lib/crm/read-model";
import { getRecordNotes, getRecordTasks, getRecordTimeline } from "@/lib/interactions/read-model";
import { getOrgPersonaOptions } from "@/lib/personas/read-model";
import { getProductLanguage } from "@/lib/product-language";
import { getAppSettings } from "@/lib/settings/store";
import { getBusinessProfile } from "@/lib/brand-kit/persistence";

import { RecordView, type RecordActivity } from "./_components/record-view";
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
  if (!VALID_KEYS.includes(objectKey as CrmObjectKey)) notFound();

  const id = decodeURIComponent(recordId);
  const record = await getCrmRecordData(objectKey as CrmObjectKey, id, undefined, "Arc");
  if (record.status === "not_found") notFound();
  // The workspace's own word for its CRM — "Matters", "Accounts", "Customers".
  // Resolved before the early return below, which also renders the back-link.
  const ctxForLabel = await getCurrentWorkspaceContext().catch(() => null);
  const [settingsForLabel, profileForLabel] = ctxForLabel?.orgId
    ? await Promise.all([
        getAppSettings(ctxForLabel.orgId).catch(() => null),
        getBusinessProfile(ctxForLabel.orgId).catch(() => null),
      ])
    : [null, null];
  const crmLabel = getProductLanguage(settingsForLabel?.industry || profileForLabel?.industry).crmLabel;

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
      getRecordTimeline(entityType, id, orgId).catch(() => null),
      getRecordNotes(entityType, id, orgId).catch(() => null),
      getRecordTasks(entityType, id, orgId).catch(() => null),
    ]);
    activity = {
      timeline: timeline?.status === "live" ? timeline.entries : [],
      notes: notes?.status === "live" ? notes.notes : [],
      tasks: tasks?.status === "live" ? tasks.tasks : [],
    };
  }

  const personaOptions = await getOrgPersonaOptions().catch(() => []);

  return <RecordView
      crmLabel={crmLabel}
      record={record} activity={activity} personaOptions={personaOptions} />;
}
