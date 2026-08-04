import { afterEach, describe, expect, it, vi } from "vitest";

import { createStoredPreference } from "./stored-preference";

/**
 * The plumbing behind row density (BSR-748) and column visibility (BSR-749).
 *
 * These were string-matched against `crm-board.tsx` before the helper existed,
 * which pinned the implementation rather than the behaviour — and broke the
 * moment the code moved, without any of the properties actually changing. Now
 * they run against the real thing.
 */

const store = new Map<string, string>();
const stub = (overrides: Partial<Storage> = {}) => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      ...overrides,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  });
};

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

const numberPref = () =>
  createStoredPreference<number>({
    key: "k",
    fallback: 0,
    parse: (raw) => (raw === null ? 0 : Number.parseInt(raw, 10) || 0),
    serialize: String,
  });

describe("createStoredPreference", () => {
  it("reads what it wrote", () => {
    stub();
    const pref = numberPref();
    pref.set(7);
    expect(pref.getSnapshot()).toBe(7);
    expect(store.get("k")).toBe("7");
  });

  /**
   * The subtle one. `getSnapshot` must return the same reference between
   * renders or `useSyncExternalStore` re-renders forever — and a parse-per-call
   * implementation returns a fresh object every time, which looks correct in
   * review and hangs the tab.
   */
  it("returns a stable reference until something changes", () => {
    stub();
    store.set("k2", '{"contacts":["company"]}');
    const pref = createStoredPreference<Record<string, string[]>>({
      key: "k2",
      fallback: {},
      parse: (raw) => (raw ? JSON.parse(raw) : {}),
    });
    expect(pref.getSnapshot()).toBe(pref.getSnapshot());

    const before = pref.getSnapshot();
    pref.set({ leads: ["routing"] });
    expect(pref.getSnapshot()).not.toBe(before);
    expect(pref.getSnapshot()).toBe(pref.getSnapshot());
  });

  it("renders the fallback on the server, where there is no storage at all", () => {
    // No window stub here on purpose: getServerSnapshot must not touch it.
    const pref = numberPref();
    expect(pref.getServerSnapshot()).toBe(0);
  });

  it("survives storage that throws on READ", () => {
    // Private mode throws on getItem, not only on setItem — the case the first
    // version of this code missed.
    stub({ getItem: () => { throw new Error("SecurityError"); } });
    expect(numberPref().getSnapshot()).toBe(0);
  });

  it("survives storage that throws on WRITE, and still applies the choice", () => {
    stub({ setItem: () => { throw new Error("QuotaExceededError"); } });
    const pref = numberPref();
    pref.set(3);
    // The write failed; the session must still reflect what the operator chose.
    expect(pref.getSnapshot()).toBe(3);
  });

  it("notifies every subscriber on write", () => {
    stub();
    const pref = numberPref();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = pref.subscribe(a);
    pref.subscribe(b);
    pref.set(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    stopA();
    pref.set(2);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});
