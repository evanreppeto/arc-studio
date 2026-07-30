import { NextResponse } from "next/server";

import { arcGuard } from "@/app/api/v1/arc/_lib/http";
import { appendArcStep } from "@/lib/arc-chat/persistence";
import { isSupabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Arc reports a live activity step for an in-flight chat reply. Appends to the
 * pending message's metadata.steps so the chat shows a live "what Arc is doing"
 * timeline. Bearer-gated like the other arc routes; outbound stays locked.
 *
 *   POST /api/v1/arc/messages/{agentTaskId}/steps
 *   body: { label: string, status?: "running" | "done" }
 */
export async function POST(request: Request, { params }: { params: Promise<{ agentTaskId: string }> }) {
  const allowed = await arcGuard(request);
  if (!allowed.ok) return allowed.response;
  const scope = { orgId: allowed.scope.orgId, workspaceId: allowed.scope.workspaceId };

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { ok: false, status: "not_configured", message: "Supabase admin env vars are required to record steps." },
      { status: 503 },
    );
  }

  const { agentTaskId } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, status: "rejected", message: "Request body must be valid JSON." }, { status: 400 });
  }

  const body = payload as { label?: unknown; status?: unknown; detail?: unknown };
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const status = body.status === "done" ? "done" : "running";
  // The reasoning that preceded this step, so the trace can pair each action
  // with the thinking that led to it. Capped: this is a glanceable line in the
  // transcript, not the whole thinking transcript.
  const detail = typeof body.detail === "string" ? body.detail.trim().slice(0, 600) : null;
  if (!label) {
    return NextResponse.json({ ok: false, status: "rejected", message: "label is required." }, { status: 400 });
  }

  try {
    const applied = await appendArcStep({ agentTaskId, label, status, at: new Date().toISOString(), detail }, undefined, scope);
    if (!applied) {
      return NextResponse.json({ ok: false, status: "not_found", message: "No pending message for that agentTaskId." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, status: "recorded" }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, status: "failed", message: error instanceof Error ? error.message : "Failed to record step." },
      { status: 502 },
    );
  }
}
