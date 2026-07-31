import { type SupabaseClient } from "@supabase/supabase-js";

export type MockResponse = {
  data: unknown;
  /**
   * Shaped like a real PostgREST error, which carries `code`/`details`/`hint`
   * alongside the message — `code` in particular is what a report needs to say
   * WHICH failure happened (42703 missing column vs 42P01 missing relation).
   */
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  count?: number | null;
};

export type MockSupabase = SupabaseClient & {
  calls: Array<[string, ...unknown[]]>;
};

const CHAIN_METHODS = [
  "select",
  "insert",
  "update",
  "delete",
  "upsert",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is",
  "like",
  "ilike",
  "or",
  "order",
  "limit",
  "range",
  "single",
  "maybeSingle",
] as const;

export function createSupabaseQueryMock(
  responses: Record<string, MockResponse | MockResponse[]>,
): MockSupabase {
  const calls: Array<[string, ...unknown[]]> = [];
  const responseQueues = new Map(
    Object.entries(responses).map(([tableName, response]) => [
      tableName,
      Array.isArray(response) ? [...response] : [response],
    ]),
  );

  const makeChain = (tableName: string) => {
    const chain: Record<string, unknown> = {};

    for (const method of CHAIN_METHODS) {
      chain[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return chain;
      };
    }

    chain.then = (
      onFulfilled?: (value: MockResponse) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => {
      const queue = responseQueues.get(tableName);
      const response: MockResponse = queue && queue.length > 0
        ? (queue.length > 1 ? queue.shift()! : queue[0]!)
        : { data: [], error: null };
      return Promise.resolve(response).then(onFulfilled, onRejected);
    };

    return chain;
  };

  const from = (tableName: string) => {
    calls.push(["from", tableName]);
    return makeChain(tableName);
  };

  const rpc = (functionName: string, args?: Record<string, unknown>) => {
    calls.push(["rpc", functionName, args]);
    const queue = responseQueues.get(`rpc:${functionName}`);
    const response: MockResponse = queue && queue.length > 0
      ? (queue.length > 1 ? queue.shift()! : queue[0]!)
      : { data: null, error: null };
    return Promise.resolve(response);
  };

  return { from, rpc, calls } as unknown as MockSupabase;
}
