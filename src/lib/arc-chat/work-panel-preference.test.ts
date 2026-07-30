import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readWorkPanelPreference,
  workPanelOpenOnConversationChange,
  writeWorkPanelPreference,
} from "./work-panel-preference";

function stubStorage(impl: Partial<Storage> = {}) {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
    ...impl,
  } as Storage;
  vi.stubGlobal("window", { sessionStorage: storage });
  return storage;
}

beforeEach(() => stubStorage());
afterEach(() => vi.unstubAllGlobals());

describe("the operator's choice is remembered", () => {
  it("has no opinion until one is expressed", () => {
    // The default has to be "no preference", not "closed" — closed is what the
    // panel does with no preference, but the two must stay distinguishable or
    // a never-touched panel looks like a deliberate close.
    expect(readWorkPanelPreference()).toBeNull();
    expect(workPanelOpenOnConversationChange()).toBe(false);
  });

  it("remembers a close, which is the whole complaint", () => {
    writeWorkPanelPreference(false);
    expect(readWorkPanelPreference()).toBe(false);
    expect(workPanelOpenOnConversationChange()).toBe(false);
  });

  it("remembers an open across a conversation switch", () => {
    // An operator who opened the workspace and then switched threads asked for
    // it open; resetting it is the same override one step removed.
    writeWorkPanelPreference(true);
    expect(workPanelOpenOnConversationChange()).toBe(true);
  });
});

describe("storage that misbehaves must not take the chat down", () => {
  it("reports no preference when reading throws", () => {
    // Safari private mode, and any embedded context with storage disabled.
    stubStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(readWorkPanelPreference()).toBeNull();
    expect(workPanelOpenOnConversationChange()).toBe(false);
  });

  it("swallows a failed write rather than breaking the toggle", () => {
    stubStorage({
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => writeWorkPanelPreference(true)).not.toThrow();
  });

  it("survives having no window at all", () => {
    // This module is imported by a client component that Next also renders on
    // the server; touching sessionStorage there would throw during SSR.
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
    expect(readWorkPanelPreference()).toBeNull();
    expect(() => writeWorkPanelPreference(true)).not.toThrow();
  });

  it("ignores a value it did not write", () => {
    const storage = stubStorage();
    storage.setItem("arc.workPanel.open", "yes please");
    expect(readWorkPanelPreference()).toBeNull();
  });
});
