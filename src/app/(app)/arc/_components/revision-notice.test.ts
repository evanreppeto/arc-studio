import { describe, expect, it } from "vitest";

import { revisionNotice } from "./arc-messages";

// BSR-695. The revision loop shipped with a wake that was never sent, so every
// request was recorded and none ever ran. The UI said "Arc is updating it"
// throughout — the operator had no way to tell a working loop from a dead one,
// and the one signal that could have told them was the flag this message
// ignored. These lock the three outcomes apart.
describe("revisionNotice", () => {
  it("says Arc is working only when the agent actually took the job", () => {
    expect(revisionNotice({ ok: true, persisted: true, dispatched: true })).toMatch(/Arc is updating it/);
  });

  it("does NOT claim Arc is working when the wake went unacknowledged", () => {
    const notice = revisionNotice({ ok: true, persisted: true, dispatched: false });
    expect(notice).not.toMatch(/Arc is updating it/);
    // and it has to say the two things the operator needs: it saved, and it
    // will not start by itself — "failed" would be wrong, nothing was lost
    expect(notice).toMatch(/saved/i);
    expect(notice).toMatch(/won't begin on its own/i);
  });

  it("keeps the preview wording when nothing was persisted at all", () => {
    expect(revisionNotice({ ok: true, persisted: false, dispatched: false })).toMatch(/not saved/i);
    // no backend means no dispatch to report — "Arc hasn't started" would be
    // technically true and completely misleading
    expect(revisionNotice({ ok: true, persisted: false, dispatched: false })).not.toMatch(/won't begin/i);
  });

  it("treats an absent flag as started, so callers that don't report it are unchanged", () => {
    // Only an explicit false is a known failure. Defaulting the other way would
    // warn on every revision from any path that doesn't thread the flag.
    expect(revisionNotice({ ok: true, persisted: true })).toMatch(/Arc is updating it/);
  });
});
