/**
 * What a plausible tool result looks like, and what to do when one isn't (BSR-508).
 *
 * The defining bug class in this codebase: a call returns HTTP 200 with a
 * payload that doesn't contain what was asked for, the agent treats it as an
 * answer, and the failure propagates as confident nonsense. Five such failures
 * stacked in Arc's production path, each hiding the next
 * (`docs/ARC-SILENT-FAILURES.md`).
 *
 * The mechanism was always the same shape:
 *
 *     return r.nodes ?? [];
 *
 * A response whose `nodes` field is missing becomes an empty list, which is
 * indistinguishable from a genuinely empty Brain. Arc then says "you have no
 * facts about that" — fluent, confident, and wrong.
 *
 * ── What this does NOT do ────────────────────────────────────────────────────
 * It does not treat EMPTY as failure. An empty CRM list is a real and common
 * answer, and flagging it would make the guard worthless within a week. What it
 * checks is whether the response is SHAPED like the contract promises: the field
 * is present, it has the right type, and any count it carries agrees with the
 * rows beside it. Those can never be legitimately violated, so a breach is
 * always a real fault — which is what makes the signal worth acting on.
 *
 * "No data exists" and "retrieval failed" are different answers. Before this,
 * Arc could not tell them apart, so neither could the operator.
 */

import { textResult, type ToolResult } from "./helpers";

export type Breach = { reason: string };

/** Validates the RAW response, before any `?? []` can erase the evidence. */
export type Expectation = (payload: unknown) => Breach | null;

/**
 * Thrown when a response breaches its contract. `runTool` renders it as a loud,
 * model-facing failure; throwing means an expectation can be enforced from
 * anywhere — including inside a helper like `listPage` that builds its envelope
 * before `runTool` ever sees it.
 */
export class ToolExpectationError extends Error {
  constructor(public readonly breach: Breach) {
    super(breach.reason);
    this.name = "ToolExpectationError";
  }
}

function asObject(payload: unknown): Record<string, unknown> | null {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/**
 * The response must carry `key` as an array. An EMPTY array passes — that is a
 * real answer. A MISSING key does not: the endpoint answered without answering.
 */
export function expectList(key: string): Expectation {
  return (payload) => {
    const object = asObject(payload);
    if (!object) return { reason: `expected an object carrying \`${key}\`, got ${describe(payload)}` };
    if (!(key in object)) return { reason: `the response has no \`${key}\` field` };
    if (!Array.isArray(object[key])) return { reason: `\`${key}\` is ${describe(object[key])}, not a list` };
    return null;
  };
}

/**
 * The response must carry `key`, though its value may be null — "asked for that
 * id, it isn't there" is a legitimate answer and must stay distinguishable from
 * "the lookup did not happen".
 */
export function expectRecord(key: string): Expectation {
  return (payload) => {
    const object = asObject(payload);
    if (!object) return { reason: `expected an object carrying \`${key}\`, got ${describe(payload)}` };
    if (!(key in object)) return { reason: `the response has no \`${key}\` field` };
    return null;
  };
}

/**
 * A CRM list envelope: `{ key, total, returned, has_more }`.
 *
 * `total` is load-bearing — it is how Arc answers counting questions without
 * counting a capped page, after reading a truncated 10-row fragment as the whole
 * CRM and reporting "at least 64 leads" against a real 200. A `total` that isn't
 * a number silently breaks that, so it is checked rather than assumed.
 *
 * `returned` disagreeing with the row count is a contradiction the endpoint
 * cannot produce legitimately, so it is treated as a fault rather than reconciled.
 */
export function expectListEnvelope(key: string): Expectation {
  return (payload) => {
    const listBreach = expectList(key)(payload);
    if (listBreach) return listBreach;

    const object = payload as Record<string, unknown>;
    const rows = object[key] as unknown[];

    if (!("total" in object)) return { reason: `the response has no \`total\`, so counts cannot be answered` };
    if (typeof object.total !== "number" || !Number.isFinite(object.total)) {
      return { reason: `\`total\` is ${describe(object.total)}, not a number` };
    }
    if ("returned" in object && typeof object.returned === "number" && object.returned !== rows.length) {
      return { reason: `\`returned\` says ${object.returned} but ${rows.length} rows were sent` };
    }
    // total < rows is impossible: a page cannot hold more than the whole set.
    if (object.total < rows.length) {
      return { reason: `\`total\` is ${object.total} but ${rows.length} rows were sent` };
    }
    return null;
  };
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "absent";
  if (Array.isArray(value)) return "a list";
  return `a ${typeof value}`;
}

/** Throw if the payload breaches its contract. Returns the payload for chaining. */
export function enforce<T>(payload: T, expectation: Expectation): T {
  const breach = expectation(payload);
  if (breach) throw new ToolExpectationError(breach);
  return payload;
}

/**
 * The model-facing failure. Worded to make the ONE distinction that matters:
 * this is not an empty result, and answering as though it were is the specific
 * mistake being prevented. Arc is told to name the tool so the operator can see
 * which retrieval failed rather than reading a vague hedge.
 */
export function breachResult(label: string, breach: Breach): ToolResult {
  return {
    ...textResult(
      `RETRIEVAL FAILED — ${label} did not return usable data.\n\n` +
        `Reason: ${breach.reason}.\n\n` +
        `This is a FAILURE, not an empty result. This call cannot tell you whether matching ` +
        `records exist. Do NOT report it as "none found", "no records", or "nothing yet", and do ` +
        `not answer the question from other knowledge as if this had succeeded. Tell the operator ` +
        `you could not retrieve this, and name "${label}" so they know what to check.`,
    ),
    isError: true,
  };
}
