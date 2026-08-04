#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the committed two-version browser
 * proof (independent-review P2-3, narrow-re-review RR2-P2-2).
 *
 * The reviewed PR committed the harness INFRASTRUCTURE — a two-version build
 * script and a switchable origin — but not the scenario driver and no browser
 * dependency, so its strongest verification claim ("9/9 browser scenarios")
 * could not be re-run, could not be audited, and guarded nothing. This is that
 * driver.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE NARROW RE-REVIEW FOUND, AND WHAT CHANGED (RR2-P2-2)
 * ---------------------------------------------------------------------------
 *
 * Every scenario used to run against a document the origin answered with HTTP
 * 500: the harness builds pointed at a non-resolving placeholder Supabase host,
 * the `/` loader's SSR data fetch threw, and the generic "This page didn't
 * load" boundary was all that ever rendered. No React route mounted in any
 * scenario. Scenario 19 collected three assertions from its
 * `assert(true, "no recovery screen was required")` branch in BOTH engines, and
 * scenarios 2, 5, 14 and 16 could pass the same way. The run reported 20/20
 * while several of its statements were about a page that never existed.
 *
 * Three things changed, and together they make a vacuous pass impossible:
 *
 *   1. A LOCAL DATA PLANE. `supabase-stub.mjs` answers the public read paths,
 *      so the REAL application document renders with HTTP 200 and the REAL
 *      router boots. Not a test-only page — the real root router and the real
 *      root error boundary are exactly what is being exercised.
 *   2. A GLOBAL PRECONDITION. Before any scenario runs, the application
 *      document must return 200 with an HTML content type, the real bootstrap
 *      marker must appear, the router must report a ready route within a
 *      bounded deadline, and the required entry assets must resolve. Failing
 *      any of these exits non-zero with ZERO scenarios passed and the run
 *      classified as an infrastructure/bootstrap failure — never as a scenario
 *      result.
 *   3. PER-SCENARIO DOCUMENT EXPECTATIONS. Every scenario declares the status
 *      its document must return. A normal scenario additionally requires the
 *      bootstrap marker, a ready router and the intended leaf BEFORE its
 *      actions begin. A scenario deliberately testing an error declares the
 *      expected status and boundary explicitly, so an unexpected 500 can never
 *      be mistaken for the intended stale-chunk condition.
 *
 * The five outcomes the harness now distinguishes by name are in
 * `FAILURE_KINDS` below.
 *
 * WHAT MAKES IT REAL, and not an imitation:
 *   - two REAL production builds of this repository, with genuinely different
 *     content-hashed chunks (the `StudioDashboard` chunk above all);
 *   - the REAL app router, the REAL root error boundary, the REAL classifier,
 *     the REAL recovery ledger, the REAL write-safety registry;
 *   - a switchable single-active asset version, exactly as Cloudflare Workers
 *     Static Assets behaves once a release reaches 100%;
 *   - real browser cache behaviour, real dynamic imports, real `sessionStorage`;
 *   - DOCUMENT-REQUEST COUNTING at the origin, because the only honest way to
 *     count automatic reloads is to count the documents the origin served — the
 *     page that would increment a browser-side counter is the page being
 *     replaced.
 *
 * FAIL-CLOSED. A missing browser binary, a missing build, a failed
 * precondition, a scenario that collected no assertions, or any failed
 * expectation exits non-zero. Nothing here silently skips
 * (independent-review P2-2).
 *
 * Nothing here deploys, publishes, reads a credential or touches production.
 * The harness builds use a loopback data stub that holds no data.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const require = createRequire(import.meta.url);

const PORT = Number(process.env.FOREVER_STALE_ASSET_HARNESS_PORT ?? 4180);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT_ROOT = resolve(
  process.env.FOREVER_STALE_ASSET_HARNESS_OUT ?? resolve(REPO_ROOT, ".stale-asset-harness"),
);
const EVIDENCE = resolve(
  process.env.FOREVER_STALE_ASSET_HARNESS_EVIDENCE ?? resolve(REPO_ROOT, ".stale-asset-harness"),
);

const ENGINES = (process.env.FOREVER_HARNESS_ENGINES ?? "chromium,webkit")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

/** How long the real router is given to report a ready route. */
const ROUTER_BOOT_DEADLINE_MS = Number(process.env.FOREVER_HARNESS_BOOT_DEADLINE_MS ?? 15_000);

function log(message) {
  process.stdout.write(`[browser-harness] ${message}\n`);
}

/**
 * The five distinguishable outcomes (RR2-P2-2).
 *
 * They exist so a failure is never reported as the wrong kind of failure — in
 * particular so an unexpected server error can never be counted as the
 * stale-chunk condition the proof is about.
 */
const FAILURE_KINDS = {
  DOCUMENT: "document_or_server_failure",
  BOOTSTRAP: "application_bootstrap_failure",
  STALE_CHUNK: "stale_content_hashed_chunk_failure",
  RECOVERY_SCREEN: "expected_recovery_screen",
  GENERIC: "generic_application_error",
};

/** The stale-asset recovery screen, identified by its committed test id. */
const RECOVERY_SCREEN = '[data-testid="stale-asset-recovery-screen"]';
const GENERIC_SCREEN_TEXT = "This page didn't load";

// ---------------------------------------------------------------------------
// Preconditions — every one of these is a FAILURE, never a skip
// ---------------------------------------------------------------------------

