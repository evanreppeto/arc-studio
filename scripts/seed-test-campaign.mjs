import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function getSupabase() {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function insertOne(supabase, table, values) {
  const { data, error } = await supabase.from(table).insert(values).select("id").single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data.id;
}

const PERSONA = "persona_property_manager"; // verified present in persona_mapping enum

const ASSETS = [
  { asset_type: "landing_page", channel: "web", title: "Flood-ready landing page", draft_body: "Headline: Water in the building? We document, mitigate, and rebuild — fast.\nCTA: Request Vendor Packet." },
  { asset_type: "search_ad", channel: "google_ads", title: "Search ad — emergency water cleanup", draft_body: "Headline: 24/7 Water Damage Mitigation. Desc: Insurance-grade documentation for property managers." },
  { asset_type: "social_ad", channel: "meta_ad", title: "Social ad — property manager partner", draft_body: "Protect your North Shore portfolio. Priority response for managed buildings." },
  { asset_type: "email", channel: "email", title: "Partner intro email", draft_body: "Subject: Priority water-loss response for your North Shore properties\n\nHi {{first_name}},\n\nWhen a unit floods, your residents call you first. We give managed-building partners a documented, insurance-ready handoff.\n\nRequest the vendor packet to pre-approve us." },
  { asset_type: "sms", channel: "sms", title: "Follow-up SMS", draft_body: "Big Shoulders Restoration: your managed-building vendor packet is ready. Reply PACKET to receive it." },
  { asset_type: "video_prompt", channel: "media", title: "Video prompt — 30s testimonial", draft_body: "30s testimonial: property manager describes a burst-pipe night handled in 2 hours with full documentation." },
  { asset_type: "image_prompt", channel: "media", title: "Image prompt — before/after", draft_body: "Before/after of a restored basement common area; clean, professional, no people." },
  { asset_type: "one_pager", channel: "doc", title: "Vendor packet one-pager", draft_body: "Services, response SLA, insurance documentation process, references. For property-manager pre-approval." },
];

async function seedTestCampaign() {
  const supabase = getSupabase();
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", "big-shoulders-restoration")
    .single();
  if (orgError || !org) throw new Error("Seed requires the big-shoulders-restoration organization (run the tenancy migration first).");
  const orgId = org.id;

  const companyId = await insertOne(supabase, "companies", {
    name: `North Shore Property Group ${runId}`,
    persona: PERSONA,
    org_id: orgId,
    status: "active",
    metadata: { demo_seed: true, run_id: runId, source_note: "Manages 14 multifamily buildings along the North Shore.", service_area_zips: ["60091", "60093", "60201"] },
  });

  // contacts has a name-or-channel CHECK constraint; provide name + email like seed-arc-demo does.
  const contactId = await insertOne(supabase, "contacts", {
    company_id: companyId,
    persona: PERSONA,
    org_id: orgId,
    status: "active",
    first_name: "Dana",
    last_name: "Whitfield",
    email: "dana.whitfield@northshore-pg.local",
    title: "Director of Operations",
    metadata: { demo_seed: true, run_id: runId, relationship_stage: "engaged", confidence_score: 88, title: "Director of Operations" },
  });

  // leads.source is NOT NULL with a non-empty CHECK; provide source (and other fields seed-arc-demo supplies).
  const leadId = await insertOne(supabase, "leads", {
    company_id: companyId,
    contact_id: contactId,
    persona: PERSONA,
    org_id: orgId,
    status: "qualified",
    source: "seed_test_campaign",
    external_lead_id: `seed-test-campaign-${runId}`,
    lead_score: 84,
    metadata: { demo_seed: true, run_id: runId, confidence_score: 84, status: "qualified", score: 84 },
  });

  const campaignId = await insertOne(supabase, "campaigns", {
    name: `Spring Flood Recovery — North Shore Property Managers ${runId}`,
    org_id: orgId,
    persona: PERSONA,
    restoration_focus: "water_backup",
    status: "pending_approval",
    company_id: companyId,
    contact_id: contactId,
    lead_id: leadId,
    owner: "Arc (Arc)",
    objective: "Pre-approve Big Shoulders as the priority water-loss vendor for North Shore managed buildings before spring thaw.",
    audience_summary: "Property managers and operations directors overseeing multifamily portfolios in 60091/60093/60201.",
    offer_summary: "Documented, insurance-ready water-loss response with a managed-building SLA and a vendor pre-approval packet.",
    compliance_notes: "No outbound send until human approval. Persona-safe CTAs only (Request Vendor Packet / Become a Partner).",
    source_signal: { demo_seed: true, run_id: runId, evidence: ["https://example.com/north-shore-flood-advisory", "https://example.com/property-manager-directory"], lead_id: leadId, score: 88 },
    reasoning_payload: {
      demo_seed: true,
      why_built: "Spring thaw + aging North Shore plumbing stock drives water-backup losses; managed buildings concentrate decision-making in a few property managers, so pre-approval unlocks many properties per partner.",
      recommended_action: "Approve the partner intro email and vendor packet; keep paid ads gated pending budget sign-off.",
      tools_used: ["crm_lookup", "evidence_search", "creative_generator"],
      guardrails: ["No outbound send before approval", "No ad spend before budget sign-off", "Persona-safe CTAs only"],
      prompt_inputs: { persona: PERSONA, restoration_focus: "water_backup", geo: ["60091", "60093", "60201"] },
    },
    audit_payload: { demo_seed: true, run_id: runId, created_by: "seed-test-campaign" },
  });

  await insertOne(supabase, "campaign_audiences", {
    campaign_id: campaignId,
    persona: PERSONA,
    audience_name: "North Shore managed-building decision makers",
    relationship_stage: "engaged",
    inclusion_rules: { zips: ["60091", "60093", "60201"], role: ["property_manager", "operations_director"] },
    exclusion_rules: { existing_partner: true },
    estimated_size: 42,
    reasoning_payload: { demo_seed: true, run_id: runId },
  });

  const assetIds = [];
  for (const asset of ASSETS) {
    const id = await insertOne(supabase, "campaign_assets", {
    org_id: orgId,
      campaign_id: campaignId,
      asset_type: asset.asset_type,
      channel: asset.channel,
      title: asset.title,
      status: "pending_approval",
      tool_source: "creative_generator",
      draft_body: asset.draft_body,
      dispatch_locked: true,
      reasoning_payload: { demo_seed: true, run_id: runId },
      audit_payload: { demo_seed: true, run_id: runId },
    });
    assetIds.push(id);
  }

  const emailAssetId = assetIds[3];
  const emailApprovalId = await insertOne(supabase, "approval_items", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: emailAssetId,
    company_id: companyId,
    contact_id: contactId,
    lead_id: leadId,
    item_type: "email_campaign_asset",
    status: "approved",
    risk_level: "low",
    draft_output: ASSETS[3].draft_body,
    requested_by: "arc",
    reviewed_by: "Evan",
    reviewed_at: new Date().toISOString(),
    reasoning_payload: { demo_seed: true, run_id: runId },
    audit_payload: { demo_seed: true, run_id: runId },
  });

  await insertOne(supabase, "approval_decisions", {
    org_id: orgId,
    approval_item_id: emailApprovalId,
    decision: "approved",
    decided_by: "Evan",
    decision_notes: "Copy is on-brand and persona-safe. Approved; outbound still gated.",
    previous_status: "pending_approval",
    next_status: "approved",
    metadata: { demo_seed: true, run_id: runId, source: "seed-test-campaign", outbound_locked: true },
  });

  await insertOne(supabase, "approval_items", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: assetIds[0],
    company_id: companyId,
    item_type: "landing_page_campaign_asset",
    status: "pending_approval",
    risk_level: "medium",
    draft_output: ASSETS[0].draft_body,
    requested_by: "arc",
    reasoning_payload: { demo_seed: true, run_id: runId },
    audit_payload: { demo_seed: true, run_id: runId },
  });

  await insertOne(supabase, "approval_items", {
    org_id: orgId,
    campaign_id: campaignId,
    campaign_asset_id: assetIds[1],
    company_id: companyId,
    item_type: "paid_search_ad",
    status: "pending_approval",
    risk_level: "high",
    draft_output: ASSETS[1].draft_body,
    requested_by: "arc",
    compliance_notes: "Paid spend — requires budget sign-off before launch.",
    reasoning_payload: { demo_seed: true, run_id: runId },
    audit_payload: { demo_seed: true, run_id: runId },
  });

  return { runId, companyId, contactId, leadId, campaignId, assetIds, emailApprovalId };
}

seedTestCampaign()
  .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
    process.exit(1);
  });
