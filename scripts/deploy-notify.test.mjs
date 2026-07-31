import { describe, expect, it } from "vitest";

import { buildNotification, formatDuration, pullRequestNumber } from "./deploy-notify.mjs";

const REPO = "evanreppeto/marketing";

/**
 * Captured from the real repository on 2026-07-31, not invented. The shapes
 * here are the ones this workflow will actually receive — in particular the
 * check name carries the GCP project in parentheses, and a skipped build
 * reports completed_at BEFORE started_at.
 */
const runnerSkipped = {
  check_run: {
    name: "arc-runner-deploy (arc-marketing-500317)",
    conclusion: "neutral",
    started_at: "2026-07-31T16:15:47Z",
    completed_at: "2026-07-31T16:15:46Z",
    head_sha: "9796a040aaaaaaaabbbbbbbbccccccccdddddddd",
    details_url: "https://console.cloud.google.com/cloud-build/triggers/edit/abc",
    app: { slug: "google-cloud-build" },
    check_suite: { head_branch: "main" },
  },
};

const runnerDeployed = {
  check_run: {
    name: "arc-runner-deploy (arc-marketing-500317)",
    conclusion: "success",
    started_at: "2026-07-31T15:09:57Z",
    completed_at: "2026-07-31T15:14:48Z",
    head_sha: "834eeb44aaaaaaaabbbbbbbbccccccccdddddddd",
    details_url: "https://console.cloud.google.com/cloud-build/builds/xyz",
    app: { slug: "google-cloud-build" },
    check_suite: { head_branch: "main" },
  },
};

const appDeployed = {
  deployment: {
    environment: "Production",
    sha: "9796a040aaaaaaaabbbbbbbbccccccccdddddddd",
    created_at: "2026-07-31T16:16:08Z",
  },
  deployment_status: {
    state: "success",
    created_at: "2026-07-31T16:18:09Z",
    target_url: "https://marketing-dq36tiaez-big-shoulders-restoration.vercel.app",
    environment: "Production",
  },
};

function app(overrides = {}) {
  return {
    ...appDeployed,
    ...overrides,
    deployment: { ...appDeployed.deployment, ...(overrides.deployment ?? {}) },
    deployment_status: { ...appDeployed.deployment_status, ...(overrides.deployment_status ?? {}) },
  };
}

function textOf(result) {
  return result.attachments[0].blocks[0].text.text;
}

describe("the message says WHICH half moved", () => {
  it("names the runner as unchanged on an app-only merge", () => {
    // The common case. It has to read as normal, not as a missing message —
    // otherwise the channel trains people to wonder what went wrong.
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app(),
      repo: REPO,
      runnerTouched: false,
      commitMessage: "fix(backup): something (#770)",
    });
    expect(textOf(result)).toContain("App deployed to production");
    expect(textOf(result)).toContain("Runner: unchanged by this merge");
    expect(textOf(result)).toContain("this is normal");
  });

  it("says a runner message is coming when the merge touches the runner", () => {
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app(),
      repo: REPO,
      runnerTouched: true,
      commitMessage: "feat(runner): something (#748)",
    });
    expect(textOf(result)).toContain("apps/arc-runner/**");
    expect(textOf(result)).toContain("a separate message follows");
  });

  it("posts nothing for a skipped runner build", () => {
    // Otherwise every merge posts twice and the channel becomes ignorable.
    const result = buildNotification({ eventName: "check_run", payload: runnerSkipped, repo: REPO });
    expect(result.skip).toContain("did not touch");
  });

  it("posts for a real runner deploy", () => {
    const result = buildNotification({
      eventName: "check_run",
      payload: runnerDeployed,
      repo: REPO,
      commitMessage: "feat(runner): something (#748)",
    });
    expect(textOf(result)).toContain("Runner deployed to Cloud Run");
    expect(textOf(result)).toContain("4m 51s");
    expect(textOf(result)).toContain("#748");
  });
});