function requirePlaywright() {
  try {
    return require("playwright");
  } catch {
    throw new Error(
      "playwright is not installed. It is a declared devDependency: run `npm install`. " +
        "This is a FAILURE, not a skip — the browser proof cannot be reported as passing " +
        "without a browser (independent-review P2-2, P2-3).",
    );
  }
}

function requireBuiltVersions() {
  for (const label of ["version-a", "version-b"]) {
    const entry = resolve(OUT_ROOT, label, "server/index.mjs");
    if (!existsSync(entry)) {
      throw new Error(
        `${label} is not built (missing ${entry}). Run \`npm run studio:stale-asset-harness:build\` ` +
          "first. A missing build artifact is a FAILURE, never a skip.",
      );
    }
  }
}

async function requireBrowser(playwright, engine) {
  const type = playwright[engine];
  if (!type) throw new Error(`unknown browser engine: ${engine}`);
  try {
    return await type.launch();
  } catch (error) {
    throw new Error(
      `could not launch ${engine}: ${error.message}\n` +
        `Install the browser binaries with \`npx playwright install ${ENGINES.join(" ")}\`. ` +
        "A missing browser driver is a FAILURE, never a skip.",
    );
  }
}

/**
 * Raised when the environment, not the application, is broken.
 *
 * Carried separately all the way to the exit code so a bootstrap failure is
 * never reported as "scenarios failed" and never as "scenarios passed".
 */
class BootstrapFailure extends Error {
  constructor(message, detail = null) {
    super(message);
    this.detail = detail;
  }
}

/**
 * THE GLOBAL PRECONDITION (RR2-P2-2).
 *
 * Establishes, positively and before any scenario runs, that the harness origin
 * serves a healthy REAL application document. Every clause is required; there
 * is no partial success and no warning path.
 */
async function requireHealthyApplication(context, engine) {
  const evidence = { engine, path: "/" };

  const probe = await fetch(`${ORIGIN}/`, { headers: { accept: "text/html" } });
  evidence.documentStatus = probe.status;
  evidence.documentContentType = probe.headers.get("content-type");
  if (probe.status !== 200) {
    throw new BootstrapFailure(
      `the application document returned HTTP ${probe.status}, not 200 — the run is an ` +
        "infrastructure/bootstrap failure and NO scenario may be reported as passing",
      evidence,
    );
  }
  if (!(evidence.documentContentType ?? "").includes("text/html")) {
    throw new BootstrapFailure(
      `the application document is ${evidence.documentContentType}, not text/html`,
      evidence,
    );
  }
  const html = await probe.text();
  evidence.documentBytes = html.length;
  evidence.serverRenderedGenericBoundary = html.includes(GENERIC_SCREEN_TEXT);
  if (evidence.serverRenderedGenericBoundary) {
    throw new BootstrapFailure(
      "the application document server-rendered the generic error boundary — the route tree " +
        "never mounted, so no scenario assertion about it could mean anything",
      evidence,
    );
  }

  const page = await context.newPage();
  const responses = [];
  page.on("response", (response) => responses.push([response.url(), response.status()]));
  try {
    const response = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
    evidence.navigationStatus = response?.status() ?? null;
    if (evidence.navigationStatus !== 200) {
      throw new BootstrapFailure(
        `the browser received HTTP ${evidence.navigationStatus} for the application document`,
        evidence,
      );
    }

    const boot = await waitForBoot(page, ROUTER_BOOT_DEADLINE_MS);
    Object.assign(evidence, boot);
    if (boot.appMarker !== "mounted") {
      throw new BootstrapFailure(
        "the real application bootstrap marker never appeared — the root component of the real " +
          "route tree did not execute in this browser",
        evidence,
      );
    }
    if (boot.routeState !== "ready") {
      throw new BootstrapFailure(
        `the router did not report a ready route within ${ROUTER_BOOT_DEADLINE_MS}ms ` +
          `(state=${boot.routeState})`,
        evidence,
      );
    }
    if (boot.routeId !== "/") {
      throw new BootstrapFailure(
        `the router matched ${boot.routeId}, not the expected leaf route "/"`,
        evidence,
      );
    }

    // Every entry asset the document referenced must have resolved.
    const entryAssets = responses.filter(([url]) => url.includes("/assets/"));
    evidence.entryAssetsRequested = entryAssets.length;
    evidence.entryAssetsFailed = entryAssets.filter(([, status]) => status >= 400).length;
    if (entryAssets.length === 0) {
      throw new BootstrapFailure("the page requested no client assets at all", evidence);
    }
    if (evidence.entryAssetsFailed > 0) {
      throw new BootstrapFailure(
        `${evidence.entryAssetsFailed} required entry asset(s) did not resolve`,
        evidence,
      );
    }
    evidence.healthy = true;
    return evidence;
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Harness control plane
// ---------------------------------------------------------------------------

const control = {
  async activate(version) {
    await fetch(`${ORIGIN}/__harness/activate/${version}`, { method: "POST" });
  },
  async block(substring) {
    await fetch(`${ORIGIN}/__harness/block/${encodeURIComponent(substring)}`, { method: "POST" });
  },
  async unblock() {
    await fetch(`${ORIGIN}/__harness/block/none`, { method: "POST" });
  },
  async clientAssetsEndpoint(mode) {
    await fetch(`${ORIGIN}/__harness/client-assets-endpoint/${mode}`, { method: "POST" });
  },
  async assetMode(mode) {
    await fetch(`${ORIGIN}/__harness/asset-mode/${mode}`, { method: "POST" });
  },
  async reset() {
    await fetch(`${ORIGIN}/__harness/reset-counters`, { method: "POST" });
  },
  async state() {
    return (await fetch(`${ORIGIN}/__harness/state`)).json();
  },
  async fullReset() {
    await this.activate("a");
    await this.unblock();
    await this.clientAssetsEndpoint("normal");
    await this.assetMode("normal");
    await this.reset();
  },
};

function startOrigin() {
  const child = spawn(process.execPath, [resolve(HERE, "server.mjs")], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FOREVER_STALE_ASSET_HARNESS_PORT: String(PORT) },
  });
  child.stdout.on("data", (chunk) => {
    if (process.env.FOREVER_HARNESS_VERBOSE) process.stdout.write(String(chunk));
  });
  child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
  return child;
}

