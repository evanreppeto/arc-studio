/**
 * Turn a GitHub deploy event into a Slack message for #arc-deploys (BSR-536).
 *
 * Two independent pipelines ship this repo, on different triggers:
 *
 *   app  → Vercel     every push to main            (Vercel's git integration)
 *   runner → Cloud Run pushes touching apps/arc-runner/**  (Cloud Build trigger)
 *
 * They do NOT both fire on every merge, which is the whole reason this exists.
 * A bare "deployed" message would be a lie on the common merge, and a Cloud
 * Build failure is currently silent — the runner can sit on a stale image while
 * main has moved on and nobody finds out.
 *
 * Both halves already report into GitHub: Vercel creates Deployments, Cloud
 * Build posts a check run. So this reads those events rather than adding a
 * Pub/Sub notifier or a second Slack integration.
 *
 * buildNotification() is pure so it can be tested against real captured
 * payloads; only main() touches the network.
 */

/** Cloud Build names its check `arc-runner-deploy (<gcp-project>)`. */
const RUNNER_CHECK_PREFIX = "arc-runner-deploy";

const GREEN = "#2eb886";
const RED = "#cc6666"; // matches DESIGN.md's --priority; destructive only
const GREY = "#6b6b70";

/**
 * A skipped Cloud Build check reports completed_at BEFORE started_at (observed:
 * started 16:15:47, completed 16:15:46). Never render a negative duration.
 */
