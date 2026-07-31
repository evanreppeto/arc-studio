import fs from "node:fs";
import path from "node:path";

/**
 * Route census for the exposure suite (BSR-521).
 *
 * Enumerates every page and API route from the filesystem so a NEW route cannot
 * be added without being classified. The previous checks in this directory were
 * hand-written lists of paths someone remembered, which is precisely how a route
 * gets forgotten — the last real exposure served a workspace's brand kit to
 * signed-out visitors because a proxy matcher exemption named after a `public/`
 * asset directory also exempted a page route.
 *
 * WHY GUARD NAMES ARE DERIVED, NOT LISTED
 *
 * Writing this test the obvious way — grep each route for a known guard helper —
 * was tried and undercounted three times in a row. The auth helpers are spread
 * across modules and there are more of them than anyone remembers: `arcGuard`,
 * `checkAgentBearer`, `checkBearerToken`, `checkWorkspaceBearer`, plus operator,
 * session, signature and cron paths. Each miss reported a correctly-guarded
 * route as UNGUARDED, and a hardcoded list would rot the same way the moment a
 * fifth helper appears.
 *
 * So the token guards are read from the exports of the modules that define
 * them. Add a helper there and this recognises it automatically; delete one and
 * the census notices.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");

/** Modules whose exported `check*`/`*Guard` functions count as route guards. */
const GUARD_SOURCE_FILES = [
  path.join(process.cwd(), "src", "lib", "auth", "api-token.ts"),
  path.join(APP_DIR, "api", "v1", "arc", "_lib", "http.ts"),
];

/** Guards that live outside those modules, by mechanism rather than by name. */
const NON_TOKEN_GUARD_PATTERNS = [
  /requireOperator/,
  /requireBillingAdmin/,
  /getSupabaseAuthenticatedUser/,
  /getCurrentWorkspaceContext/,
  /constructEvent/, // Stripe signature verification
  /WEBHOOK_SECRET/,
  /CRON_SECRET/,
  // Delegated auth: the route hands the request to a lib function that returns
  // an authorisation status and maps it to 401/403. /api/auth/workspace-invites
  // and workspace-members work this way — the guard is real, it just lives one
  // call deeper. Matching the denial status is what makes it visible here.
  /not_authenticated/,
  /not_authorized/,
] as const;

/** Exported guard-ish function names, read from the modules that define them. */
export function knownTokenGuards(): string[] {
  const names = new Set<string>();
  for (const file of GUARD_SOURCE_FILES) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
      const name = match[1];
      if (/^(check|.*Guard$)/i.test(name) || /Guard$/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

function walk(dir: string, fileName: string, found: string[] = []): string[] {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, fileName, found);
    else if (entry.name === fileName) found.push(full);
  }
  return found;
}

/** Turn `src/app/(app)/crm/[objectKey]/page.tsx` into `/crm/[objectKey]`. */
function toRoutePath(absolute: string, fileName: string): string {
  const rel = path.relative(APP_DIR, absolute).replace(/\\/g, "/");
  const withoutFile = rel.slice(0, -(fileName.length + 1));
  // Route groups like (app) are organisational and contribute no URL segment.
  const segments = withoutFile.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
}

export type PageRoute = { routePath: string; file: string; inAppGroup: boolean };

export function censusPageRoutes(): PageRoute[] {
  return walk(path.join(APP_DIR), "page.tsx")
    .map((file) => ({
      routePath: toRoutePath(file, "page.tsx"),
      file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
      // The (app) route group is the auth boundary — its layout gates everything inside.
      inAppGroup: file.includes(`${path.sep}(app)${path.sep}`),
    }))
    .sort((a, b) => a.routePath.localeCompare(b.routePath));
}

export type ApiRoute = { routePath: string; file: string; guards: string[] };

export function censusApiRoutes(): ApiRoute[] {
  const tokenGuards = knownTokenGuards();
  return walk(path.join(APP_DIR, "api"), "route.ts")
    .map((file) => {
      const source = fs.readFileSync(file, "utf8");
      const guards = [
        ...tokenGuards.filter((name) => new RegExp(`\\b${name}\\b`).test(source)),
        ...NON_TOKEN_GUARD_PATTERNS.filter((re) => re.test(source)).map((re) => re.source),
      ];
      return {
        routePath: toRoutePath(file, "route.ts"),
        file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
        guards,
      };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));
}
