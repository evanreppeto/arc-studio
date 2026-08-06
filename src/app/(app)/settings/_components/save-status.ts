export type SettingsWriteResult = { ok: true; persisted: boolean; message?: string } | { ok: false; error: string };

export type SaveStatus = { tone: "ok" | "err"; text: string } | null;

/**
 * Turn an action's result into the line the operator reads.
 *
 * Extracted from settings-view so it can be tested: it used to always show the
 * caller's hardcoded `okText`, which meant every `message` an action returned
 * was computed and discarded at the last inch. The weather probe's live alert
 * count, its forecast line, and the service-area coverage warning (BSR-756) had
 * never once reached an operator — the warning was found invisible by clicking
 * the button on prod, not by any test.
 *
 * A caller with nothing specific to say still gets its `okText`.
 */
export function toStatus(res: SettingsWriteResult, okText: string): SaveStatus {
  if (!res.ok) return { tone: "err", text: res.error };
  const text = res.message?.trim() || okText;
  return { tone: "ok", text: res.persisted ? text : `${text} — connect your workspace to persist.` };
}