export function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const seconds = Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Squash merges end their subject with "(#123)". */
export function pullRequestNumber(commitMessage) {
  const match = /\(#(\d+)\)\s*$/.exec((commitMessage ?? "").split("\n")[0] ?? "");
  return match ? Number(match[1]) : null;
}

function commitLink(repo, sha) {
  return `<https://github.com/${repo}/commit/${sha}|\`${sha.slice(0, 8)}\`>`;
}

function prLink(repo, number) {
  return number ? ` · <https://github.com/${repo}/pull/${number}|#${number}>` : "";
}

/**
 * @returns {{skip: string} | {text: string, attachments: object[]}}
 *   `skip` carries the reason so the workflow log says why nothing was posted —
 *   silence with no explanation is the failure mode this ticket is about.
 */
export function buildNotification({ eventName, payload, repo, runnerTouched, commitMessage }) {
  if (eventName === "deployment_status") return appNotification({ payload, repo, runnerTouched, commitMessage });
  if (eventName === "check_run") return runnerNotification({ payload, repo, commitMessage });
  return { skip: `unhandled event: ${eventName}` };
}

function appNotification({ payload, repo, runnerTouched, commitMessage }) {
  const status = payload.deployment_status ?? {};
  const deployment = payload.deployment ?? {};

  // Preview deploys fire constantly — four in three minutes on a busy branch.
  // This channel is only useful if a message means something.
  if (deployment.environment !== "Production") {
    return { skip: `environment is ${deployment.environment ?? "unknown"}, not Production` };
  }
  if (!["success", "failure", "error"].includes(status.state)) {
    return { skip: `state is ${status.state}, not terminal` };
  }

  const failed = status.state !== "success";
  const sha = deployment.sha ?? "";
  const pr = pullRequestNumber(commitMessage);

  // No duration for the app half, deliberately. Vercel creates the GitHub
  // Deployment only once the build has already finished and posts a single
  // status ~1s later (measured: created 16:21:48, success 16:21:49). That gap
  // is the alias promotion, not the build, so printing it would report "1s"
  // for a multi-minute deploy. The runner half has real start/finish times and
  // does show a duration. A wrong number is worse here than no number.

  // State the other half explicitly. "app deployed, runner unchanged" is the
  // common case and has to read as normal rather than as a missing message.
  const runnerLine = runnerTouched
    ? "Runner: this merge touches `apps/arc-runner/**` — a separate message follows when Cloud Build finishes."
    : "Runner: unchanged by this merge (still on its previous image — this is normal).";

  const lines = [
    failed
      ? `*App deploy FAILED* — production is still on the previous deployment.`
      : `*App deployed to production.*`,
    `Commit ${commitLink(repo, sha)}${prLink(repo, pr)}`,
    runnerLine,
  ];
  const logUrl = status.target_url || status.log_url || status.environment_url;
  if (logUrl) lines.push(failed ? `<${logUrl}|Build log>` : `<${logUrl}|Deployment>`);

  return {
    text: failed ? "App deploy FAILED" : "App deployed to production",
    attachments: [{ color: failed ? RED : GREEN, blocks: [section(lines.join("\n"))] }],
  };
}

function runnerNotification({ payload, repo, commitMessage }) {
  const check = payload.check_run ?? {};
  const name = check.name ?? "";
  const app = check.app?.slug ?? check.app?.name ?? "";

  if (!name.startsWith(RUNNER_CHECK_PREFIX) || app !== "google-cloud-build") {
    return { skip: `not the Cloud Build runner check (name=${name || "?"}, app=${app || "?"})` };
  }
  const branch = check.check_suite?.head_branch;
  if (branch && branch !== "main") return { skip: `branch is ${branch}, not main` };

  // `neutral` means the trigger evaluated and skipped: the merge did not touch
  // apps/arc-runner/**. The app message already says the runner is unchanged,
  // so posting here too would double every merge's traffic.
  if (check.conclusion === "neutral" || check.conclusion === "skipped") {
    return { skip: "runner build skipped — merge did not touch apps/arc-runner/**" };
  }
  if (!["success", "failure", "timed_out", "cancelled", "action_required"].includes(check.conclusion)) {
    return { skip: `conclusion is ${check.conclusion}, not terminal` };
  }

  const failed = check.conclusion !== "success";
  const sha = check.head_sha ?? "";
  const pr = pullRequestNumber(commitMessage);
  const duration = formatDuration(check.started_at, check.completed_at);

  const lines = [
    failed
      ? `*Runner deploy ${check.conclusion.toUpperCase()}* — Cloud Run is still serving the previous image.`
      : `*Runner deployed to Cloud Run.*`,
    `Commit ${commitLink(repo, sha)}${prLink(repo, pr)}${duration ? ` · ${duration}` : ""}`,
  ];
  if (failed) {
    lines.push("`main` has moved on but the runner has not. Re-run the build or revert.");
  }
  if (check.details_url) lines.push(`<${check.details_url}|Cloud Build log>`);

  return {
    text: failed ? `Runner deploy ${check.conclusion}` : "Runner deployed to Cloud Run",
    attachments: [{ color: failed ? RED : GREEN, blocks: [section(lines.join("\n"))] }],
  };
}

/** A drill message, so the delivery path can be proven without a real failure. */
export function buildDrillNotification(repo) {
  return {
    text: "Deploy notifications: delivery test",
    attachments: [
      {
        color: GREY,
        blocks: [
          section(
            [
              "*Delivery test — not a real deploy.*",
              `Sent by hand from \`deploy-notify.yml\` in ${repo} to prove the webhook, channel and formatting work.`,
              "Real messages name which half moved: app, runner, or both.",
            ].join("\n"),
          ),
        ],
      },
    ],
  };
}

function section(markdown) {
  return { type: "section", text: { type: "mrkdwn", text: markdown } };
}

async function main() {
  const { readFile } = await import("node:fs/promises");

  const webhook = process.env.SLACK_DEPLOY_WEBHOOK_URL;
  const repo = process.env.GITHUB_REPOSITORY ?? "evanreppeto/arc-studio";

  let message;
  if (process.env.DEPLOY_NOTIFY_DRILL === "1") {
    message = buildDrillNotification(repo);
  } else {
    const payload = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
    message = buildNotification({
      eventName: process.env.GITHUB_EVENT_NAME,
      payload,
      repo,
      runnerTouched: process.env.RUNNER_TOUCHED === "1",
      commitMessage: process.env.COMMIT_MESSAGE ?? "",
    });
  }

  if ("skip" in message) {
    console.log(`No notification: ${message.skip}`);
    return;
  }

  if (!webhook) {
    console.log(
      "::error title=SLACK_DEPLOY_WEBHOOK_URL is not set::" +
        "This deploy produced a message but there is nowhere to send it. Create an incoming webhook for #arc-deploys " +
        "and store it as the SLACK_DEPLOY_WEBHOOK_URL repository secret. See docs/runbooks/deploy-notifications.md.",
    );
    console.log(JSON.stringify(message, null, 2));
    process.exit(1);
  }

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  const body = await response.text();
  if (!response.ok) {
    console.log(`::error title=Slack rejected the deploy notification::HTTP ${response.status} ${body.slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`Posted to #arc-deploys: ${message.text}`);
}

// Only run when executed directly, so the test can import the pure helpers.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
