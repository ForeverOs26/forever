/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the acceptance suite reports
 * honestly, and the browser proof fails closed (independent-review P2-2, P2-3,
 * P2-6).
 *
 * Three separate inaccuracies were found, and all three were about REPORTING
 * rather than about behaviour:
 *
 *   P2-2  six generated-Worker-config and client-secret checks silently became
 *         `it.skip` when `.output` was absent, and the suite still reported
 *         green;
 *   P2-6  the implementation report presented "143 passed / 6 skipped" as
 *         "149 passed", which is exactly what concealed P2-2;
 *   P2-3  the strongest verification claim — 9/9 browser scenarios — could not
 *         be re-run, because neither the driver nor a browser dependency was
 *         committed.
 *
 * A suite that cannot lie about its own totals is the fix, so the totals are
 * produced by a machine and the machine is pinned here.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const FOCUSED_RUNNER = "scripts/studio/run-focused-stale-asset-suite.mjs";
const BROWSER_RUNNER = "scripts/studio/stale-asset-harness/run-browser-scenarios.mjs";
const HARNESS_SERVER = "scripts/studio/stale-asset-harness/server.mjs";
const HARNESS_BUILD = "scripts/studio/stale-asset-harness/build-versions.mjs";

describe("the focused suite reports passed, failed and skipped SEPARATELY", () => {
  const runner = read(FOCUSED_RUNNER);

  it("counts each status independently, from a machine-readable report", () => {
    expect(runner).toContain("--reporter=json");
    for (const line of [
      'passed: tests.filter((test) => test.status === "passed").length',
      'failed: tests.filter((test) => test.status === "failed").length',
      'todo: tests.filter((test) => test.status === "todo").length',
    ]) {
      expect(runner, line).toContain(line);
    }
    expect(runner).toContain("skipped: tests.filter(");
    expect(runner).toContain("notRun:");
  });

  it("NEVER adds skipped tests to passed tests", () => {
    // Independent-review P2-6, stated as an assertion the runner makes about
    // itself: passed must equal total, which is only true when nothing skipped.
    expect(runner).toContain("if (counts.passed !== counts.total)");
    expect(runner).toContain("skipped tests must ");
    expect(runner).toContain("never be added to passed tests");
  });

  it("FAILS on any skip, rather than reporting green", () => {
    expect(runner).toContain("if (counts.skipped > 0)");
    expect(runner).toContain("must contain zero ");
    expect(runner).toContain("unintended skips");
    expect(runner).toContain("process.exitCode = 1");
  });

  it("FAILS when the suite collected zero tests", () => {
    expect(runner).toContain("the suite collected ZERO tests — that is not a pass");
  });

  it("FAILS when a declared file did not run", () => {
    expect(runner).toContain("declared file(s) did not run");
  });

  it("FAILS when there is no production build to assert against", () => {
    expect(runner).toContain(
      "a missing or non-production build artifact is a FAILURE, never a skip",
    );
    expect(runner).toContain("requireProductionBuild()");
    expect(runner).toContain("does not carry the recorded production identity");
  });

  it("enumerates every focused file, and every one of them exists", () => {
    const declared = [...runner.matchAll(/"(src\/lib\/stale-asset\/[^"]+\.tsx?)"/g)].map(
      (match) => match[1],
    );
    expect(declared.length).toBeGreaterThanOrEqual(10);
    for (const file of declared) {
      expect(existsSync(resolve(process.cwd(), file)), file).toBe(true);
    }
  });

  it("is reachable as one package script", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["studio:stale-asset-focused"]).toBe(`node ${FOCUSED_RUNNER}`);
  });
});

describe("no stale-asset test may silently skip", () => {
  it("the focused suite contains no conditional `it.skip` or `maybe` gate", () => {
    const files = [
      "src/lib/stale-asset/worker-config-contract.test.ts",
      "src/lib/stale-asset/tanstack-reload-ownership.test.ts",
      "src/lib/stale-asset/client-asset-identity.test.ts",
      "src/lib/stale-asset/studio-write-contract.test.ts",
    ];
    for (const file of files) {
      // A comment may DESCRIBE the removed skip; code may not contain one.
      const code = read(file)
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join("\n");
      expect(code, `${file} uses it.skip`).not.toContain("it.skip");
      expect(code, `${file} uses describe.skip`).not.toContain("describe.skip");
      expect(code, `${file} uses a maybe gate`).not.toMatch(/const maybe\s*=/);
    }
  });
});

