import type { ImportProjectOptions } from "./importer";

export type ParseImportInvocationResult =
  | { ok: true; options: ImportProjectOptions }
  | { ok: false; error: string };

/**
 * Pure CLI argument resolution (no side effects, safe to import in tests).
 *
 * Rejects ambiguous or incompatible mode combinations before any work, so
 * misuse fails closed with a clear reason. Presence of `--inspect-collisions`
 * is required for collision inspection; the absence of `--dry-run` never
 * implies inspection.
 */
export function parseImportInvocation(args: string[]): ParseImportInvocationResult {
  const projectSlug = args.find((arg) => !arg.startsWith("-"));
  const dryRun = args.includes("--dry-run");
  const inspectCollisions = args.includes("--inspect-collisions");
  const option = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

  if (!projectSlug) {
    return { ok: false, error: "A project slug is required." };
  }

  const target = option("target");
  const expectedPlanHash = option("plan-hash");
  const confirmation = option("confirm");
  const targetProjectId = option("target-project-id");

  if (dryRun && inspectCollisions) {
    return {
      ok: false,
      error:
        "--dry-run and --inspect-collisions are mutually exclusive. Dry-run performs no database access; collision inspection performs read-only queries.",
    };
  }

  if (inspectCollisions && (!target || !expectedPlanHash || !confirmation)) {
    return {
      ok: false,
      error:
        "Collision inspection requires --target, --plan-hash, and --confirm. Inspection remains read-only and execute mode stays disabled.",
    };
  }

  if (!dryRun && !inspectCollisions && (!target || !expectedPlanHash || !confirmation)) {
    return {
      ok: false,
      error:
        "Future execute requests require --target, --plan-hash, and --confirm. Execute mode remains disabled.",
    };
  }

  return {
    ok: true,
    options: {
      projectSlug,
      dryRun,
      inspectCollisions,
      target,
      expectedPlanHash,
      confirmation,
      targetIdentity: targetProjectId ? { projectId: targetProjectId } : undefined,
    },
  };
}
