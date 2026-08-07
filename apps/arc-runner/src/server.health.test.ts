import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { Config } from "./config";
import { createRunnerServer } from "./server";

/**
 * `/health` has to say WHICH build is answering.
 *
 * Without it the response was byte-identical before and after a deploy — and
 * identical to a deploy that never happened. That is not a hypothetical here:
 * the Cloud Build trigger stores the GitHub repo by literal {owner, name}, so
 * renaming the repo stops it deploying silently, with nothing erroring and no
 * way to tell from outside (docs/arc-runner-cloud-run-runbook.md). This is the
 * outside way to tell.
 */

const BASE: Config = {
  appApiBaseUrl: "https://app.example",
  arcAgentApiToken: "t",
  webhookSecret: null,
  port: 0,
  webhookPath: "/webhooks/growth-chat",
  maxConcurrentRuns: 4,
  maxConcurrentRunsPerWorkspace: 2,
  commit: null,
};

const servers: ReturnType<typeof createRunnerServer>[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function health(config: Config): Promise<Record<string, unknown>> {
  const server = createRunnerServer(config);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /health", () => {
  it("reports the commit the image was built from", async () => {
    const body = await health({ ...BASE, commit: "24080071abcdef" });
    expect(body).toMatchObject({ ok: true, service: "arc-runner", commit: "24080071abcdef" });
  });

  it("reports null rather than inventing one when the image wasn't built by the pipeline", async () => {
    // A local `docker build` with no --build-arg, or any image from before this
    // existed. "I don't know which build I am" is the answer worth having — a
    // placeholder string would read as a real deploy.
    const body = await health(BASE);
    expect(body.commit).toBeNull();
    expect(body.ok).toBe(true);
  });

  it("still answers on / as well as /health", async () => {
    const server = createRunnerServer({ ...BASE, commit: "abc1234" });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.json()).toMatchObject({ commit: "abc1234" });
  });
});