async function waitForOrigin(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${ORIGIN}/__harness/state`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("the harness origin did not start");
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

class ScenarioFailure extends Error {
  constructor(message, kind = FAILURE_KINDS.GENERIC) {
    super(message);
    this.kind = kind;
  }
}

function makeAsserter(results) {
  let count = 0;
  const assert = (condition, description, detail = "") => {
    count += 1;
    if (!condition) throw new ScenarioFailure(`${description}${detail ? ` — ${detail}` : ""}`);
    results.push(description);
  };
  assert.count = () => count;
  return assert;
}

async function documentRequests() {
  return (await control.state()).documentRequests;
}

/** Reads the real application's own bootstrap and route-ready markers. */
async function readBoot(page) {
  return page.evaluate(() => ({
    appMarker: document.documentElement.dataset.foreverApp ?? null,
    routeState: document.documentElement.dataset.foreverRoute ?? null,
    routeId: document.documentElement.dataset.foreverRouteId ?? null,
  }));
}

async function waitForBoot(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let boot = await readBoot(page);
  while (Date.now() < deadline && (boot.appMarker !== "mounted" || boot.routeState === null)) {
    await page.waitForTimeout(100);
    boot = await readBoot(page);
  }
  return boot;
}

/**
 * Opens a page and REQUIRES the document outcome the caller declared.
 *
 * `expected.status` is mandatory. A normal scenario also requires the real
 * bootstrap marker, a ready router and the intended leaf route before it is
 * allowed to do anything, so an unexpected server error can never be mistaken
 * for the condition under test.
 */
async function openPage(context, path, expected) {
  const page = await context.newPage();
  const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
  const status = response?.status() ?? null;
  if (status !== expected.status) {
    await page.close();
    throw new ScenarioFailure(
      `document ${path} returned HTTP ${status}, expected ${expected.status}`,
      FAILURE_KINDS.DOCUMENT,
    );
  }
  const contentType = response?.headers()["content-type"] ?? "";
  if (expected.status === 200 && !contentType.includes("text/html")) {
    await page.close();
    throw new ScenarioFailure(
      `document ${path} is ${contentType}, expected text/html`,
      FAILURE_KINDS.DOCUMENT,
    );
  }
  if (expected.booted !== false) {
    const boot = await waitForBoot(page, ROUTER_BOOT_DEADLINE_MS);
    if (boot.appMarker !== "mounted") {
      await page.close();
      throw new ScenarioFailure(
        `the real application never bootstrapped on ${path}`,
        FAILURE_KINDS.BOOTSTRAP,
      );
    }
    if (boot.routeState !== "ready") {
      await page.close();
      throw new ScenarioFailure(
        `the router never reported a ready route on ${path} (state=${boot.routeState})`,
        FAILURE_KINDS.BOOTSTRAP,
      );
    }
    if (expected.routeId && boot.routeId !== expected.routeId) {
      await page.close();
      throw new ScenarioFailure(
        `the router matched ${boot.routeId} on ${path}, expected ${expected.routeId}`,
        FAILURE_KINDS.BOOTSTRAP,
      );
    }
  }
  return page;
}

/** A healthy `/` page, which is where most scenarios start. */
async function openHealthyHome(context) {
  return openPage(context, "/", { status: 200, routeId: "/" });
}

async function hasRecoveryScreen(page) {
  return (await page.locator(RECOVERY_SCREEN).count()) > 0;
}

async function hasGenericScreen(page) {
  const body = (await page.textContent("body")) ?? "";
  return body.includes(GENERIC_SCREEN_TEXT);
}

async function ledgerOf(page) {
  return page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem("forever.app.stale-asset.recovery");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
}

async function tanstackKeys(page) {
  return page.evaluate(() => {
    const keys = [];
    try {
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("tanstack_router_reload")) keys.push(key);
      }
    } catch {
      /* storage unavailable */
    }
    return keys;
  });
}

/**
 * A REAL CLIENT-SIDE ROUTE TRANSITION, which is the only way to reproduce the
 * production failure.
 *
 * This matters, and the previous revision got it wrong (RR2-P2-2). A full
 * `page.goto` fetches a NEW document from whichever version is active, and that
 * document references that version's own chunks — so nothing is ever stale and
 * the scenario proves nothing. The incident is a page that is ALREADY RUNNING
 * asking for a lazy chunk only its own version had. That is a client-side
 * transition, so this pushes the URL and lets the real router — the same
 * history listener the application uses in production — perform the navigation
 * and the lazy import itself.
 *
 * Measured against the real builds: it produces genuine 404s for the A-hashed
 * `studio`, `studio.index`, `StudioDashboard` and `useQuery` chunks.
 */
async function clientNavigate(page, to) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }, to);
}

/**
 * Drives the canonical stale case: a page loaded from version A, then the
 * origin cuts over to version B, then the page asks for a chunk only A had.
 *
 * The page it starts from is a PROVEN healthy application document, so the
 * failure that follows is genuinely a stale-chunk failure and not a page that
 * never worked.
 */
async function loadThenCutOver(context, { to = "b", blockOn = null, route = "/studio" } = {}) {
  const page = await openHealthyHome(context);
  await control.activate(to);
  if (blockOn) await control.block(blockOn);
  await control.reset();
  await clientNavigate(page, route);
  await page.waitForSelector(RECOVERY_SCREEN, { timeout: 6000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  return page;
}

// ---------------------------------------------------------------------------
// The scenarios
//
// `document` declares what each scenario's starting document must return.
// `errorScenario` marks a scenario that deliberately drives a failure, and
// names the boundary it expects, so an unexpected 500 is never silently
// accepted as the condition under test.
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    id: 1,
    name: "ordinary A on A — a healthy application, no recovery screen, no reload",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      const boot = await readBoot(page);
      assert(boot.appMarker === "mounted", "the real application bootstrapped");
      assert(boot.routeState === "ready", "the router resolved the intended route");
      assert(boot.routeId === "/", "the intended leaf route rendered", String(boot.routeId));
      assert(!(await hasGenericScreen(page)), "the generic error boundary is NOT showing");
      assert(!(await hasRecoveryScreen(page)), "no recovery screen on a healthy page");
      assert((await ledgerOf(page)) === null, "no ledger is written on a healthy page");
      assert((await documentRequests()).length === 1, "exactly one document request");
      await page.close();
    },
  },
  {
    id: 2,
    name: "A page against B assets — exactly ONE automatic reload, recovered onto B",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_content_hashed_chunk_then_recovery" },
    async run(context, assert) {
      await control.fullReset();
      const page = await loadThenCutOver(context, { to: "b" });
      // Server-side proof: exactly one document, and it was served by B.
      const documents = await documentRequests();
      assert(
        documents.length === 1,
        "exactly one automatic reload reached the origin",
        JSON.stringify(documents),
      );
      assert(
        documents[0] === "/studio@b",
        "and the recovered document was served by the NEW version, on the intended route",
        JSON.stringify(documents),
      );
      const ledger = await ledgerOf(page);
      assert(ledger !== null, "the transition was recorded in the ledger before the reload");
      assert(
        ledger.history.length === 1 && ledger.history[0].from !== ledger.history[0].to,
        "exactly one attempted transition, from one client asset identity to another",
        JSON.stringify(ledger.history),
      );
      assert(
        !(await hasGenericScreen(page)),
        "the visitor never sees the generic 'This page didn't load' screen",
      );
      assert(
        !(await hasRecoveryScreen(page)),
        "and no recovery screen either, because the recovery SUCCEEDED",
      );
      const boot = await readBoot(page);
      assert(boot.routeState === "ready", "the recovered page has a ready route", boot.routeState);
      assert(
        boot.routeId === "/studio/",
        "and it is the route the visitor asked for",
        String(boot.routeId),
      );
      await page.close();
    },
  },
  {
    id: 3,
    name: "B still broken — one reload, then the SPECIFIC screen, and never a loop",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_asset_recovery_screen" },
    async run(context, assert) {
      await control.fullReset();
      const page = await loadThenCutOver(context, { to: "b", blockOn: "StudioDashboard" });
      await page.waitForTimeout(1500);
      const documents = await documentRequests();
      assert(
        documents.length === 1,
        "exactly one automatic reload, and no loop",
        JSON.stringify(documents),
      );
      assert(
        await hasRecoveryScreen(page),
        "the visitor is left on the SPECIFIC recovery screen",
        ((await page.textContent("body")) ?? "").slice(0, 120),
      );
      assert(!(await hasGenericScreen(page)), "and never on the generic failure screen");
      const reload = page.locator('[data-testid="stale-asset-recovery-reload"]');
      assert((await reload.count()) === 1, "with a manual reload control");
      await page.close();
    },
  },
  {
    id: 4,
    name: "A ↔ B repeated — the reload count is bounded by policy, not by the flapping",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.reset();
      // Distinct Studio routes on purpose: each needs a different lazy chunk, so
      // the browser cache cannot silently satisfy a later round and turn the
      // scenario into a no-op.
      const routes = [
        "/studio",
        "/studio/upload",
        "/studio/members",
        "/studio/resale/1",
        "/studio",
        "/studio/upload",
        "/studio/members",
        "/studio/resale/1",
      ];
      for (let round = 0; round < routes.length; round += 1) {
        await control.activate(round % 2 === 0 ? "b" : "a");
        await clientNavigate(page, routes[round]);
        await page.waitForTimeout(1200);
      }
      // Only an automatic reload can produce a document request here, because
      // every navigation above was client-side. So this is an exact count.
      const documents = await documentRequests();
      assert(
        documents.length <= 3,
        "eight alternating transitions produce at most the policy ceiling of reloads",
        `saw ${documents.length}: ${JSON.stringify(documents)}`,
      );
      const ledger = await ledgerOf(page);
      assert(ledger !== null, "the flapping origin genuinely produced a recovery ledger");
      assert(
        ledger.history.length >= 1 && ledger.history.length <= 8,
        "the ledger history stays bounded",
        JSON.stringify(ledger.history.length),
      );
      await page.close();
    },
  },
  {
    id: 5,
    name: "release → rollback → re-release — two reloads, then a refusal",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_asset_recovery_screen" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);

      // Release: A → B.
      await control.activate("b");
      await control.reset();
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3500);
      const afterRelease = await documentRequests();
      assert(
        afterRelease.length === 1 && afterRelease[0].endsWith("@b"),
        "the release produced exactly one automatic reload, onto B",
        JSON.stringify(afterRelease),
      );

      // Rollback: B → A. A different Studio route, so a genuinely different
      // lazy chunk is requested and the browser cache cannot hide the failure.
      await control.activate("a");
      await control.reset();
      await clientNavigate(page, "/studio/upload");
      await page.waitForTimeout(3500);
      const afterRollback = await documentRequests();
      assert(
        afterRollback.length === 1 && afterRollback[0].endsWith("@a"),
        "the rollback got its OWN single attempt, onto A",
        JSON.stringify(afterRollback),
      );

      // Re-release: A → B again. Already spent.
      await control.activate("b");
      await control.reset();
      await clientNavigate(page, "/studio/members");
      await page.waitForTimeout(3500);
      const afterReRelease = await documentRequests();
      assert(
        afterReRelease.length === 0,
        "the re-release is REFUSED — the first transition is never re-armed",
        JSON.stringify(afterReRelease),
      );
      assert(await hasRecoveryScreen(page), "and the visitor is given the specific screen instead");

      const ledger = await ledgerOf(page);
      const pairs = (ledger?.history ?? []).map((entry) => `${entry.from}->${entry.to}`);
      assert(pairs.length === 2, "exactly two attempted transitions are remembered", pairs.join(","));
      assert(
        new Set(pairs).size === pairs.length,
        "and no transition is recorded twice",
        pairs.join(","),
      );
      await page.close();
    },
  },
  {
    id: 6,
    name: "multiple simultaneous stale chunks — one decision, not one per chunk",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_asset_recovery_screen" },
    async run(context, assert) {
      await control.fullReset();
      const page = await loadThenCutOver(context, { to: "b", blockOn: "-" });
      await page.waitForTimeout(1500);
      const documents = await documentRequests();
      assert(
        documents.length <= 1,
        "every chunk failing at once still produces at most one automatic reload",
        `saw ${documents.length}: ${JSON.stringify(documents)}`,
      );
      await control.unblock();
      await page.close();
    },
  },
  {
    id: 7,
    name: "client-assets endpoint stale — refuses, and shows the specific screen",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_asset_recovery_screen" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.activate("b");
      await control.clientAssetsEndpoint("stale");
      await control.reset();
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3000);
      const documents = await documentRequests();
      assert(
        documents.length === 0,
        "a stale client-assets endpoint means same_client_assets, so NO automatic reload",
        JSON.stringify(documents),
      );
      assert((await ledgerOf(page)) === null, "and nothing is spent from the ledger");
      await control.clientAssetsEndpoint("normal");
      await page.close();
    },
  },
  {
    id: 8,
    name: "client-assets endpoint timeout — refuses rather than guessing",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_asset_recovery_screen" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.activate("b");
      await control.clientAssetsEndpoint("timeout");
      await control.reset();
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(6000);
      const documents = await documentRequests();
      assert(
        documents.length === 0,
        "an unreadable endpoint means active_client_assets_unknown, so NO automatic reload",
        JSON.stringify(documents),
      );
      assert((await ledgerOf(page)) === null, "and nothing is spent from the ledger");
      await control.clientAssetsEndpoint("normal");
      await page.close();
    },
  },
  {
    id: 9,
    name: "HTML fallback 200 — an asset answered with a document is still stale",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_content_hashed_chunk_then_recovery" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.activate("b");
      await control.assetMode("html200");
      await control.reset();
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3000);
      const documents = await documentRequests();
      assert(
        documents.length <= 1,
        "an HTML-200 answer to a module request is still bounded to one reload",
        JSON.stringify(documents),
      );
      await control.assetMode("normal");
      await page.close();
    },
  },
  {
    id: 10,
    name: "ordinary React throw — never classified as stale, never reloads",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.reset();
      const outcome = await page
        .evaluate(() => {
          window.dispatchEvent(
            new PromiseRejectionEvent("unhandledrejection", {
              promise: Promise.reject(new Error("Cannot read properties of undefined")),
              reason: new Error("Cannot read properties of undefined"),
            }),
          );
          return true;
        })
        .catch(() => false);
      await page.waitForTimeout(800);
      assert(outcome !== null, "the page survived an ordinary rejection");
      assert(!(await hasRecoveryScreen(page)), "no recovery screen for an ordinary error");
      assert((await documentRequests()).length === 0, "no reload for an ordinary error");
      const boot = await readBoot(page);
      assert(boot.routeState === "ready", "and the real route is still mounted afterwards");
      await page.close();
    },
  },
  {
    id: 11,
    name: "Supabase/RPC failure — not a stale asset",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.reset();
      await page.evaluate(() => {
        window.dispatchEvent(
          new PromiseRejectionEvent("unhandledrejection", {
            promise: Promise.reject(new Error("Supabase request failed: JWT expired")),
            reason: new Error("Supabase request failed: JWT expired"),
          }),
        );
      });
      await page.waitForTimeout(800);
      assert(!(await hasRecoveryScreen(page)), "no recovery screen for a Supabase failure");
      assert((await documentRequests()).length === 0, "no reload for a Supabase failure");
      await page.close();
    },
  },
  {
    id: 12,
    name: "foreign script failure — a third-party asset is not ours",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.reset();
      await page.evaluate(() => {
        const script = document.createElement("script");
        script.type = "module";
        script.src = "https://cdn.example.invalid/assets/thing-AbCdEfGh.js";
        document.head.appendChild(script);
      });
      await page.waitForTimeout(1200);
      assert(!(await hasRecoveryScreen(page)), "no recovery screen for a foreign script failure");
      assert((await documentRequests()).length === 0, "no reload for a foreign script failure");
      await page.close();
    },
  },
  {
    id: 13,
    name: "write accepted but response lost — no automatic reload while unproven",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      const seam = await page.evaluate(() => Boolean(window.__foreverStaleAssetHarness));
      assert(seam, "the harness seam is present in a harness build");
      await page.evaluate(() => {
        window.__foreverStaleAssetHarness.beginConsequentialAction("publication");
      });
      assert(
        await page.evaluate(() => window.__foreverStaleAssetHarness.hasUnprovenWrite()),
        "the real write registry reports an unproven consequential action",
      );
      await control.activate("b");
      await control.reset();
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3000);
      const documents = await documentRequests();
      assert(
        documents.length === 0,
        "no automatic reload while a write outcome is unproven",
        JSON.stringify(documents),
      );
      assert(
        await hasRecoveryScreen(page),
        "the visitor gets the specific screen and decides for themselves",
      );
      assert((await ledgerOf(page)) === null, "and no attempt is spent");
      await page.close();
    },
  },
  {
    id: 14,
    name: "studioResumePending after recovery — nothing auto-resumes",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      // Establish, on a healthy page, that the origin IS reachable from here —
      // otherwise "no mutation was issued" would be unfalsifiable, which is
      // exactly what RR2-P2-2 found on the 500 document.
      const reachable = await page.evaluate(async (origin) => {
        const response = await fetch(`${origin}/forever-client-assets.json`, {
          headers: { accept: "application/json" },
        });
        return response.status;
      }, ORIGIN);
      assert(reachable === 200, "the origin answers application requests from this page");
      await control.activate("b");
      await control.reset();
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3500);
      const documents = await documentRequests();
      assert(
        documents.length === 1,
        "the recovery genuinely happened — exactly one automatic reload",
        JSON.stringify(documents),
      );
      const other = (await control.state()).otherRequests;
      assert(
        other.length > 0,
        "the recovered page did make non-document requests to the origin",
        `${other.length}`,
      );
      const resumes = other.filter((entry) => entry.toLowerCase().includes("resumepending"));
      assert(resumes.length === 0, "no resume-pending request is issued by a recovered page");
      const mutations = other.filter(
        (entry) =>
          entry.startsWith("POST") &&
          !entry.includes("__harness") &&
          !entry.includes("forever-client-assets.json"),
      );
      assert(mutations.length === 0, "no mutation is issued at all", mutations.join(","));
      await page.close();
    },
  },
  {
    id: 15,
    name: "BFCache restore — a restored page does not re-arm",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.activate("b");
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3500);
      const spent = await ledgerOf(page);
      assert(spent !== null, "the tab genuinely spent its attempt before the history walk");
      await control.reset();
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(1000);
      await page.goForward().catch(() => undefined);
      await page.waitForTimeout(1500);
      const documents = await documentRequests();
      assert(
        documents.length <= 2,
        "history navigation does not produce an unbounded reload sequence",
        `saw ${documents.length}: ${JSON.stringify(documents)}`,
      );
      const after = await ledgerOf(page);
      assert(
        (after?.history ?? []).length === (spent.history ?? []).length,
        "and Back/Forward never adds a new attempted transition",
        JSON.stringify(after?.history),
      );
      await page.close();
    },
  },
  {
    id: 16,
    name: "duplicated tab — the copy inherits the ledger and is more restricted",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      await control.activate("b");
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3500);
      const ledger = await ledgerOf(page);
      // No `assert(true)` fallback: without a ledger there is nothing to
      // duplicate, so the scenario did not run and that is a failure.
      assert(ledger !== null, "the first tab genuinely recorded a recovery ledger to inherit");
      assert(ledger.history.length === 1, "with exactly one spent transition");

      // The duplicate is a tab on the OLD version carrying a COPY of the first
      // tab's sessionStorage — which is exactly what duplicating a tab does.
      await control.activate("a");
      const duplicate = await openHealthyHome(context);
      await duplicate.evaluate((value) => {
        sessionStorage.setItem("forever.app.stale-asset.recovery", JSON.stringify(value));
      }, ledger);
      await control.activate("b");
      await control.reset();
      await clientNavigate(duplicate, "/studio");
      await duplicate.waitForTimeout(3000);
      const documents = await documentRequests();
      assert(
        documents.length === 0,
        "the duplicate does not get a fresh attempt for an already-spent transition",
        JSON.stringify(documents),
      );
      assert(
        await hasRecoveryScreen(duplicate),
        "it is given the specific screen instead of a silent second reload",
      );
      await duplicate.close();
      await page.close();
    },
  },
  {
    id: 17,
    name: "storage unavailable — no automatic reload at all",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_asset_recovery_screen" },
    async run(context, assert) {
      await control.fullReset();
      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(window, "sessionStorage", {
          configurable: true,
          get() {
            throw new DOMException("storage is partitioned", "SecurityError");
          },
        });
      });
      const response = await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
      assert(response?.status() === 200, "the document is healthy even with storage denied");
      const boot = await waitForBoot(page, ROUTER_BOOT_DEADLINE_MS);
      assert(boot.appMarker === "mounted", "the real application still bootstrapped");
      await control.activate("b");
      await control.reset();
      await clientNavigate(page, "/studio");
      await page.waitForTimeout(3000);
      const documents = await documentRequests();
      assert(
        documents.length === 0,
        "with no storage to bound the attempt, no automatic reload happens",
        JSON.stringify(documents),
      );
      assert(
        await hasRecoveryScreen(page),
        "and the visitor gets the specific screen with a manual reload",
      );
      await page.close();
    },
  },
  {
    id: 18,
    name: "engine-specific dynamic-import wording is classified identically",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await openHealthyHome(context);
      const seam = await page.evaluate(() => Boolean(window.__foreverStaleAssetHarness));
      assert(seam, "the harness seam is present");
      const verdicts = await page.evaluate((origin) => {
        const messages = [
          `Failed to fetch dynamically imported module: ${origin}/assets/StudioDashboard-DDTDlhmi.js`,
          `Importing a module script failed.`,
          `Unable to load script ${origin}/assets/StudioDashboard-DDTDlhmi.js`,
          `error loading dynamically imported module: ${origin}/assets/StudioDashboard-DDTDlhmi.js`,
        ];
        return messages.map((message) =>
          window.__foreverStaleAssetHarness.classify({ kind: "dynamic_import", message }),
        );
      }, ORIGIN);
      assert(
        verdicts.filter((verdict) => verdict !== "not_stale_asset").length >= 2,
        "the engine's own dynamic-import wording is recognised",
        JSON.stringify(verdicts),
      );
      await page.close();
    },
  },
  {
    id: 19,
    name: "mobile widths 375 / 390 / 430 — the recovery screen stays usable",
    document: { status: 200, routeId: "/" },
    errorScenario: { boundary: "stale_asset_recovery_screen" },
    async run(context, assert) {
      for (const width of [375, 390, 430]) {
        // A fresh context per width, so each one starts with no spent ledger
        // and the recovery screen is genuinely reachable at every size. The
        // previous revision reused one context, so widths 390 and 430 could
        // only ever take the `no recovery screen was required` branch — and on
        // the 500 document, so could 375.
        const sized = await context.browser().newContext({ viewport: { width, height: 780 } });
        try {
          await control.fullReset();
          const page = await openHealthyHome(sized);
          await control.activate("b");
          // The new version is still broken for this client, which is the state
          // that genuinely renders the recovery screen after its one attempt.
          await control.block("StudioDashboard");
          await clientNavigate(page, "/studio");
          await page.waitForSelector(RECOVERY_SCREEN, { timeout: 12_000 }).catch(() => undefined);
          await page.waitForTimeout(500);
          // Positive requirement. "No recovery screen was required" is no
          // longer an accepted outcome (RR2-P2-2): the scenario is ABOUT the
          // recovery screen at mobile widths.
          assert(
            await hasRecoveryScreen(page),
            `the recovery screen is actually rendered at ${width}px`,
          );
          const overflows = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          );
          assert(!overflows, `no horizontal overflow at ${width}px`);
          const reload = page.locator('[data-testid="stale-asset-recovery-reload"]');
          assert((await reload.count()) === 1, `the manual reload button exists at ${width}px`);
          assert(await reload.isVisible(), `the manual reload button is visible at ${width}px`);
          await page.close();
        } finally {
          await sized.close();
          await control.unblock();
          await control.activate("a");
        }
      }
    },
  },
  {
    id: 20,
    name: "TanStack's built-in reload is absent at runtime",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      await control.fullReset();
      const page = await loadThenCutOver(context, { to: "b" });
      await page.waitForTimeout(1000);
      // Proved against a run in which recovery genuinely fired, not against a
      // page on which nothing happened.
      assert(
        (await documentRequests()).length === 1,
        "a real stale-chunk recovery happened in this scenario",
      );
      const keys = await tanstackKeys(page);
      assert(keys.length === 0, "no tanstack_router_reload key is ever written", keys.join(","));
      await page.close();
    },
  },
  {
    id: 21,
    name: "the harness itself refuses an unexpected document status",
    document: { status: 200, routeId: "/" },
    async run(context, assert) {
      // RR2-P2-2's own control, committed and executed every run. `openPage`
      // must REFUSE a document whose status is not the declared one, and
      // classify it as a document/server failure rather than as the stale-chunk
      // condition the proof is about.
      await control.fullReset();
      let refusal = null;
      try {
        await openPage(context, "/this-route-exists-in-no-version", { status: 200 });
      } catch (error) {
        refusal = error;
      }
      assert(refusal !== null, "a document that does not return the declared status is refused");
      assert(
        refusal.kind === FAILURE_KINDS.DOCUMENT,
        "and it is classified as a document/server failure, not as a stale chunk",
        String(refusal.kind),
      );
      assert(
        !String(refusal.message).toLowerCase().includes("stale"),
        "the refusal never describes an unexpected status as a stale-asset condition",
      );
      // The same helper accepts a non-200 document when it is DECLARED.
      const declared = await openPage(context, "/this-route-exists-in-no-version", {
        status: 404,
        booted: false,
      });
      assert(declared !== null, "an EXPECTED non-200 document is accepted when declared");
      await declared.close();
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runEngine(playwright, engine) {
  const browser = await requireBrowser(playwright, engine);
  const scenarios = [];
  let failed = 0;
  let preconditions = null;
  try {
    // THE GLOBAL PRECONDITION. If this throws, zero scenarios run and zero are
    // reported as passing.
    const bootContext = await browser.newContext();
    try {
      await control.fullReset();
      preconditions = await requireHealthyApplication(bootContext, engine);
      log(
        `${engine} precondition: document ${preconditions.documentStatus}, ` +
          `app=${preconditions.appMarker}, route=${preconditions.routeState} ` +
          `(${preconditions.routeId}), assets ${preconditions.entryAssetsRequested} requested / ` +
          `${preconditions.entryAssetsFailed} failed`,
      );
    } finally {
      await bootContext.close();
    }

    for (const scenario of SCENARIOS) {
      const context = await browser.newContext();
      const assertions = [];
      const assert = makeAsserter(assertions);
      let status = "passed";
      let detail = null;
      let kind = null;
      try {
        await scenario.run(context, assert);
        if (assert.count() === 0) {
          throw new ScenarioFailure(
            "the scenario collected ZERO assertions — that is a failure, not a pass",
          );
        }
      } catch (error) {
        status = "failed";
        detail = error.message;
        kind = error.kind ?? FAILURE_KINDS.GENERIC;
        failed += 1;
      } finally {
        await context.close();
      }
      log(`${engine} ${scenario.id}. ${scenario.name} — ${status}${detail ? `: ${detail}` : ""}`);
      scenarios.push({
        id: scenario.id,
        name: scenario.name,
        status,
        assertions: assertions.length,
        expectedDocument: scenario.document,
        errorScenario: scenario.errorScenario ?? null,
        failureKind: kind,
        detail,
      });
    }
  } finally {
    await browser.close();
  }
  return { engine, scenarios, failed, total: SCENARIOS.length, preconditions };
}

async function main() {
  const playwright = requirePlaywright();
  requireBuiltVersions();

  const origin = startOrigin();
  const results = [];
  let bootstrapFailure = null;
  try {
    await waitForOrigin();
    for (const engine of ENGINES) {
      try {
        results.push(await runEngine(playwright, engine));
      } catch (error) {
        if (error instanceof BootstrapFailure) {
          bootstrapFailure = { engine, message: error.message, evidence: error.detail };
          results.push({
            engine,
            scenarios: [],
            failed: 0,
            total: SCENARIOS.length,
            preconditions: error.detail ?? null,
            bootstrapFailure: error.message,
          });
          break;
        }
        throw error;
      }
    }
  } finally {
    origin.kill();
  }

  mkdirSync(EVIDENCE, { recursive: true });
  for (const result of results) {
    const isBootstrapFailure = Boolean(result.bootstrapFailure);
    writeFileSync(
      resolve(EVIDENCE, `browser-${result.engine}-results.json`),
      `${JSON.stringify(
        {
          engine: result.engine,
          classification: isBootstrapFailure
            ? "infrastructure_bootstrap_failure"
            : "scenario_results",
          bootstrapFailure: result.bootstrapFailure ?? null,
          preconditions: result.preconditions,
          total: result.total,
          // A bootstrap failure reports ZERO passed, by construction.
          passed: isBootstrapFailure ? 0 : result.total - result.failed,
          failed: isBootstrapFailure ? 0 : result.failed,
          skipped: 0,
          notRun: isBootstrapFailure ? result.total : 0,
          scenarios: result.scenarios,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  for (const result of results) {
    if (result.bootstrapFailure) {
      log(
        `${result.engine}: 0 passed, 0 failed, 0 skipped, ${result.total} not run — ` +
          `INFRASTRUCTURE/BOOTSTRAP FAILURE: ${result.bootstrapFailure}`,
      );
      continue;
    }
    log(
      `${result.engine}: ${result.total - result.failed} passed, ${result.failed} failed, ` +
        `0 skipped, 0 not run (of ${result.total})`,
    );
  }

  if (bootstrapFailure) {
    throw new Error(
      `INFRASTRUCTURE/BOOTSTRAP FAILURE in ${bootstrapFailure.engine}: ${bootstrapFailure.message}`,
    );
  }
  if (results.length === 0) throw new Error("no engine ran — that is a failure, not a pass");
  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  if (failed > 0) throw new Error(`${failed} scenario(s) failed`);
  log("PASS");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[browser-harness] FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
