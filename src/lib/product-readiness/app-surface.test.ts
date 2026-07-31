import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath: string) {
  return fs.existsSync(path.join(root, relativePath));
}

describe("product app surface smoke checks", () => {
  it("keeps the app front door and the backend API surface present", () => {
    const expectedFiles = [
      // The front door is the real app: `/` (src/app/page.tsx) redirects into the
      // (app) route group, with Home as the landing screen. (The old static mockup
      // gallery under public/build-*.html has been removed.)
      "src/app/page.tsx",
      "src/app/(app)/home/page.tsx",
      // The backend API surface.
      "src/app/api/auth/sign-in/route.ts",
      "src/app/api/auth/sign-up/route.ts",
      "src/app/api/auth/workspace-invites/route.ts",
      "src/app/api/auth/workspace-members/route.ts",
      "src/app/api/v1/arc/health/route.ts",
      "src/app/api/v1/arc/tasks/route.ts",
    ];

    for (const file of expectedFiles) {
      expect(exists(file), `${file} should exist`).toBe(true);
    }
  });

  it("keeps auth pages and API routes out of the page-protection proxy matcher", () => {
    const source = read("src/proxy.ts");
    expect(source).toContain("login");
    expect(source).toContain("sign-in");
    expect(source).toContain("sign-up");
    expect(source).toContain("api");
    expect(source).toContain("getWorkspaceAccessDecision");
  });

  it("exposes one-command local verification scripts", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    // `--incremental false` is load-bearing, not incidental: tsconfig sets
    // `incremental: true`, and a stale tsconfig.tsbuildinfo carried across a
    // branch switch reports phantom errors (126 of them, on a main that
    // typechecks clean) while CI stays green because it always starts fresh.
    // Pinned so the flag cannot be dropped as noise.
    expect(pkg.scripts.typecheck).toBe("tsc --noEmit --pretty false --incremental false");
    expect(pkg.scripts["test:smoke"]).toContain("product-readiness");
    expect(pkg.scripts["smoke:http"]).toBe("node scripts/smoke-http.mjs");
    expect(pkg.scripts["health:supabase"]).toBe("node scripts/check-supabase-health.mjs");
    expect(pkg.scripts["health:constraints"]).toBe("node scripts/check-agent-task-constraints.mjs");
    expect(pkg.scripts.verify).toBe("node scripts/verify-product.mjs");
    expect(pkg.scripts["verify:live"]).toContain("node scripts/check-supabase-health.mjs");
    expect(pkg.scripts["verify:live"]).toContain("node scripts/check-agent-task-constraints.mjs");
  });
});
