import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { Config } from "./config";
import { createArcClient } from "./arc-client";
import { handleCampaignTask, handleChatMessage, handleOpportunityDraft, handleOpportunityScan } from "./handler";
import { createFairScheduler } from "./scheduler";
import { verifySignature } from "./verify";
import type { ArcCampaignTaskPayload, ArcOpportunityDraftPayload, ArcOpportunityScanPayload, MarkChatMessagePayload, WakePayload } from "./types";

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createRunnerServer(config: Config) {
  // Bounded, per-tenant-fair scheduler shared by every wake this instance handles.
  const scheduler = createFairScheduler({
    maxConcurrent: config.maxConcurrentRuns,
    maxPerWorkspace: config.maxConcurrentRunsPerWorkspace,
  });

  return createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    const method = req.method ?? "GET";

    if (method === "GET" && (url === "/health" || url === "/")) {
      // `commit` answers the question this endpoint could not: which build is
      // actually running. Without it, "did my change deploy?" had no answer
      // from outside — the response was identical before and after a deploy,
      // and identical to one that never happened.
      sendJson(res, 200, { ok: true, service: "arc-runner", commit: config.commit, scheduler: scheduler.stats() });
      return;
    }

    if (method === "POST" && url === config.webhookPath) {
      console.log(`[arc-runner] POST ${url} received`);
      const rawBody = await readRawBody(req).catch(() => "");

      if (config.webhookSecret) {
        const header = req.headers["x-webhook-signature"];
        const signature = Array.isArray(header) ? header[0] : header;
        if (!verifySignature(rawBody, signature, config.webhookSecret)) {
          console.warn("[arc-runner] wake REJECTED: bad/missing signature (app's webhook secret must match the runner's ARC_WEBHOOK_SECRET)");
          sendJson(res, 401, { ok: false, error: "invalid_signature" });
          return;
        }
      }

      let payload: WakePayload;
      try {
        payload = JSON.parse(rawBody) as WakePayload;
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid_json" });
        return;
      }

      if (payload.type === "ping") {
        sendJson(res, 200, { ok: true, status: "pong" });
        return;
      }

      // One client per wake, carrying this wake's tenant identity so every callback
      // is scoped to the right workspace (see arc-client.ts / the app's arcGuard).
      const identity = payload as { orgId?: string; workspaceId?: string };
      const client = createArcClient(config, { orgId: identity.orgId, workspaceId: identity.workspaceId });
      // Fairness/backpressure key: one workspace's flood can't starve the others.
      const workspaceKey = identity.workspaceId ?? "default";

      if (payload.type === "arc_chat_message") {
        // Ack the wake instantly (the app times out at ~6s), then run Arc through
        // the bounded, per-tenant-fair scheduler and post the reply out-of-band.
        // The /arc UI poll surfaces the reply when it lands.
        sendJson(res, 200, { ok: true, status: "accepted" });
        scheduler.schedule(workspaceKey, () => handleChatMessage(client, config, payload as MarkChatMessagePayload));
        return;
      }

      if (payload.type === "arc_opportunity_draft") {
        sendJson(res, 200, { ok: true, status: "accepted" });
        scheduler.schedule(workspaceKey, () => handleOpportunityDraft(client, config, payload as ArcOpportunityDraftPayload));
        return;
      }

      if (payload.type === "arc_opportunity_scan") {
        sendJson(res, 200, { ok: true, status: "accepted" });
        scheduler.schedule(workspaceKey, () => handleOpportunityScan(client, config, payload as ArcOpportunityScanPayload));
        return;
      }

      if (payload.type === "arc_campaign_task") {
        sendJson(res, 200, { ok: true, status: "accepted" });
        scheduler.schedule(workspaceKey, () => handleCampaignTask(client, config, payload as ArcCampaignTaskPayload));
        return;
      }

      sendJson(res, 200, { ok: true, status: "ignored" });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  });
}
