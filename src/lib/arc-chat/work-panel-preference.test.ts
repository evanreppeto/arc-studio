import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORK_SECTIONS,
  readWorkPanelPreference,
  readWorkSectionPreference,
  workPanelOpenOnConversationChange,
  writeWorkPanelPreference,
  writeWorkSectionPreference,
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

describe("which sections the operator left open", () => {
  it("defaults to both reference sections closed", () => {
    // Evidence answers "where did that come from" — a question asked ABOUT a
    // deliverable, so it opens on demand rather than pushing 65 rows of records
    // and recall between the operator and the campaign work.
    expect(DEFAULT_WORK_SECTIONS).toEqual({ evidence: false, runs: false });
    expect(readWorkSectionPreference()).toBeNull();
  });

  it("round-trips a choice", () => {
    writeWorkSectionPreference({ evidence: false, runs: true });
    expect(readWorkSectionPreference()).toEqual({ evidence: false, runs: true });
  });

  it("fills in a section the stored value does not mention", () => {
    // A stored shape from an older build must not collapse a section the
    // operator never touched into `false`.
    const storage = stubStorage();
    storage.setItem("arc.workPanel.sections", JSON.stringify({ runs: true }));
    expect(readWorkSectionPreference()).toEqual({ evidence: false, runs: true });
  });

  it("ignores junk rather than throwing", () => {
    const storage = stubStorage();
    storage.setItem("arc.workPanel.sections", "{not json");
    expect(readWorkSectionPreference()).toBeNull();
  });
});
