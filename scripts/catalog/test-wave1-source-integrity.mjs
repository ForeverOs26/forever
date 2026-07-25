/**
 * FOREVER-CATALOG-10-003 — source-integrity negative tests for the Wave 1 builder.
 *
 * The builder's promise is that every source whose digest it reports is resolved
 * and verified on every run. These tests prove that promise by breaking it four
 * ways and requiring the build to fail closed each time:
 *
 *   1. control            — an intact mirror builds cleanly
 *   2. missing source     — a pinned document is removed
 *   3. changed digest     — a pinned document's bytes change
 *   4. substituted source — a different document takes a pinned filename
 *   5. cited file returns — the absent cited document reappears
 *
 * The tests run the real builder in `--check` mode against a disposable mirror
 * of the Owner sources, so they never write a payload and never touch a
 * database. No source document is copied into the repository.
 *
 * Usage:
 *   set FOREVER_WAVE1_SOURCE_ROOTS=<root1>;<root2>
 *   node scripts/catalog/test-wave1-source-integrity.mjs
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILDER = join(REPO_ROOT, "scripts", "catalog", "build-wave1-payloads.mjs");

/** Filenames the builder pins. Kept in sync with SOURCES + the absent citations. */
const PINNED = [
  "SIB - Price List V.1. - Updated 15.05.2026.pdf",
  "SIB - Master Plan Price list V.1 - updated 15.05.26.pdf",
  "GARDEN OF EDEN - eng.pdf",
  "GARDEN OF EDEN.pdf",
  "project-facts.json",
  "price-list.json",
  "For PDF Presentation.pdf",
  "Rainpalm - Price List（for In house).pdf",
  "Rainpalm - Price List（for In house) update 04.2025.pdf",
  "Rainpalm - Price List（for In house) update 4_12_2025.pdf",
  "Rainpalm - Price List new.pdf",
];

const CITED_BUT_ABSENT = "Копия Rainpalm - Price List（for In house)-1.pdf";

const MAX_DEPTH = 4;

function walk(root, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, depth + 1));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function realRoots() {
  const raw = process.env.FOREVER_WAVE1_SOURCE_ROOTS ?? "";
  const roots = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!roots.length) {
    throw new Error("FOREVER_WAVE1_SOURCE_ROOTS is not set; cannot mirror the Owner sources.");
  }
  return roots;
}

/** Flat disposable mirror of the pinned sources. Never inside the repository. */
function buildMirror() {
  const mirror = mkdtempSync(join(tmpdir(), "wave1-source-integrity-"));
  const files = realRoots().flatMap((root) => walk(root));
  const placed = new Map();
  for (const name of PINNED) {
    const match = files.find((path) => basename(path) === name);
    if (!match) {
      rmSync(mirror, { recursive: true, force: true });
      throw new Error(`Cannot mirror: pinned source "${name}" was not found in the real roots.`);
    }
    const target = join(mirror, name);
    copyFileSync(match, target);
    placed.set(name, target);
  }
  return { mirror, placed };
}

function runBuilder(root) {
  const result = spawnSync(process.execPath, [BUILDER, "--check"], {
    encoding: "utf8",
    env: { ...process.env, FOREVER_WAVE1_SOURCE_ROOTS: root },
  });
  return {
    code: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

let failures = 0;

function expectFailure(label, expectedCode, mutate, restore) {
  mutate();
  try {
    const { code, output } = runBuilder(MIRROR);
    const failedClosed = code !== 0 && output.includes(expectedCode);
    if (failedClosed) {
      console.log(`PASS  ${label} -> ${expectedCode}`);
    } else {
      failures += 1;
      console.log(
        `FAIL  ${label}: expected a non-zero exit mentioning "${expectedCode}", got exit ${code}.`,
      );
      console.log(`      ${output.split("\n").slice(0, 4).join("\n      ")}`);
    }
  } finally {
    restore();
  }
}

const { mirror: MIRROR, placed } = buildMirror();

try {
  // 1. Control — the intact mirror must build cleanly. This proves the later
  //    failures come from the mutation and not from the mirror itself.
  {
    const { code, output } = runBuilder(MIRROR);
    if (code === 0 && output.includes("UNCHANGED")) {
      console.log("PASS  control: intact mirror rebuilds byte-identically");
    } else {
      failures += 1;
      console.log(`FAIL  control: expected clean rebuild, got exit ${code}.`);
      console.log(`      ${output.split("\n").slice(0, 6).join("\n      ")}`);
    }
  }

  // 2. Missing source.
  {
    const victim = placed.get("Rainpalm - Price List（for In house) update 04.2025.pdf");
    const backup = `${victim}.backup`;
    expectFailure(
      "missing source (a pinned price document is removed)",
      "source_missing",
      () => {
        copyFileSync(victim, backup);
        rmSync(victim);
      },
      () => {
        copyFileSync(backup, victim);
        rmSync(backup, { force: true });
      },
    );
  }

  // 3. Changed digest — same file, one byte appended.
  {
    const victim = placed.get("project-facts.json");
    const backup = `${victim}.backup`;
    expectFailure(
      "changed digest (a pinned intake artifact is edited)",
      "source_digest_mismatch",
      () => {
        copyFileSync(victim, backup);
        writeFileSync(victim, `${readFileSync(victim, "utf8")}\n`, "utf8");
      },
      () => {
        copyFileSync(backup, victim);
        rmSync(backup, { force: true });
      },
    );
  }

  // 4. Substituted source — a genuinely different document under a pinned name.
  {
    const victim = placed.get("For PDF Presentation.pdf");
    const impostor = placed.get("GARDEN OF EDEN - eng.pdf");
    const backup = `${victim}.backup`;
    expectFailure(
      "substituted source (a different document takes a pinned filename)",
      "source_digest_mismatch",
      () => {
        copyFileSync(victim, backup);
        copyFileSync(impostor, victim);
      },
      () => {
        copyFileSync(backup, victim);
        rmSync(backup, { force: true });
      },
    );
  }

  // 5. The absent cited document reappears. A stale "this file does not exist"
  //    warning is worse than a hard stop, so the build must refuse.
  {
    const intruder = join(MIRROR, CITED_BUT_ABSENT);
    expectFailure(
      "cited file reappears (the absent price document turns up)",
      "cited_source_reappeared",
      () => writeFileSync(intruder, "not the real document", "utf8"),
      () => rmSync(intruder, { force: true }),
    );
  }

  // 6. Final control — the mirror is intact again and still builds cleanly,
  //    proving every restore worked and no test leaked state into the next.
  {
    const { code, output } = runBuilder(MIRROR);
    if (code === 0 && output.includes("UNCHANGED")) {
      console.log("PASS  final control: mirror restored, rebuild still byte-identical");
    } else {
      failures += 1;
      console.log(`FAIL  final control: expected clean rebuild, got exit ${code}.`);
      console.log(`      ${output.split("\n").slice(0, 6).join("\n      ")}`);
    }
  }
} finally {
  rmSync(MIRROR, { recursive: true, force: true });
}

console.log(
  failures ? `\n${failures} negative test(s) FAILED` : "\nAll source-integrity tests passed",
);
process.exit(failures ? 1 : 0);
