import { getArcChatModel } from "@/lib/arc-chat/read-model";
import { getMentionables } from "@/lib/arc-chat/mention-search";
import { buildArcWaitingOpportunities } from "@/lib/arc-chat/waiting-opps";
import { getCurrentWorkspaceContext } from "@/lib/auth/workspace";
import { resolveViewerName } from "@/lib/auth/display-name";
import { getEmailConnection } from "@/lib/connections/read-model";
import { getSettingsConnectorsView } from "@/lib/connectors/settings-connectors";
import { isLiveSendEnabled } from "@/lib/dispatch/live-send";
import { getWorkspaceArcSkills } from "@/lib/arc-skills/github";
import { getInstalledArcSkillKeys } from "@/lib/arc-skills/installation";
import { listGeneratedSkills } from "@/lib/exemplar-skills/persistence";
import { getSupabaseAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getWorkspaceSummary } from "@/lib/workspace-summary/read-model";
import { getWorkspaceMediaConfig } from "@/lib/media-config/read-model";
import { resolveWorkspaceEngines } from "@/lib/media-config/target";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/server";
import { DEFAULT_MEDIA_CONFIG } from "@/domain";

import { ArcView } from "./_components/arc-view";
import "./arc.css";

export const metadata = { title: "Arc Chat — Arc Studio" };

export default async function ArcPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; new?: string; prompt?: string }>;
}) {
  const sp = await searchParams;
  // Deep-link support: `?prompt=` prefills the composer (e.g. the campaign
  // "Ask Arc to draft it" CTA). Capped so a crafted URL can't stuff the box.
  const initialDraft = typeof sp.prompt === "string" && sp.prompt.trim() ? sp.prompt.slice(0, 4000) : undefined;
  // Correctly silent (BSR-546): (app)/layout.tsx is the auth boundary; a null
  // context here renders a coherent empty state, not a false claim about data.
  const ctx = await getCurrentWorkspaceContext().catch(() => null);
  // The operator's own workspace name — never a hardcoded tenant. Arc is a
  // multi-tenant product; a workspace with no name falls through to a neutral
  // greeting ("there") in the view rather than borrowing another company's brand.
  const brandName = ctx?.orgName?.trim() || "";
  // Greet the operator by first name (as Home does) so opening Arc reads like a
  // personal workspace, not a product splash. Falls back to the brand name in
  // open/demo mode where there's no signed-in person to resolve.
  const viewerName = ctx?.orgId
    ? await resolveViewerName(ctx.orgId, await getSupabaseAuthenticatedUser().catch(() => null)).catch(() => "")
    : "";
  const operatorName = viewerName.trim().split(/\s+/)[0] || brandName;

  const [chat, mentionGroups, summary, connectors, emailConnection, installedSkillKeys, workspaceSkills, generatedSkills] = await Promise.all([
    getArcChatModel(sp.c ?? null, { startBlank: Boolean(sp.new) }),
    getMentionables(),
    // Cheap here: getWorkspaceSummary is request-cached and the nav rail already
    // computes it, so this is a cache hit. Best-effort — no summary just hides the
    // launcher's "waiting on you" strip.
    ctx?.orgId ? getWorkspaceSummary(ctx.orgId, "Arc", ctx.workspaceId).catch(() => null) : Promise.resolve(null),
    getSettingsConnectorsView().catch(() => ({ configured: false, connectors: [] })),
    getEmailConnection().catch(() => null),
    getInstalledArcSkillKeys(ctx?.orgId).catch(() => []),
    getWorkspaceArcSkills(ctx?.orgId).catch(() => []),
    listGeneratedSkills(ctx?.orgId).catch(() => []),
  ]);

  // `live` = a real backend is present (conversations may still be empty on a
  // fresh workspace — the composer works either way). Only "not_configured"
  // (no Supabase, e.g. the local backend-less preview) falls back to the mock.
  // A genuine failure is "error", which keeps the real composer rather than
  // quietly showing mock data in place of a broken workspace.
  const live = chat.status !== "not_configured";

  // The workspace's generation default + which engines it can reach, so the
  // composer's media-model pill offers what this workspace can actually run.
  //
  // Correctly silent: both degrade to a usable shape, and the pill hides itself
  // entirely when no engine is reachable rather than listing dead options.
  const [mediaConfig, mediaEngines] = ctx?.workspaceId && isSupabaseAdminConfigured()
    ? await Promise.all([
        getWorkspaceMediaConfig(getSupabaseAdminClient(), ctx.workspaceId).catch(() => DEFAULT_MEDIA_CONFIG),
        resolveWorkspaceEngines(getSupabaseAdminClient(), ctx.workspaceId).catch(() => ({ gemini: false, higgsfield: false })),
      ])
    : [DEFAULT_MEDIA_CONFIG, { gemini: false, higgsfield: false }];
  const waiting = summary
    ? {
        approvals: summary.approvals.length,
        opportunities: summary.opportunities.length,
        // Surface the top waiting opportunities as tappable nudges — the proactive
        // "draft the next iteration" prompts greet the operator on open.
        items: buildArcWaitingOpportunities(summary.opportunities),
      }
    : null;

  return (
    <ArcView
      key={sp.new ? "new" : sp.c ?? "default"}
      brandName={brandName}
      operatorName={operatorName}
      live={live}
      historyLoadError={chat.status === "error" ? chat.message : null}
      threadGroups={chat.status === "live" ? chat.threadGroups : []}
      messages={chat.status === "live" ? chat.messages : []}
      activeConversationId={chat.status === "live" ? chat.activeConversationId : null}
      mentionGroups={mentionGroups}
      waiting={waiting}
      initialDraft={initialDraft}
      initialDemoConversationId={sp.new ? "new" : sp.c}
      connectorsConfigured={connectors.configured}
      connectors={connectors.connectors}
      emailConnection={emailConnection}
      liveSendEnabled={isLiveSendEnabled()}
      installedSkillKeys={installedSkillKeys}
      workspaceSkills={workspaceSkills}
      generatedSkills={generatedSkills}
      workspaceName={ctx?.workspaceName || brandName}
      mediaConfig={mediaConfig}
      mediaEngines={mediaEngines}
    />
  );
}
