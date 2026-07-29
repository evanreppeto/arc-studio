import { reasonIfUnavailable, unavailable } from "@/lib/observability/unavailable";
import { headers } from "next/headers";

import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { getJourneysReadModel } from "@/lib/journey/read-model";
import { getAppSettings } from "@/lib/settings/store";

import { JourneysView } from "./_components/journeys-view";

export const metadata = { title: "Journeys — Arc Studio" };

export default async function JourneysPage() {
  const [ctx, headerList] = await Promise.all([getCurrentWorkspaceContext().catch(() => null), headers()]);
  const [model, settings] = await Promise.all([
    getJourneysReadModel(undefined, ctx?.orgId).catch(unavailable("journeys.model", ctx?.orgId)),
    getAppSettings(ctx?.orgId),
  ]);
  // App origin for the copy-paste collector snippet, resolved server-side so the
  // install panel shows the real host with no client-side hydration mismatch.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const origin = host ? `${headerList.get("x-forwarded-proto") ?? "https"}://${host}` : "";
  // A failed read is NOT an empty journey history.
  const loadError = reasonIfUnavailable(model);
  return <JourneysView model={model} origin={origin} consentMode={settings.journeyConsentMode} loadError={loadError} />;
}
