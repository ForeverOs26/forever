/**
 * Package Factory — the Source Resolver.
 *
 * Enumerates every supplied official source through its own adapter, then does
 * the work that is identical for all of them:
 *
 *   - SHA-256 every artifact and collapse byte-identical duplicates, recording
 *     the first occurrence as the canonical one. A byte-identical repost is
 *     therefore never a new source version and can never become a second price
 *     row or a second media object;
 *   - keep the publication date (when the source distributed it) separate from
 *     the effective date (what the document itself states);
 *   - preserve the source kind and authority for precedence;
 *   - keep private locators out of everything that is projected publicly.
 *
 * An adapter that fails contributes an exception; the remaining adapters still
 * produce a package. That is what makes "Telegram absent", "Drive absent" and
 * "only a local folder" ordinary rather than degraded.
 */

import { createHash } from "node:crypto";

import type { SourceSet } from "./source-set";
import type { AdapterContext } from "./adapters";
import { runAdapter } from "./adapters";
import type { ResolvedArtifact, ResolvedSources } from "./types";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Deterministic ordering so two runs over the same inputs resolve identically
 * regardless of adapter timing: by source-set position, then logical path.
 */
function compareArtifacts(
  left: { order: number; logicalPath: string },
  right: { order: number; logicalPath: string },
): number {
  if (left.order !== right.order) return left.order - right.order;
  return left.logicalPath < right.logicalPath ? -1 : left.logicalPath > right.logicalPath ? 1 : 0;
}

export async function resolveSources(
  sourceSet: SourceSet,
  context: AdapterContext,
): Promise<ResolvedSources> {
  const resolved: ResolvedSources = {
    artifacts: [],
    references: [],
    skipped: [],
    failures: [],
    existingRecordSlugs: [],
  };

  const staged: Array<{
    order: number;
    logicalPath: string;
    artifact: Omit<ResolvedArtifact, "sha256" | "repostOf" | "documentClass">;
  }> = [];

  for (const [order, entry] of sourceSet.sources.entries()) {
    const output = await runAdapter(entry, context);
    resolved.references.push(...output.references);
    resolved.skipped.push(...output.skipped);
    resolved.failures.push(...output.failures);
    resolved.existingRecordSlugs.push(...output.existingRecordSlugs);
    for (const artifact of output.artifacts) {
      staged.push({ order, logicalPath: artifact.logicalPath, artifact });
    }
  }

  staged.sort(compareArtifacts);

  const firstByDigest = new Map<string, string>();
  for (const item of staged) {
    const digest = sha256(item.artifact.bytes);
    const previous = firstByDigest.get(digest);
    if (previous === undefined) firstByDigest.set(digest, item.artifact.ref);
    resolved.artifacts.push({
      ...item.artifact,
      sha256: digest,
      // A byte-identical repost keeps its own ref for the report but points at
      // the canonical artifact, so downstream stages consume it once.
      repostOf: previous ?? null,
      documentClass: null,
    });
  }

  return resolved;
}

/** Artifacts that are not byte-identical reposts of an earlier one. */
export function canonicalArtifacts(sources: ResolvedSources): ResolvedArtifact[] {
  return sources.artifacts.filter((artifact) => artifact.repostOf === null);
}
