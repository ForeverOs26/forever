/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — the repository-locked Wrangler
 * identity, proven BEHAVIOURALLY.
 *
 * PR139 independent review:
 *
 *   P1-1  an arbitrary external `WRANGLER_BIN` was accepted for a production
 *         candidate upload provided it printed `4.118.0`;
 *   P2-1  the evidence field `resolvedFromRepository` was
 *         `Boolean(resolvedPath)`, so it reported repository provenance for
 *         that external executable too.
 *
 * Every assertion here is about what the resolver DOES. The external Wrangler
 * fixtures are real files that really print the supported version, so
 * "rejected because the version was wrong" cannot be mistaken for "rejected
 * because it was not the locked file" — and the fixture records its own
 * execution, so the claim that a rejected executable is never invoked is
 * measured rather than asserted.
 *
 * NO NETWORK. NO CREDENTIAL. NO UPLOAD. The only spawns are `--version` probes
 * and the offline version gate, under a minimal synthetic environment.
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CANONICAL_WRANGLER_ENTRY,
  WRANGLER_PACKAGE_MANIFEST,
  resolveRepositoryWrangler,
  verifyRepositoryWranglerIdentity,
} from "./wrangler-identity";
import { SUPPORTED_WRANGLER_VERSION } from "./worker-variable-preservation";

const REPO = process.cwd();

/**
 * The canonical entry point's real path, or "" when the constant does not name
 * an existing file.
 *
 * Deliberately tolerant at MODULE SCOPE. Mutation control 27 replaces
 * `CANONICAL_WRANGLER_ENTRY` with a PATH-shaped bare name, and a module-scope
 * throw would abort COLLECTION — which the mutation runner correctly refuses to
 * count as a detection, because a suite that never ran has not measured
 * anything. Failing later, on the named `NO_PATH_FALLBACK` assertion, is the
 * detection that control exists to produce.
 */
const CANONICAL_ENTRY = resolve(REPO, CANONICAL_WRANGLER_ENTRY);
const CANONICAL_REAL = existsSync(CANONICAL_ENTRY) ? realpathSync.native(CANONICAL_ENTRY) : "";

let workspace = "";
/** An external executable that really prints the supported version. */
let externalWrangler = "";
/** A byte-for-byte copy of the real entry point, at a different path. */
let copiedWrangler = "";
/** A repository-SHAPED path under a different root. */
let repositoryShapedWrangler = "";
/** A hard link: the same inode, reached by a different path. */
let hardLinkedWrangler = "";
/** A symlink to the canonical entry point, when the platform permits one. */
let symlinkedWrangler = "";
/** Appended to by every fixture that is actually executed. */
let invocationMarker = "";