describe("the browser proof is committed, runnable and fail-closed", () => {
  const driver = read(BROWSER_RUNNER);

  it("the driver itself is committed", () => {
    expect(existsSync(resolve(process.cwd(), BROWSER_RUNNER))).toBe(true);
    expect(driver.length).toBeGreaterThan(4000);
  });

  it("a browser automation dependency is DECLARED", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.devDependencies?.playwright, "playwright must be a declared devDependency").toMatch(
      /^\^?\d+\./,
    );
  });

  it("it is reachable as package scripts, build and run", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["studio:stale-asset-harness"]).toContain("build-versions.mjs");
    expect(pkg.scripts["studio:stale-asset-harness"]).toContain("run-browser-scenarios.mjs");
    expect(pkg.scripts["studio:stale-asset-harness:run"]).toBe(`node ${BROWSER_RUNNER}`);
  });

  it("a MISSING BROWSER DRIVER is a failure, never a skip", () => {
    expect(driver).toContain("playwright is not installed");
    expect(driver).toContain("This is a FAILURE, not a skip");
    expect(driver).toContain("could not launch ${engine}");
    expect(driver).toContain("A missing browser driver is a FAILURE, never a skip");
  });

  it("a MISSING BUILD is a failure, never a skip", () => {
    expect(driver).toContain("A missing build artifact is a FAILURE, never a skip");
  });

  it("a scenario that collected ZERO assertions is a failure", () => {
    expect(driver).toContain(
      "the scenario collected ZERO assertions — that is a failure, not a pass",
    );
  });

  it("no engine running at all is a failure", () => {
    expect(driver).toContain("no engine ran — that is a failure, not a pass");
  });

  it("it exits non-zero on any failed scenario", () => {
    expect(driver).toContain("scenario(s) failed");
    expect(driver).toContain("process.exitCode = 1");
  });

  it("it covers Chromium AND WebKit by default", () => {
    expect(driver).toContain('FOREVER_HARNESS_ENGINES ?? "chromium,webkit"');
  });

  it("it reports passed/failed/skipped/not-run separately, and skipped is always zero", () => {
    expect(driver).toContain("skipped: 0");
    expect(driver).toContain("notRun: isBootstrapFailure ? result.total : 0");
    expect(driver).toContain("0 skipped, 0 not run");
  });

  // -------------------------------------------------------------------------
  // RR2-P2-2 — the proof cannot pass on a page that never loaded
  // -------------------------------------------------------------------------

  it("REQUIRES a healthy application document before any scenario runs", () => {
    expect(driver).toContain("THE GLOBAL PRECONDITION");
    expect(driver).toContain("requireHealthyApplication");
    expect(driver).toContain("the application document returned HTTP ${probe.status}, not 200");
    expect(driver).toContain("not text/html");
    expect(driver).toContain("the real application bootstrap marker never appeared");
    expect(driver).toContain("the router did not report a ready route within");
    expect(driver).toContain("required entry asset(s) did not resolve");
  });

  it("classifies a failed precondition as INFRASTRUCTURE, with zero scenarios passed", () => {
    expect(driver).toContain("infrastructure_bootstrap_failure");
    expect(driver).toContain("passed: isBootstrapFailure ? 0 : result.total - result.failed");
    expect(driver).toContain("INFRASTRUCTURE/BOOTSTRAP FAILURE");
    expect(driver).toContain("process.exitCode = 1");
  });

  it("makes EVERY scenario declare the document status it requires", () => {
    // Every scenario object carries a `document: { status: ... }`, and the
    // opener refuses anything else. A scenario cannot silently inherit a 500.
    const declared = driver.match(/document: \{ status: \d+/g) ?? [];
    const scenarios = driver.match(/^ {4}id: \d+,$/gm) ?? [];
    expect(scenarios.length).toBeGreaterThanOrEqual(20);
    expect(declared).toHaveLength(scenarios.length);
    expect(driver).toContain("returned HTTP ${status}, expected ${expected.status}");
  });

  it("distinguishes document, bootstrap, stale-chunk, recovery-screen and generic outcomes", () => {
    for (const kind of [
      "document_or_server_failure",
      "application_bootstrap_failure",
      "stale_content_hashed_chunk_failure",
      "expected_recovery_screen",
      "generic_application_error",
    ]) {
      expect(driver, kind).toContain(kind);
    }
  });

  it("contains NO vacuous assertion that passes because nothing happened", () => {
    // The exact shape RR2-P2-2 found: `assert(true, "no recovery screen was
    // required")` and its siblings. A scenario about a screen must require the
    // screen. Comments are stripped first, so the module may still DESCRIBE the
    // defect it removed.
    const code = driver
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/assert\(\s*true\b/);
    expect(code).not.toContain("no recovery screen was required");
    expect(code).not.toContain("no automatic recovery was needed");
    expect(code).not.toContain("there is nothing for a duplicate to inherit");
  });

  it("reproduces the failure through a REAL client-side route transition", () => {
    // A full document navigation fetches the ACTIVE version's own document and
    // its own chunks, so nothing is ever stale. The incident is a running page
    // asking for a lazy chunk only its own version had.
    expect(driver).toContain("A REAL CLIENT-SIDE ROUTE TRANSITION");
    expect(driver).toContain("clientNavigate");
    expect(driver).toContain("new PopStateEvent");
  });

  it("uses a local data plane rather than a non-resolving placeholder host", () => {
    const build = read(HARNESS_BUILD);
    expect(build).toContain("VITE_SUPABASE_URL: SUPABASE_STUB_ORIGIN");
    expect(build).toContain("SUPABASE_URL: SUPABASE_STUB_ORIGIN");
    // No remote host may be configured as a VALUE any more; the header may
    // still name the one that was removed and say why.
    expect(build).not.toMatch(/SUPABASE_URL: "https?:/);
    expect(build).toContain("MEASURED WRONG");
    const stub = read("scripts/studio/stale-asset-harness/supabase-stub.mjs");
    expect(stub).toContain("127.0.0.1");
    expect(stub).toContain("holds NO data, issues NO token");
  });

  it("it deterministically cleans up the origin and every context", () => {
    expect(driver).toContain("origin.kill()");
    expect(driver).toContain("await context.close()");
    expect(driver).toContain("await browser.close()");
  });

  it("it drives TWO REAL production builds through a switchable single-active origin", () => {
    const build = read(HARNESS_BUILD);
    const server = read(HARNESS_SERVER);
    expect(build).toContain("vite/bin/vite.js");
    expect(build).toContain("version-a");
    expect(build).toContain("version-b");
    // A comment is not enough: the marked source must change the emitted chunk.
    expect(build).toContain("A COMMENT IS NOT ENOUGH");
    expect(server).toContain("documentRequests");
    expect(server).toContain("__harness/activate");
  });

  it("the origin can model a stale, timing-out and failing client-assets endpoint", () => {
    const server = read(HARNESS_SERVER);
    expect(server).toContain("clientAssetsEndpointMode");
    for (const mode of ["normal", "stale", "timeout", "error"]) {
      expect(server, mode).toContain(mode);
    }
    expect(server).toContain("assetMode");
    expect(server).toContain("html200");
  });

  it("every required scenario is present, by number", () => {
    for (let id = 1; id <= 20; id += 1) {
      expect(driver, `scenario ${id}`).toContain(`id: ${id},`);
    }
  });

  it("the harness seam it depends on is never shipped to production", () => {
    // Asserted for real against the production bundle in
    // `worker-config-contract.test.ts`; asserted structurally here.
    const capture = read("src/lib/stale-asset/global-capture.ts");
    expect(capture).toContain('import.meta.env?.VITE_FOREVER_STALE_ASSET_HARNESS !== "1"');
    expect(read(HARNESS_BUILD)).toContain('VITE_FOREVER_STALE_ASSET_HARNESS: "1"');
    const orchestrator = read("scripts/build/build-forever.mjs");
    expect(orchestrator).not.toContain("VITE_FOREVER_STALE_ASSET_HARNESS");
  });
});
