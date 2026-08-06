#!/usr/bin/env node
/**
 * Lints only the files this branch changed.
 *
 * Whole-repository `npm run lint` is not clean on `main` — ~1,635
 * `prettier/prettier` errors across ~94 files — so it cannot be a gate, and a
 * strict changed-file gate would fail the first PR that touches any of those
 * files for reasons unrelated to the change. So the rule is: a file that was
 * already unformatted at the merge base is exempt from `prettier/prettier`,
 * and nothing else is exempt from anything. New files are strict. Every other
 * ESLint error fails, in every file.
 *
 * Repository-wide formatting cleanup is a separate authorized task; when it
 * lands, the exemption stops applying to anything and can be deleted.
 *
 * Base ref: $FOREVER_LINT_BASE, else origin/main, else main.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { check, resolveConfig } from "prettier";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const git = (...args) =>
  spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

const mergeBaseWith = (ref) => {
  const result = git("merge-base", ref, "HEAD");
  return result.status === 0 ? result.stdout.trim() : null;
};

// An explicitly requested base that does not resolve is an error, never a
// silent fall-back to a base that would lint nothing.
const requested = process.env.FOREVER_LINT_BASE;
let base = null;
if (requested) {
  const sha = mergeBaseWith(requested);
  if (!sha) {
    console.error(`lint:changed FAILED — FOREVER_LINT_BASE="${requested}" does not resolve here.`);
    process.exit(1);
  }
  base = { ref: requested, sha };
} else {
  for (const candidate of ["origin/main", "main"]) {
    const sha = mergeBaseWith(candidate);
    if (sha) {
      base = { ref: candidate, sha };
      break;
    }
  }
}
if (!base) {
  console.error("lint:changed FAILED — no usable base ref (tried origin/main, main).");
  console.error("  Fetch the base branch first, or set FOREVER_LINT_BASE.");
  process.exit(1);
}

const changed = git("diff", "--name-only", "--diff-filter=ACMR", base.sha);
if (changed.status !== 0) {
  console.error(`lint:changed FAILED — git diff against ${base.sha} failed:\n${changed.stderr}`);
  process.exit(1);
}
// Uncommitted new files are part of what this branch touched; in CI there are none.
const untracked = git("ls-files", "--others", "--exclude-standard");
const untrackedOut = untracked.status === 0 ? (untracked.stdout ?? "") : "";

const files = [...changed.stdout.split("\n"), ...untrackedOut.split("\n")]
  .map((line) => line.trim())
  .filter((line) => line && LINTABLE.test(line))
  .filter((file, index, all) => all.indexOf(file) === index)
  .filter((file) => existsSync(join(ROOT, file)));

const label = `${base.ref} (${base.sha.slice(0, 12)})`;
if (files.length === 0) {
  console.log(`lint:changed PASSED — no lintable files changed against ${label}`);
  process.exit(0);
}
console.log(`lint:changed — ${files.length} file(s) against ${label}`);

/** True when the file existed at the merge base and was already unformatted there. */
const unformattedAtBase = async (file) => {
  const show = git("show", `${base.sha}:${file}`);
  if (show.status !== 0) return false; // new in this branch → strict
  const filepath = join(ROOT, file);
  try {
    const config = (await resolveConfig(filepath)) ?? {};
    return !(await check(show.stdout, { ...config, filepath }));
  } catch {
    return false; // unparseable at the base → strict
  }
};

// The local binary is invoked directly — no shell, identical on every platform.
const eslint = spawnSync(
  process.execPath,
  [
    join(ROOT, "node_modules", "eslint", "bin", "eslint.js"),
    "--no-warn-ignored",
    "-f",
    "json",
    ...files,
  ],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 },
);

if (!eslint.stdout) {
  console.error(`lint:changed FAILED — eslint produced no report:\n${eslint.stderr ?? ""}`);
  process.exit(1);
}

const results = JSON.parse(eslint.stdout);
const blocking = [];
const exempt = [];

for (const result of results) {
  const errors = result.messages.filter((message) => message.severity === 2);
  if (errors.length === 0) continue;
  const file = resolve(result.filePath)
    .slice(ROOT.length + 1)
    .split("\\")
    .join("/");
  const wasDirty =
    errors.some((m) => m.ruleId === "prettier/prettier") && (await unformattedAtBase(file));
  for (const message of errors) {
    const line = `${file}:${message.line}:${message.column}  ${message.ruleId ?? "error"}  ${message.message}`;
    if (wasDirty && message.ruleId === "prettier/prettier") exempt.push(line);
    else blocking.push(line);
  }
}

if (exempt.length > 0) {
  console.log(
    `\nlint:changed — ${exempt.length} pre-existing prettier error(s) exempt: these files were ` +
      `already unformatted at ${label}. Formatting them is a separate authorized task.`,
  );
}

if (blocking.length > 0) {
  console.error(`\nlint:changed FAILED — ${blocking.length} error(s):`);
  blocking.forEach((line) => console.error(`  ${line}`));
  console.error("\nFor formatting errors run `npx prettier --write <file>`.");
  process.exit(1);
}

console.log("lint:changed PASSED");
