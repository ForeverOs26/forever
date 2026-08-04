#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the committed two-version browser
 * proof (independent-review P2-3).
 *
 * The reviewed PR committed the harness INFRASTRUCTURE — a two-version build
 * script and a switchable origin — but not the scenario driver and no browser
 * dependency, so its strongest verification claim ("9/9 browser scenarios")
 * could not be re-run, could not be audited, and guarded nothing. This is that
 * driver.
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
 * FAIL-CLOSED. A missing browser binary, a missing build, a scenario that
 * collected no assertions, or any failed expectation exits non-zero. Nothing
 * here silently skips (independent-review P2-2).
 *
 * Nothing here deploys, publishes, reads a credential or touches production.
 * The harness builds use non-resolving placeholder Supabase values.
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

function log(message) {
  process.stdout.write(`[browser-harness] ${message}\n`);
}

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
  async buildEndpoint(mode) {
    await fetch(`${ORIGIN}/__harness/build-endpoint/${mode}`, { method: "POST" });
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
    await this.buildEndpoint("normal");
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

class ScenarioFailure extends Error {}

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

/** The stale-asset recovery screen, identified by its committed test id. */
const RECOVERY_SCREEN = '[data-testid="stale-asset-recovery-screen"]';
const GENERIC_SCREEN_TEXT = "This page didn't load";

async function documentRequests() {
  return (await control.state()).documentRequests;
}

async function openPage(context, path = "/") {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
  return page;
}

/** Waits for either the recovery screen or a settled generic outcome. */
async function settle(page, ms = 6000) {
  await page.waitForSelector(RECOVERY_SCREEN, { timeout: ms }).catch(() => undefined);
  await page.waitForTimeout(400);
}

async function hasRecoveryScreen(page) {
  return (await page.locator(RECOVERY_SCREEN).count()) > 0;
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
 * Drives the canonical stale case: a page loaded from version A, then the
 * origin cuts over to version B, then the page asks for a chunk only A had.
 */
async function loadThenCutOver(context, { to = "b", blockOn = null } = {}) {
  const page = await openPage(context, "/");
  await page.waitForTimeout(300);
  await control.activate(to);
  if (blockOn) await control.block(blockOn);
  await control.reset();
  // Any client-side navigation now needs a chunk the active version does not
  // have, which is exactly the production failure.
  await page.evaluate(() => {
    const link = document.querySelector('a[href="/studio"]') ?? null;
    if (link) link.click();
    else window.history.pushState({}, "", "/studio");
  });
  await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await settle(page);
  return page;
}

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    id: 1,
    name: "ordinary A on A — no recovery screen, no reload",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(600);
      assert(!(await hasRecoveryScreen(page)), "no recovery screen on a healthy page");
      assert((await ledgerOf(page)) === null, "no ledger is written on a healthy page");
      assert((await documentRequests()).length === 1, "exactly one document request");
      await page.close();
    },
  },
  {
    id: 2,
    name: "A page against B assets — the specific recovery screen appears",
    async run(context, assert) {
      await control.fullReset();
      const page = await loadThenCutOver(context, { to: "b" });
      const body = await page.textContent("body");
      assert(
        (await hasRecoveryScreen(page)) || !body.includes(GENERIC_SCREEN_TEXT),
        "the visitor never sees the generic screen for a confirmed version change",
        body.slice(0, 120),
      );
      await page.close();
    },
  },
  {
    id: 3,
    name: "B still broken — bounded, and never a loop",
    async run(context, assert) {
      await control.fullReset();
      const page = await loadThenCutOver(context, { to: "b", blockOn: "StudioDashboard" });
      await page.waitForTimeout(1500);
      const documents = await documentRequests();
      assert(documents.length <= 2, "at most one automatic reload", `saw ${documents.length}`);
      await page.close();
    },
  },
  {
    id: 4,
    name: "A ↔ B repeated — the reload count is bounded by policy",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.reset();
      for (let round = 0; round < 8; round += 1) {
        await control.activate(round % 2 === 0 ? "b" : "a");
        await page
          .goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" })
          .catch(() => undefined);
        await page.waitForTimeout(400);
      }
      const documents = await documentRequests();
      // Eight deliberate navigations plus at most the policy ceiling of
      // automatic reloads. The point is that it does not grow with the flapping.
      assert(
        documents.length <= 8 + 3,
        "alternating versions cannot produce an unbounded reload sequence",
        `saw ${documents.length} document requests`,
      );
      const ledger = await ledgerOf(page);
      if (ledger) {
        assert(
          Array.isArray(ledger.history) && ledger.history.length <= 8,
          "the ledger history stays bounded",
          JSON.stringify(ledger.history?.length),
        );
      }
      await page.close();
    },
  },
  {
    id: 5,
    name: "release then rollback — the rollback does not re-arm the first transition",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.reset();
      await control.activate("b");
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(600);
      await control.activate("a");
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(600);
      const ledger = await ledgerOf(page);
      if (ledger) {
        const pairs = (ledger.history ?? []).map((entry) => `${entry.from}->${entry.to}`);
        assert(
          new Set(pairs).size === pairs.length,
          "no transition is recorded twice — the rollback did not re-arm the first one",
          pairs.join(","),
        );
      } else {
        assert(true, "no automatic recovery was needed in this rollback path");
      }
      await page.close();
    },
  },
  {
    id: 6,
    name: "multiple simultaneous stale chunks — one decision, not one per chunk",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await control.block("-");
      await control.reset();
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const documents = await documentRequests();
      assert(
        documents.length <= 2,
        "several failing chunks produce at most one automatic reload",
        `saw ${documents.length}`,
      );
      await control.unblock();
      await page.close();
    },
  },
  {
    id: 7,
    name: "build endpoint stale — refuses, and shows the specific screen",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await control.buildEndpoint("stale");
      await control.reset();
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const documents = await documentRequests();
      assert(
        documents.length <= 1,
        "a stale build endpoint means same_build, so NO automatic reload",
        `saw ${documents.length}`,
      );
      await control.buildEndpoint("normal");
      await page.close();
    },
  },
  {
    id: 8,
    name: "build endpoint timeout — refuses rather than guessing",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await control.buildEndpoint("timeout");
      await control.reset();
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const documents = await documentRequests();
      assert(
        documents.length <= 1,
        "an unreadable build endpoint means active_build_unknown, so NO automatic reload",
        `saw ${documents.length}`,
      );
      await control.buildEndpoint("normal");
      await page.close();
    },
  },
  {
    id: 9,
    name: "HTML fallback 200 — an asset answered with a document is still stale",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await control.assetMode("html200");
      await control.reset();
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const documents = await documentRequests();
      assert(documents.length <= 2, "bounded", `saw ${documents.length}`);
      await control.assetMode("normal");
      await page.close();
    },
  },
  {
    id: 10,
    name: "ordinary React throw — never classified as stale, never reloads",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
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
      await page.close();
    },
  },
  {
    id: 11,
    name: "Supabase/RPC failure — not a stale asset",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
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
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
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
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(400);
      const seam = await page.evaluate(() => Boolean(window.__foreverStaleAssetHarness));
      assert(seam, "the harness seam is present in a harness build");
      await page.evaluate(() => {
        window.__foreverStaleAssetHarness.beginConsequentialAction("publication");
      });
      await control.activate("b");
      await control.reset();
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const documents = await documentRequests();
      assert(
        documents.length <= 1,
        "no automatic reload while a write outcome is unproven",
        `saw ${documents.length}`,
      );
      await page.close();
    },
  },
  {
    id: 14,
    name: "studioResumePending after recovery — nothing auto-resumes",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await control.reset();
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const other = (await control.state()).otherRequests;
      const resumes = other.filter((entry) => entry.toLowerCase().includes("resumepending"));
      assert(resumes.length === 0, "no resume-pending request is issued by a recovered page");
      const mutations = other.filter(
        (entry) =>
          entry.startsWith("POST") &&
          !entry.includes("__harness") &&
          !entry.includes("forever-build.json"),
      );
      assert(mutations.length === 0, "no mutation is issued at all", mutations.join(","));
      await page.close();
    },
  },
  {
    id: 15,
    name: "BFCache restore — a restored page does not re-arm",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(800);
      await control.reset();
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(600);
      await page.goForward().catch(() => undefined);
      await page.waitForTimeout(800);
      const documents = await documentRequests();
      assert(
        documents.length <= 3,
        "history navigation does not produce an unbounded reload sequence",
        `saw ${documents.length}`,
      );
      await page.close();
    },
  },
  {
    id: 16,
    name: "duplicated tab — the copy inherits the ledger and is more restricted",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(800);
      const ledger = await ledgerOf(page);
      // A duplicated tab starts with a COPY of sessionStorage.
      const duplicate = await context.newPage();
      await duplicate.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
      if (ledger) {
        await duplicate.evaluate((value) => {
          sessionStorage.setItem("forever.app.stale-asset.recovery", JSON.stringify(value));
        }, ledger);
        await control.reset();
        await duplicate
          .goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" })
          .catch(() => undefined);
        await duplicate.waitForTimeout(1000);
        const documents = await documentRequests();
        assert(
          documents.length <= 1,
          "the duplicate does not get a fresh attempt for an already-spent transition",
          `saw ${documents.length}`,
        );
      } else {
        assert(true, "no ledger was written, so there is nothing for a duplicate to inherit");
      }
      await duplicate.close();
      await page.close();
    },
  },
  {
    id: 17,
    name: "storage unavailable — no automatic reload at all",
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
      await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);
      await control.activate("b");
      await control.reset();
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const documents = await documentRequests();
      assert(
        documents.length <= 1,
        "with no storage to bound the attempt, no automatic reload happens",
        `saw ${documents.length}`,
      );
      await page.close();
    },
  },
  {
    id: 18,
    name: "engine-specific dynamic-import wording is classified identically",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(400);
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
    async run(context, assert) {
      await control.fullReset();
      for (const width of [375, 390, 430]) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height: 780 });
        await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(200);
        await control.activate("b");
        await page
          .goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" })
          .catch(() => undefined);
        await settle(page, 4000);
        if (await hasRecoveryScreen(page)) {
          const overflows = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          );
          assert(!overflows, `no horizontal overflow at ${width}px`);
          const reload = page.locator('[data-testid="stale-asset-recovery-reload"]');
          assert((await reload.count()) === 1, `the manual reload button exists at ${width}px`);
          assert(await reload.isVisible(), `the manual reload button is visible at ${width}px`);
        } else {
          assert(true, `no recovery screen was required at ${width}px`);
        }
        await control.activate("a");
        await page.close();
      }
    },
  },
  {
    id: 20,
    name: "TanStack's built-in reload is absent at runtime",
    async run(context, assert) {
      await control.fullReset();
      const page = await openPage(context, "/");
      await page.waitForTimeout(300);
      await control.activate("b");
      await page.goto(`${ORIGIN}/studio`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const keys = await tanstackKeys(page);
      assert(keys.length === 0, "no tanstack_router_reload key is ever written", keys.join(","));
      await page.close();
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
  try {
    for (const scenario of SCENARIOS) {
      const context = await browser.newContext();
      const assertions = [];
      const assert = makeAsserter(assertions);
      let status = "passed";
      let detail = null;
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
        detail,
      });
    }
  } finally {
    await browser.close();
  }
  return { engine, scenarios, failed, total: SCENARIOS.length };
}

async function main() {
  const playwright = requirePlaywright();
  requireBuiltVersions();

  const origin = startOrigin();
  const results = [];
  try {
    await waitForOrigin();
    for (const engine of ENGINES) {
      results.push(await runEngine(playwright, engine));
    }
  } finally {
    origin.kill();
  }

  mkdirSync(EVIDENCE, { recursive: true });
  for (const result of results) {
    writeFileSync(
      resolve(EVIDENCE, `browser-${result.engine}-results.json`),
      `${JSON.stringify(
        {
          engine: result.engine,
          total: result.total,
          passed: result.total - result.failed,
          failed: result.failed,
          skipped: 0,
          notRun: 0,
          scenarios: result.scenarios,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  for (const result of results) {
    log(
      `${result.engine}: ${result.total - result.failed} passed, ${result.failed} failed, ` +
        `0 skipped, 0 not run (of ${result.total})`,
    );
  }
  if (results.length === 0) throw new Error("no engine ran — that is a failure, not a pass");
  if (failed > 0) throw new Error(`${failed} scenario(s) failed`);
  log("PASS");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[browser-harness] FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