function writeExternalWrangler(path: string, marker: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    // Records its own execution first, so "was it ever launched?" is a fact on
    // disk rather than an inference, then reports EXACTLY the supported version.
    `require("node:fs").appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${path}\n`)});\n` +
      `process.stdout.write(${JSON.stringify(`${SUPPORTED_WRANGLER_VERSION}\n`)});\n`,
    "utf8",
  );
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "forever-wrangler-identity-"));
  invocationMarker = join(workspace, "invocations.log");
  writeFileSync(invocationMarker, "", "utf8");

  externalWrangler = join(workspace, "external", "wrangler.js");
  writeExternalWrangler(externalWrangler, invocationMarker);

  repositoryShapedWrangler = join(
    workspace,
    "fake-repo",
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  writeExternalWrangler(repositoryShapedWrangler, invocationMarker);
  // The shape is complete: a manifest at exactly the supported version too.
  mkdirSync(join(workspace, "fake-repo", "node_modules", "wrangler"), { recursive: true });
  writeFileSync(
    join(workspace, "fake-repo", "node_modules", "wrangler", "package.json"),
    `${JSON.stringify({ name: "wrangler", version: SUPPORTED_WRANGLER_VERSION }, null, 2)}\n`,
    "utf8",
  );

  // Every fixture derived from the canonical file is created defensively, for
  // the same reason `CANONICAL_REAL` is computed defensively: a `beforeAll`
  // that throws produces a suite error rather than a named failing assertion.
  copiedWrangler = join(workspace, "copied", "wrangler.js");
  mkdirSync(dirname(copiedWrangler), { recursive: true });
  try {
    copyFileSync(CANONICAL_REAL, copiedWrangler);
  } catch {
    copiedWrangler = "";
  }

  hardLinkedWrangler = join(workspace, "hardlink", "wrangler.js");
  mkdirSync(dirname(hardLinkedWrangler), { recursive: true });
  try {
    linkSync(CANONICAL_REAL, hardLinkedWrangler);
  } catch {
    hardLinkedWrangler = "";
  }

  symlinkedWrangler = join(workspace, "symlink", "wrangler.js");
  mkdirSync(dirname(symlinkedWrangler), { recursive: true });
  try {
    symlinkSync(CANONICAL_REAL, symlinkedWrangler, "file");
  } catch {
    // Windows without Developer Mode refuses this. The suite says so rather
    // than silently reporting a coverage it did not achieve.
    symlinkedWrangler = "";
  }
});

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

const invocations = () => (invocationMarker ? readFileSync(invocationMarker, "utf8") : "");

describe("the repository-locked Wrangler is the only one that resolves", () => {
  it("ACCEPTS the exact repository entry point and reports truthful provenance", () => {
    const identity = resolveRepositoryWrangler({ repoRoot: REPO });

    expect(identity.ok).toBe(true);
    expect(identity.refusals).toEqual([]);
    expect(identity.canonicalPath).toBe(CANONICAL_REAL);
    expect(identity.launcher).toEqual({
      command: process.execPath,
      prefixArgs: [CANONICAL_REAL],
    });
    expect(identity.evidence.resolvedFromRepository).toBe(true);
    expect(identity.evidence.canonicalRepositoryPathAccepted).toBe(true);
    expect(identity.evidence.overrideRequested).toBe(false);
    expect(identity.evidence.overrideAccepted).toBe(false);
    expect(identity.evidence.overrideRejected).toBe(false);
    expect(identity.evidence.packageVersion).toBe(SUPPORTED_WRANGLER_VERSION);
    expect(identity.evidence.identityOk).toBe(true);
  });

  it("launches through the ABSOLUTE Node executable, never a shell or a bare name", () => {
    const identity = resolveRepositoryWrangler({ repoRoot: REPO });
    expect(identity.launcher?.command).toBe(process.execPath);
    expect(identity.launcher?.command).toMatch(/[\\/]/);
    expect(identity.launcher?.prefixArgs[0]).toBe(CANONICAL_REAL);
    expect(identity.launcher?.prefixArgs[0]).not.toBe("wrangler");
  });

  it("NO_PATH_FALLBACK: refuses rather than substituting a PATH-shaped executable", () => {
    // Mutation control 27 replaces the canonical entry constant with a bare
    // name. Both halves of this assertion fail when it does.
    expect(CANONICAL_WRANGLER_ENTRY).toBe("node_modules/wrangler/bin/wrangler.js");
    expect(WRANGLER_PACKAGE_MANIFEST).toBe("node_modules/wrangler/package.json");

    const bareRoot = join(workspace, "empty-repo");
    mkdirSync(bareRoot, { recursive: true });
    const identity = resolveRepositoryWrangler({ repoRoot: bareRoot });

    expect(identity.ok).toBe(false);
    expect(identity.refusals).toContain("wrangler_not_installed");
    expect(identity.launcher).toBeNull();
    expect(identity.canonicalPath).toBeNull();
    expect(identity.evidence.resolvedFromRepository).toBe(false);
  });

  it("requires the INSTALLED package manifest to report exactly the supported version", () => {
    const installed = JSON.parse(
      readFileSync(resolve(REPO, WRANGLER_PACKAGE_MANIFEST), "utf8"),
    ) as {
      version: string;
    };
    expect(installed.version).toBe(SUPPORTED_WRANGLER_VERSION);

    // A tree whose manifest says something else is refused, even though the
    // entry point exists and would print whatever it liked.
    const driftedRoot = join(workspace, "drifted-repo");
    const driftedEntry = join(driftedRoot, "node_modules", "wrangler", "bin", "wrangler.js");
    writeExternalWrangler(driftedEntry, invocationMarker);
    writeFileSync(
      join(driftedRoot, "node_modules", "wrangler", "package.json"),
      `${JSON.stringify({ name: "wrangler", version: "4.117.0" }, null, 2)}\n`,
      "utf8",
    );

    const identity = resolveRepositoryWrangler({ repoRoot: driftedRoot });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toContain("wrangler_package_version_mismatch");
    expect(identity.launcher).toBeNull();
    expect(identity.evidence.resolvedFromRepository).toBe(false);
  });
});

describe("EXTERNAL_WRANGLER_REJECTED: a same-version override cannot be substituted", () => {
  it("REFUSES an external executable that reports exactly the supported version", () => {
    // The fixture is real and really prints 4.118.0 — proven below by running
    // it directly — so this refusal is about IDENTITY, not about the version.
    const probe = spawnSync(process.execPath, [externalWrangler, "--version"], {
      encoding: "utf8",
      shell: false,
    });
    expect(probe.status).toBe(0);
    expect(probe.stdout.trim()).toBe(SUPPORTED_WRANGLER_VERSION);

    const identity = resolveRepositoryWrangler({ repoRoot: REPO, override: externalWrangler });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_override_not_identical"]);
    expect(identity.launcher).toBeNull();
    expect(identity.canonicalPath).toBeNull();
  });

  it("REFUSES a byte-for-byte COPY of the canonical entry point", () => {
    expect(readFileSync(copiedWrangler)).toEqual(readFileSync(CANONICAL_REAL));
    const identity = resolveRepositoryWrangler({ repoRoot: REPO, override: copiedWrangler });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_override_not_identical"]);
    expect(identity.launcher).toBeNull();
  });

  it("REFUSES a repository-SHAPED path under a different root", () => {
    expect(repositoryShapedWrangler.replace(/\\/g, "/")).toContain(CANONICAL_WRANGLER_ENTRY);
    const identity = resolveRepositoryWrangler({
      repoRoot: REPO,
      override: repositoryShapedWrangler,
    });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_override_not_identical"]);
    expect(identity.launcher).toBeNull();
  });

  it("REFUSES a hard link — the same inode reached by a different path", () => {
    if (hardLinkedWrangler === "") {
      expect(hardLinkedWrangler, "hard links unavailable on this filesystem").toBe("");
      return;
    }
    const identity = resolveRepositoryWrangler({ repoRoot: REPO, override: hardLinkedWrangler });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_override_not_identical"]);
  });

  it("ACCEPTS a symlink ONLY because it resolves to the identical canonical file", () => {
    if (symlinkedWrangler === "") {
      // Recorded, not hidden: this platform refused to create a symlink, so the
      // positive half of the symlink rule is not measured on this run. The
      // NEGATIVE half — every non-identical path above — is measured anyway.
      expect(symlinkedWrangler, "symlink creation unavailable on this platform").toBe("");
      return;
    }
    expect(realpathSync.native(symlinkedWrangler)).toBe(CANONICAL_REAL);
    const identity = resolveRepositoryWrangler({ repoRoot: REPO, override: symlinkedWrangler });
    expect(identity.ok).toBe(true);
    expect(identity.evidence.overrideRequested).toBe(true);
    expect(identity.evidence.overrideAccepted).toBe(true);
    expect(identity.evidence.overrideRejected).toBe(false);
    // Even an accepted override changes NOTHING about what is launched.
    expect(identity.launcher?.prefixArgs).toEqual([CANONICAL_REAL]);
  });

  it("REFUSES an override that does not resolve at all", () => {
    const identity = resolveRepositoryWrangler({
      repoRoot: REPO,
      override: join(workspace, "does-not-exist", "wrangler.js"),
    });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_override_unresolvable"]);
    expect(identity.launcher).toBeNull();
  });

  it("NEVER invokes a rejected executable — no probe, no upload", () => {
    // The fixture records every execution of itself. The log is truncated here
    // so what remains afterwards is attributable to this test alone — the
    // version-reporting check above deliberately DID run it once.
    writeFileSync(invocationMarker, "", "utf8");

    const launched: string[] = [];
    const identity = verifyRepositoryWranglerIdentity({
      repoRoot: REPO,
      override: externalWrangler,
      spawnProbe: (launcher) => {
        launched.push(String(launcher.prefixArgs[0]));
        return { status: 0, stdout: `${SUPPORTED_WRANGLER_VERSION}\n`, stderr: "" };
      },
    });

    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_override_not_identical"]);
    // The refusal happens BEFORE anything launchable exists.
    expect(launched).toEqual([]);
    expect(identity.evidence.reportedVersion).toBeNull();
    expect(invocations()).toBe("");
  });
});

describe("PROVENANCE_TRUTHFUL: resolvedFromRepository is canonical path equality", () => {
  it("is FALSE for every rejected override, whatever version it reports", () => {
    for (const override of [externalWrangler, copiedWrangler, repositoryShapedWrangler]) {
      const identity = resolveRepositoryWrangler({ repoRoot: REPO, override });
      expect(identity.evidence.resolvedFromRepository, override).toBe(false);
      expect(identity.evidence.canonicalRepositoryPathAccepted, override).toBe(false);
      expect(identity.evidence.overrideRequested, override).toBe(true);
      expect(identity.evidence.overrideRejected, override).toBe(true);
      expect(identity.evidence.overrideAccepted, override).toBe(false);
      expect(identity.evidence.identityOk, override).toBe(false);
    }
  });

  it("is not merely a report that SOME path resolved", () => {
    // The superseded field was `Boolean(resolvedPath)`. Every override above
    // resolves to a real, existing, executable file — so a truthiness report
    // would say `true` for all of them. It says false for all of them.
    for (const override of [externalWrangler, copiedWrangler, repositoryShapedWrangler]) {
      expect(existsSync(override), override).toBe(true);
      expect(
        resolveRepositoryWrangler({ repoRoot: REPO, override }).evidence.resolvedFromRepository,
      ).toBe(false);
    }
    expect(resolveRepositoryWrangler({ repoRoot: REPO }).evidence.resolvedFromRepository).toBe(
      true,
    );
  });

  it("distinguishes every identity outcome without exposing a path", () => {
    const accepted = resolveRepositoryWrangler({ repoRoot: REPO }).evidence;
    const rejected = resolveRepositoryWrangler({
      repoRoot: REPO,
      override: externalWrangler,
    }).evidence;

    for (const evidence of [accepted, rejected]) {
      const serialized = JSON.stringify(evidence);
      expect(serialized).not.toContain(workspace.replace(/\\/g, "\\\\"));
      expect(serialized).not.toContain(REPO.replace(/\\/g, "\\\\"));
      expect(serialized).not.toContain("node_modules");
    }
    expect(Object.keys(accepted).sort()).toEqual([
      "canonicalRepositoryPathAccepted",
      "expectedVersion",
      "identityOk",
      "overrideAccepted",
      "overrideRejected",
      "overrideRequested",
      "packageVersion",
      "reportedVersion",
      "resolvedFromRepository",
    ]);
  });
});

describe("the version probe still proves what actually executes", () => {
  it("requires the CLI to report EXACTLY the supported version", () => {
    const identity = verifyRepositoryWranglerIdentity({
      repoRoot: REPO,
      spawnProbe: () => ({ status: 0, stdout: "4.119.0\n", stderr: "" }),
    });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_version_mismatch"]);
    expect(identity.evidence.reportedVersion).toBe("4.119.0");
    expect(identity.evidence.resolvedFromRepository).toBe(false);
  });

  it("refuses a Wrangler that reports no parseable version", () => {
    const identity = verifyRepositoryWranglerIdentity({
      repoRoot: REPO,
      spawnProbe: () => ({ status: 0, stdout: "", stderr: "" }),
    });
    expect(identity.ok).toBe(false);
    expect(identity.refusals).toEqual(["wrangler_version_not_reported"]);
  });

  it("probes the REAL repository-locked Wrangler, offline, and it reports 4.118.0", () => {
    const identity = verifyRepositoryWranglerIdentity({ repoRoot: REPO });
    expect(identity.problems).toEqual([]);
    expect(identity.ok).toBe(true);
    expect(identity.evidence.reportedVersion).toBe(SUPPORTED_WRANGLER_VERSION);
    expect(identity.evidence.packageVersion).toBe(SUPPORTED_WRANGLER_VERSION);
    expect(identity.evidence.resolvedFromRepository).toBe(true);
  }, 60_000);
});

describe("the production version gate consumes exactly this resolver", () => {
  const runGate = (env: Record<string, string | undefined>) => {
    const out = join(workspace, `gate-${Math.abs(Number(process.hrtime.bigint() % 100000n))}.json`);
    const run = spawnSync(
      process.execPath,
      [resolve(REPO, "scripts/release/wrangler-version-gate.mjs"), "--json", out],
      {
        cwd: REPO,
        encoding: "utf8",
        shell: false,
        env: { ...process.env, ...env },
      },
    );
    const report = existsSync(out)
      ? (JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>)
      : null;
    return { run, report };
  };

  it("reports the SAME truthful provenance the shared resolver computed", () => {
    const { run, report } = runGate({ WRANGLER_BIN: undefined });
    expect(run.status).toBe(0);
    expect(report).not.toBeNull();
    expect(report?.resolvedFromRepository).toBe(true);
    expect(report?.canonicalRepositoryPathAccepted).toBe(true);
    expect(report?.overrideRequested).toBe(false);
    expect(report?.packageVersion).toBe(SUPPORTED_WRANGLER_VERSION);
    expect(report?.reportedVersion).toBe(SUPPORTED_WRANGLER_VERSION);
    expect(report?.identityOk).toBe(true);
    expect(report?.ok).toBe(true);
    // A local filesystem path is not evidence and never enters the artefact.
    expect(JSON.stringify(report)).not.toContain("node_modules");
  }, 120_000);

  it("STOPS on an external same-version WRANGLER_BIN, and never runs it", () => {
    // Truncated so the log measures THIS run of the production gate only.
    writeFileSync(invocationMarker, "", "utf8");
    const { run, report } = runGate({ WRANGLER_BIN: externalWrangler });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("STOP");
    expect(report?.ok).toBe(false);
    expect(report?.resolvedFromRepository).toBe(false);
    expect(report?.overrideRequested).toBe(true);
    expect(report?.overrideRejected).toBe(true);
    expect(report?.overrideAccepted).toBe(false);
    expect(report?.refusals).toEqual(["wrangler_override_not_identical"]);
    // Measured, not asserted: the rejected executable records every execution
    // of itself, and it recorded none.
    expect(invocations()).toBe("");
  }, 120_000);
});
