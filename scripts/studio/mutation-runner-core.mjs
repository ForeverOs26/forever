/**
 * Shared mutation-harness primitives.
 *
 * WHY THIS EXISTS SEPARATELY
 * --------------------------
 * A mutation runner is only evidence if it is itself trustworthy. Two ways it
 * can lie were found in review:
 *
 *   1. matching source text with a hard-coded newline. A Windows checkout with
 *      `core.autocrlf=true` stores `\r\n`, so a multi-line LF pattern finds
 *      nothing, the runner aborts partway, and the remaining mutations are
 *      never attempted -- while the summary still reads like coverage;
 *   2. counting a spawn failure as a detection. If the test binary cannot be
 *      launched at all, the child exits nonzero, and a runner that only checks
 *      "nonzero means detected" reports a mutation as caught by tests that
 *      never ran.
 *
 * Both are fixed here, once, and the self-test exercises THESE functions rather
 * than a copy of them.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** A defect in the harness itself — never a mutation detection. */
export class MutationRunnerError extends Error {
  constructor(message) {
    super(message);
    this.name = "MutationRunnerError";
  }
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * A literal source snippet as a pattern that matches under any line ending.
 *
 * Every metacharacter is escaped, and every line break in the literal becomes
 * `\r?\n`, so one pattern matches an LF checkout, a CRLF checkout, and a file
 * that mixes both.
 */
export function eolAgnosticPattern(literal) {
  const source = literal
    .split(/\r?\n/)
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\r?\\n");
  return new RegExp(source, "g");
}

/**
 * Apply one mutation, changing ONLY the matched span.
 *
 * The replacement adopts the line ending observed at the match site, and every
 * byte outside the match is left exactly as it was — so a mutated file never
 * acquires a second newline convention, and restoration has nothing to undo but
 * the mutation itself.
 */
export function replaceExactlyOnce(file, from, to) {
  const source = readFileSync(file, "utf8");
  const matches = [...source.matchAll(eolAgnosticPattern(from))];
  if (matches.length !== 1) {
    throw new MutationRunnerError(
      `mutation source mismatch in ${file}: expected 1 occurrence, found ${matches.length}`,
    );
  }
  const [match] = matches;
  // A single-line match carries no line-ending evidence of its own, so fall
  // back to the convention the file as a whole already uses.
  const spansLines = /\r?\n/.test(match[0]);
  const usesCrlf = spansLines ? match[0].includes("\r\n") : source.includes("\r\n");
  const replacement = usesCrlf ? to.replace(/\r?\n/g, "\r\n") : to.replace(/\r\n/g, "\n");
  writeFileSync(
    file,
    source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length),
    "utf8",
  );
  return { index: match.index, length: match[0].length, usesCrlf, spansLines };
}

/**
 * Decide what a finished child process actually proves.
 *
 * `detected` requires three independent things: the process ran, real tests
 * ran and reported failures, and the named assertion appears in the output. A
 * missing binary, a killing signal, or a collection error that ran no test at
 * all is `runner_failure`, never evidence.
 */
export function classifyRun(result, namedReason) {
  if (result.error) {
    return {
      verdict: "runner_failure",
      detail: `process could not be started: ${result.error.message}`,
    };
  }
  if (result.signal) {
    return { verdict: "runner_failure", detail: `process was killed by signal ${result.signal}` };
  }
  if (typeof result.status !== "number") {
    return { verdict: "runner_failure", detail: "process produced no exit status" };
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0) return { verdict: "survived", detail: "the mutation passed its tests" };
  if (!/Tests\s+\d+\s+failed/.test(output)) {
    return {
      verdict: "runner_failure",
      detail: `nonzero exit without a reported test failure:\n${output.slice(-4000)}`,
    };
  }
  if (!namedReason.test(output)) {
    return {
      verdict: "runner_failure",
      detail: `tests failed, but not for the named reason ${namedReason}:\n${output.slice(-4000)}`,
    };
  }
  return { verdict: "detected", detail: "" };
}

/** Restore every captured file from its ORIGINAL bytes and prove it. */
export function restoreAll(originals) {
  const mismatched = [];
  for (const [file, original] of originals) {
    writeFileSync(file, original);
    if (!readFileSync(file).equals(original)) mismatched.push(file);
  }
  return mismatched;
}
