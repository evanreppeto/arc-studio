/**
 * Which stored values does the UI have no real label for? (BSR-709, option B)
 *
 *   pnpm census:vocabulary
 *
 * The totality test in `src/domain/__tests__/vocabulary-totality.test.ts`
 * guarantees every mapper returns *something* human for a value nobody mapped —
 * `brand_fact` becomes "Brand fact" rather than rendering raw or blank. That is
 * the safety net, and it is enough to stop the bug. It is not enough to keep the
 * vocabulary good: "Brand fact" is a mechanical de-underscoring, not a phrase
 * anyone chose, and there is no way to notice it from inside the code.
 *
 * Only the database knows which values actually occur. This asks it, and prints
 * the ones falling through to the humanizer so someone can decide whether they
 * deserve real wording.
 *
 * Read-only. Runs no writes, takes no flags, and touches nothing but SELECTs.
 *
 * Not part of CI — it needs prod credentials and its output is a judgement call,
 * not a pass/fail. Run it when a surface starts showing phrasing nobody wrote.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { STORED_VALUE_LABELLERS } from "../src/domain/vocabulary";

/** Mirrors backfill-brain-dedup.ts: .env.local first, system env wins. */
function loadLocalEnv(): void {
  let envText: string;
  try {
    envText = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

function getSupabase(): SupabaseClient {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or the environment.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type MessageRow = { status: string | null; metadata: Record<string, unknown> | null };

function arrayField(metadata: MessageRow["metadata"], key: string): Record<string, unknown>[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * Where each registered field lives on a row.
 *
 * Keyed by labeller name so the registry stays the source of truth: add a mapper
 * without an extractor and the run says so rather than quietly skipping it.
 *
 * Read in JS rather than SQL because there is no `exec_sql` RPC on this project
 * — the standard client only sends SELECTs — and because every one of these
 * fields lives on `arc_messages`, so one query serves them all.
 */
const READERS: Record<string, (row: MessageRow) => (string | null | undefined)[]> = {
  runStatusLabel: (row) => [row.status],
  runModeLabel: (row) => [row.metadata?.mode as string | undefined],
  runRouteLabel: (row) => [row.metadata?.route as string | undefined],
  recallKindLabel: (row) => arrayField(row.metadata, "recall").map((item) => item.kind as string | undefined),
  toolStatusLabel: (row) => arrayField(row.metadata, "toolCalls").map((item) => item.status as string | undefined),
  arcToolLabel: (row) => arrayField(row.metadata, "toolCalls").map((item) => item.name as string | undefined),
};

type Row = { value: string | null; n: number };

/** Tally one field's values across every row. */
function tally(rows: MessageRow[], extract: (row: MessageRow) => (string | null | undefined)[]): Row[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of extract(row)) {
      if (typeof value !== "string" || !value.trim()) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts].map(([value, n]) => ({ value, n }));
}

const PAGE = 1000;

/** Every message, paged — the default PostgREST ceiling would silently truncate. */
async function readMessages(supabase: SupabaseClient): Promise<MessageRow[]> {
  const all: MessageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("arc_messages")
      .select("status, metadata")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as MessageRow[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

async function main(): Promise<void> {
  const supabase = getSupabase();
  const messages = await readMessages(supabase);
  console.log(`Read ${messages.length} rows from arc_messages.`);
  let unlabelled = 0;

  for (const labeller of STORED_VALUE_LABELLERS) {
    const extract = READERS[labeller.name];
    if (!extract) {
      console.log(`\n${labeller.name} (${labeller.source})\n  no reader defined — add one to READERS in this script`);
      continue;
    }

    const rows = tally(messages, extract);

    // A mapper with no fixed map (tool names) humanizes everything by design;
    // listing all of them would be noise, so only the mapped ones are audited.
    if (Object.keys(labeller.map).length === 0) {
      console.log(`\n${labeller.name} (${labeller.source})\n  open-ended by design — ${rows.length} distinct values, all humanized`);
      continue;
    }

    const missing = rows
      .filter((row) => row.value?.trim() && !(row.value in labeller.map))
      .sort((a, b) => b.n - a.n);

    console.log(`\n${labeller.name} (${labeller.source})`);
    if (missing.length === 0) {
      console.log(`  every value in the database has a real label (${rows.length} distinct)`);
      continue;
    }
    unlabelled += missing.length;
    for (const row of missing) {
      console.log(`  ${String(row.value).padEnd(32)} ${String(row.n).padStart(6)} rows → "${labeller.label(row.value)}"`);
    }
  }

  console.log(
    unlabelled === 0
      ? "\nNothing to do — every stored value the database holds has wording someone chose."
      : `\n${unlabelled} value(s) are readable but auto-generated. Give the ones that matter a real label in src/domain/vocabulary.ts.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
