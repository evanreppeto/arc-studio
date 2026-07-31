import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const envPath = join(process.cwd(), ".env.local");
  const envText = readFileSync(envPath, "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

function getSupabase() {
  loadLocalEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function insertOne(supabase, table, values) {
  const { data, error } = await supabase.from(table).insert(values).select("id").single();

  if (error) {
    throw new Error(`${table} insert failed: ${error.message}`);
  }

  return data.id;
}

// agents is org-scoped but has no workspace_id column, so org_id is set
// explicitly. The conflict target must stay (org_id, key) to match the per-org
// unique; targeting "key" alone would resolve against another tenant's agent
// row and overwrite it.
async function upsertAgent(supabase, orgId) {
  const { data, error } = await supabase
    .from("agents")
    .upsert(
      {
        org_id: orgId,
        key: "arc-demo",
        name: "Arc Demo Orchestrator",
        description: "Seed/demo agent that creates reviewable lead and campaign work before live Arc is connected.",
        status: "ready",
        allowed_actions: [
          "create_lead_draft",
          "create_campaign_draft",
          "create_approval_item",
          "write_agent_audit_log",
        ],
        blocked_actions: ["send_email", "send_sms", "publish_social_post", "change_ad_spend"],
        default_approval_policy: "human_required_before_outbound",
        system_instructions:
          "Create structured growth work in draft states. Never send, publish, or spend without approval.",
        metadata: {
          autonomy_level: 2,
          seeded_by: "scripts/seed-arc-demo.mjs",
        },
      },
      { onConflict: "org_id,key" },
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(`agents upsert failed: ${error.message}`);
  }

  return data.id;
}

async function seedArcDemo() {
  const supabase = getSupabase();
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const sourceSystem = "arc_demo_seed";
  const persona = "persona_plumbing_partner";

  // Light variety so repeated runs build a realistic pipeline (pass SEED_INDEX to pick one).
  const SCENARIOS = [
    { company: "Rapid Response Plumbing", first: "Jordan", last: "Vega", title: "Operations Manager", score: 91, phone: "312-555-0142" },
    { company: "Lakeside Mechanical", first: "Priya", last: "Nasser", title: "Dispatch Lead", score: 78, phone: "312-555-0177" },
    { company: "Halsted Drain & Sewer", first: "Marcus", last: "Ellison", title: "Owner", score: 88, phone: "312-555-0119" },
    { company: "North Shore Pipeworks", first: "Dana", last: "Okafor", title: "General Manager", score: 73, phone: "312-555-0164" },
    { company: "Windy City Plumbing Co", first: "Sam", last: "Reyes", title: "Service Manager", score: 84, phone: "312-555-0188" },
    { company: "Ravenswood Rooter", first: "Alex", last: "Chen", title: "Partner", score: 94, phone: "312-555-0133" },
    { company: "Southside Water & Gas", first: "Tasha", last: "Boyd", title: "Operations", score: 69, phone: "312-555-0155" },
    { company: "Cicero Plumbing Partners", first: "Diego", last: "Marin", title: "Owner", score: 82, phone: "312-555-0146" },
  ];
  const s = SCENARIOS[Number(process.env.SEED_INDEX ?? 0) % SCENARIOS.length];

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", "big-shoulders-restoration")
    .single();
  if (orgError || !org) throw new Error("Seed requires the big-shoulders-restoration organization (run the tenancy migration first).");
  const orgId = org.id;

  const { data: ws, error: wsError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("org_id", orgId)
    .eq("key", "default")
    .single();
  if (wsError || !ws) throw new Error("Seed requires the default workspace for big-shoulders-restoration.");
  const workspaceId = ws.id;

  const agentId = await upsertAgent(supabase, orgId);

  const companyId = await insertOne(supabase, "companies", {
    name: s.company,
    persona,
    org_id: orgId,
    status: "active",
    website_url: "https://example-plumbing.local",
    phone: "312-555-0142",
    email: "dispatch@example-plumbing.local",
    partner_tier: "A",
    metadata: {
      demo_seed: true,
      run_id: runId,
      source_note: "High-fit plumbing partner discovered in a target Chicago ZIP cluster.",
      service_area_zips: ["60618", "60625", "60647"],
    },
  });

  const contactId = await insertOne(supabase, "contacts", {
    company_id: companyId,
    persona,
    org_id: orgId,
    status: "active",
    first_name: s.first,
    last_name: s.last,
    email: `${s.first.toLowerCase()}.${s.last.toLowerCase()}.${runId}@example-plumbing.local`,
    phone: s.phone,
    title: s.title,
    metadata: {
      demo_seed: true,
      run_id: runId,
      relationship_stage: "new_target",
      confidence_score: 86,
    },
  });

  const leadId = await insertOne(supabase, "leads", {
    company_id: companyId,
    contact_id: contactId,
    persona,
    org_id: orgId,
    status: "needs_review",
    routing_recommendation: "target",
    source: "arc_demo",
    external_lead_id: `arc-demo-plumbing-${runId}`,
    loss_summary:
      "Plumbing company in priority Chicago ZIPs. Arc recommends partner outreach for water-loss referral handoff.",
    loss_signals: ["water_backup", "burst_pipe", "emergency_service"],
    matched_target_keywords: ["plumber", "water damage", "emergency repair"],
    matched_non_target_keywords: [],
    lead_score: s.score,
    metadata: {
      demo_seed: true,
      run_id: runId,
      confidence_score: 84,
      reason_found:
        "Service area overlaps high-opportunity Chicago ZIPs and business profile suggests after-hours plumbing calls.",
      recommended_action: "Approve lead and review partner outreach campaign draft.",
      evidence_urls: ["https://example-plumbing.local"],
    },
  });

  const campaignId = await insertOne(supabase, "campaigns", {
    name: `${s.company} — Referral Outreach`,
    org_id: orgId,
    persona,
    restoration_focus: "water_backup",
    status: "pending_approval",
    company_id: companyId,
    contact_id: contactId,
    lead_id: leadId,
    owner: "Arc Demo",
    objective: "Create a referral relationship with a high-fit plumbing partner.",
    audience_summary: "Chicago plumbing operators who encounter active water damage before restoration teams.",
    offer_summary: "Fast handoff, documentation, and customer relationship protection for water-loss referrals.",
    compliance_notes: "Coverage-neutral. No insurance claim outcome promises. No guaranteed response time claims.",
    source_system: sourceSystem,
    external_campaign_id: `arc-demo-campaign-${runId}`,
    launch_locked: true,
    campaign_phase: "partner_reactivation",
    source_signal: {
      demo_seed: true,
      run_id: runId,
      lead_id: leadId,
      score: 88,
    },
    reasoning_payload: {
      why_now: "Partner fit is high and target ZIP overlap makes referral timing useful.",
      target_persona: persona,
      recommended_channels: ["email", "sms"],
    },
    audit_payload: {
      created_by_agent_id: agentId,
      outbound_locked: true,
    },
  });

  // Personalize from the scenario record, exactly like the company/contact rows
  // above. This used to hardcode "Hi Jordan," — scenario 0's first name — so every
  // seeded partner email greeted the wrong person and all bodies came out
  // byte-identical, which reads as a generation bug when you look at the data.
  const draftBody = [
    "Subject: Fast water-loss handoff for your plumbing customers",
    "",
    `Hi ${s.first},`,
    "",
    `When ${s.company} stops the source of a water issue, Big Shoulders Restoration can help with the mitigation, documentation, and rebuild coordination that protects the customer relationship you already earned.`,
    "",
    "Would it be useful to set up a simple referral handoff process for active water backups, burst pipes, or standing-water calls in your service area?",
    "",
    "Best,",
    "Big Shoulders Restoration",
  ].join("\n");

  const campaignAssetId = await insertOne(supabase, "campaign_assets", {
    org_id: orgId,
    campaign_id: campaignId,
    asset_type: "email",
    channel: "email",
    title: `Initial ${s.company} referral email`,
    status: "pending_approval",
    source_system: sourceSystem,
    external_asset_id: `arc-demo-email-${runId}`,
    tool_source: "Arc Demo Orchestrator",
    prompt_input:
      "Draft coverage-neutral first-touch copy for a plumbing partner referral relationship.",
    prompt_inputs: {
      persona,
      channel: "email",
      tone: "professional, direct, partner-protective",
      cta: "Set up referral handoff process",
      urgency: "medium",
      damage_classification: "water_backup",
    },
    draft_body: draftBody,
    dispatch_locked: true,
    compliance_notes: "No coverage promise detected. No claim approval language detected.",
    reasoning_payload: {
      message_angle: "Protect the plumber relationship while BSR handles mitigation.",
      do_not_say: ["insurance will cover it", "guaranteed payout", "claim approval"],
    },
    audit_payload: {
      demo_seed: true,
      run_id: runId,
      created_by_agent_id: agentId,
    },
  });

  const approvalItemId = await insertOne(supabase, "approval_items", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: campaignAssetId,
    company_id: companyId,
    contact_id: contactId,
    lead_id: leadId,
    item_type: "email_campaign_asset",
    status: "pending_owner_approval",
    approval_required: true,
    locked_until_approved: true,
    prompt_inputs: {
      persona,
      target_audience: "Chicago plumbing partner",
      related_company_id: companyId,
      related_contact_id: contactId,
      related_lead_id: leadId,
      guardrail_summary: "coverage-neutral language required",
    },
    draft_output: draftBody,
    requested_by: "Arc Demo Orchestrator",
    risk_level: "medium",
    compliance_notes:
      "Review before outbound. Draft avoids insurance coverage guarantees and asks for a referral process conversation.",
    reasoning_payload: {
      why_arc_created_it:
        "The lead scored 88 because it matches the plumbing partner persona, service area, and likely water-loss referral context.",
      recommended_action: "Approve lead and edit/approve the first-touch email if brand voice is acceptable.",
      source_data: {
        company_id: companyId,
        contact_id: contactId,
        lead_id: leadId,
      },
    },
    audit_payload: {
      demo_seed: true,
      run_id: runId,
      created_by_agent_id: agentId,
      outbound_locked: true,
    },
  });

  await supabase.from("campaigns").update({ approval_item_id: approvalItemId }).eq("id", campaignId);

  const agentTaskId = await insertOne(supabase, "agent_tasks", {
    agent_id: agentId,
    org_id: orgId,
    workspace_id: workspaceId,
    status: "needs_approval",
    priority: "high",
    // Names the partner. This is the string a human scans in the task queue, and
    // an un-personalized template made nine DISTINCT seeded tasks (nine companies,
    // nine campaigns, nine approval items) read as one duplicated row.
    objective: `Prepare the ${s.company} partner lead and first-touch campaign draft for human review.`,
    task_type: "lead_discovery_campaign_draft",
    source_type: "company",
    source_id: companyId,
    campaign_id: campaignId,
    approval_item_id: approvalItemId,
    completed_at: new Date().toISOString(),
    metadata: {
      demo_seed: true,
      run_id: runId,
      autonomy_level: 2,
      human_approval_required: true,
    },
  });

  await insertOne(supabase, "agent_task_inputs", {
    org_id: orgId,
    task_id: agentTaskId,
    input_type: "lead_discovery_signal",
    source_table: "leads",
    source_id: leadId,
    summary: `${s.company} — high-fit plumbing partner in priority Chicago ZIPs.`,
    payload: {
      persona,
      score: 88,
      evidence_urls: ["https://example-plumbing.local"],
      target_keywords: ["plumber", "water damage", "emergency repair"],
    },
  });

  const agentOutputId = await insertOne(supabase, "agent_outputs", {
    org_id: orgId,
    task_id: agentTaskId,
    approval_item_id: approvalItemId,
    campaign_asset_id: campaignAssetId,
    output_type: "approval_card",
    title: `Review the ${s.company} outreach draft`,
    body: draftBody,
    structured_payload: {
      company_id: companyId,
      contact_id: contactId,
      lead_id: leadId,
      campaign_id: campaignId,
      campaign_asset_id: campaignAssetId,
      approval_item_id: approvalItemId,
    },
    risk_level: "medium",
    compliance_status: "pending_owner_approval",
    approval_status: "pending_owner_approval",
  });

  await insertOne(supabase, "agent_run_logs", {
    org_id: orgId,
    task_id: agentTaskId,
    agent_id: agentId,
    run_status: "completed",
    model_provider: "seed",
    model_name: "arc-demo-seed",
    input_token_count: 0,
    output_token_count: 0,
    cost_estimate_cents: 0,
    reasoning_summary:
      "Seeded a linked company, contact, lead, campaign, asset, approval item, task input, output, and audit log for the first Arc approval workflow.",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    metadata: {
      demo_seed: true,
      run_id: runId,
      agent_output_id: agentOutputId,
    },
  });

  await insertOne(supabase, "campaign_events", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: campaignAssetId,
    approval_item_id: approvalItemId,
    event_type: "approval_submitted",
    actor: "Arc Demo Orchestrator",
    detail: "Demo campaign asset submitted for owner approval.",
    payload: {
      demo_seed: true,
      run_id: runId,
      agent_task_id: agentTaskId,
      agent_output_id: agentOutputId,
    },
  });

  return {
    runId,
    agentId,
    companyId,
    contactId,
    leadId,
    campaignId,
    campaignAssetId,
    approvalItemId,
    agentTaskId,
    agentOutputId,
  };
}

seedArcDemo()
  .then((result) => {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exit(1);
  });
