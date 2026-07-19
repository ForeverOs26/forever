/**
 * Fast Intake v1 — deterministic, atomic, credential-free filesystem helpers.
 *
 * Every canonical JSON artifact is written UTF-8 without a BOM, pretty-printed
 * with two-space indentation and a trailing newline, preserving the property
 * order in which the object was constructed. Nothing here reads secrets,
 * touches the network, or creates a database client.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Serialize a value to the canonical Fast Intake JSON form: two-space indent,
 * trailing newline, no BOM. Property order follows construction order, which
 * every producer in this module keeps deterministic.
 */
export function toCanonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Write text atomically: a unique temp file in the same directory is written
 * first, then renamed over the target. A crash never leaves a half-written
 * canonical file — the target is either the old content or the new content.
 */
export function atomicWriteFile(targetPath: string, contents: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.floor(
    Math.random() * 1e9,
  )}`;
  try {
    // UTF-8 without BOM is Node's default for a string payload.
    writeFileSync(tempPath, contents, { encoding: "utf8" });
    renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // The temp file may never have been created; ignore.
    }
    throw error;
  }
}

/** Atomically write a value as canonical JSON. */
export function atomicWriteJson(targetPath: string, value: unknown): void {
  atomicWriteFile(targetPath, toCanonicalJson(value));
}

/** Recursively remove a directory tree, tolerating a missing path. */
export function removeDirSafe(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Join and normalize to forward slashes for a stable logical path. */
export function toLogicalPath(...segments: string[]): string {
  return join(...segments)
    .split("\\")
    .join("/");
}