describe("failure is the load-bearing case", () => {
  it("reports a failed app deploy and says prod did not move", () => {
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app({ deployment_status: { state: "failure" } }),
      repo: REPO,
      runnerTouched: false,
      commitMessage: "broken (#1)",
    });
    expect(result.text).toBe("App deploy FAILED");
    expect(textOf(result)).toContain("still on the previous deployment");
    expect(result.attachments[0].color).toBe("#cc6666");
  });

  it("treats Vercel's `error` state as a failure too", () => {
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app({ deployment_status: { state: "error" } }),
      repo: REPO,
      runnerTouched: false,
    });
    expect(result.text).toBe("App deploy FAILED");
  });

  it("reports a failed runner build as a stale image, which is the real consequence", () => {
    // A silent Cloud Build failure is the specific bug this ticket exists for.
    const result = buildNotification({
      eventName: "check_run",
      payload: { check_run: { ...runnerDeployed.check_run, conclusion: "failure" } },
      repo: REPO,
    });
    expect(textOf(result)).toContain("still serving the previous image");
    expect(textOf(result)).toContain("`main` has moved on but the runner has not");
    expect(textOf(result)).toContain("Cloud Build log");
  });

  it("reports a timed-out build rather than ignoring it", () => {
    const result = buildNotification({
      eventName: "check_run",
      payload: { check_run: { ...runnerDeployed.check_run, conclusion: "timed_out" } },
      repo: REPO,
    });
    expect(result.text).toBe("Runner deploy timed_out");
  });
});

describe("what must NOT reach the channel", () => {
  it("ignores preview deploys", () => {
    // Four fired in three minutes on a busy branch; this channel is low-volume
    // on purpose.
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app({ deployment: { environment: "Preview" } }),
      repo: REPO,
    });
    expect(result.skip).toContain("not Production");
  });

  it("ignores in-flight states", () => {
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app({ deployment_status: { state: "in_progress" } }),
      repo: REPO,
    });
    expect(result.skip).toContain("not terminal");
  });

  it("ignores every other check run", () => {
    const result = buildNotification({
      eventName: "check_run",
      payload: { check_run: { name: "verify", conclusion: "success", app: { slug: "github-actions" } } },
      repo: REPO,
    });
    expect(result.skip).toContain("not the Cloud Build runner check");
  });

  it("ignores a runner build on a branch that is not main", () => {
    const result = buildNotification({
      eventName: "check_run",
      payload: {
        check_run: { ...runnerDeployed.check_run, check_suite: { head_branch: "some-branch" } },
      },
      repo: REPO,
    });
    expect(result.skip).toContain("not main");
  });

  it("explains itself when it skips, rather than going quiet", () => {
    const result = buildNotification({ eventName: "push", payload: {}, repo: REPO });
    expect(result.skip).toContain("unhandled event");
  });
});

describe("details a reader needs", () => {
  it("never renders a negative duration", () => {
    // A skipped Cloud Build really does report completed_at before started_at.
    expect(formatDuration("2026-07-31T16:15:47Z", "2026-07-31T16:15:46Z")).toBeNull();
    expect(formatDuration(null, "2026-07-31T16:15:46Z")).toBeNull();
  });

  it("formats durations the way a human reads them", () => {
    expect(formatDuration("2026-07-31T15:09:57Z", "2026-07-31T15:14:48Z")).toBe("4m 51s");
    expect(formatDuration("2026-07-31T15:09:57Z", "2026-07-31T15:10:57Z")).toBe("1m");
    expect(formatDuration("2026-07-31T15:09:57Z", "2026-07-31T15:10:12Z")).toBe("15s");
  });

  it("pulls the PR number out of a squash-merge subject", () => {
    expect(pullRequestNumber("fix(backup): the prod backup could not be restored (BSR-532) (#768)")).toBe(768);
    expect(pullRequestNumber("subject (#12)\n\nbody (#99)")).toBe(12);
    expect(pullRequestNumber("no pr here")).toBeNull();
    expect(pullRequestNumber(undefined)).toBeNull();
  });

  it("does not claim a duration for the app half", () => {
    // Vercel creates the GitHub Deployment only after the build finishes and
    // posts success ~1s later. That 1s is alias promotion, not build time —
    // reporting it would state "1s" for a multi-minute deploy.
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app(),
      repo: REPO,
      runnerTouched: false,
      commitMessage: "x (#770)",
    });
    expect(textOf(result)).not.toMatch(/\b\d+s\b/);
    expect(textOf(result)).not.toMatch(/\b\d+m\b/);
  });

  it("links the commit so a merge can be traced without opening a dashboard", () => {
    const result = buildNotification({
      eventName: "deployment_status",
      payload: app(),
      repo: REPO,
      runnerTouched: false,
      commitMessage: "x (#770)",
    });
    expect(textOf(result)).toContain(`https://github.com/${REPO}/commit/9796a040`);
    expect(textOf(result)).toContain("`9796a040`");
  });
});
