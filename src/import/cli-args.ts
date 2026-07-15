import type { ImportProjectOptions } from "./importer";

export type ParseImportInvocationResult =
  | { ok: true; options: ImportProjectOptions; approvalFile?: string }
  | { ok: false; error: string };

/**
 * Pure CLI argument resolution (no side effects, safe to import in tests).
 *
 * Rejects ambiguous or incompatible mode combinations before any work, so
 * misuse fails closed with a clear reason. Presence of `--inspect-collisions`
 * is required for collision inspection and presence of
 * `--execute-approved-import` is required for execution; the absence of
 * `--dry-run` never implies either mode.
 */
export function parseImportInvocation(args: string[]): ParseImportInvocationResult {
  const projectSlug = args.find((arg) => !arg.startsWith("-"));
  const dryRun = args.includes("--dry-run");
  const inspectCollisions = args.includes("--inspect-collisions");
  const executeApprovedImport = args.includes("--execute-approved-import");
  const option = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

  if (!projectSlug) {
    return { ok: false, error: "A project slug is required." };
  }

  const target = option("target");
  const expectedPlanHash = option("plan-hash");
  const confirmation = option("confirm");
  const targetProjectId = option("target-project-id");
  const approvalFile = option("approval-file");

  const modeCount = [dryRun, inspectCollisions, executeApprovedImport].filter(Boolean).length;
  if (modeCount > 1) {
    return {
      ok: false,
      error:
        "--dry-run, --inspect-collisions, and --execute-approved-import are mutually exclusive. Choose exactly one mode.",
    };
  }

  if (inspectCollisions && (!target || !expectedPlanHash || !confirmation)) {
    return {
      ok: false,
      error:
        "Collision inspection requires --target, --plan-hash, and --confirm. Inspection remains read-only and execute mode stays disabled.",
    };
  }

  if (
    executeApprovedImport &&
    (!target || !expectedPlanHash || !confirmation || !targetProjectId || !approvalFile)
  ) {
    return {
      ok: false,
      error:
        "Approved execution requires --target, --plan-hash, --confirm, --target-project-id, and --approval-file. The request fails closed before any transaction, database client, network access, or approval consumption.",
    };
  }

  if (
    !dryRun &&
    !inspectCollisions &&
    !executeApprovedImport &&
    (!target || !expectedPlanHash || !confirmation)
  ) {
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
      executeApprovedImport,
      target,
      expectedPlanHash,
      confirmation,
      targetIdentity: targetProjectId ? { projectId: targetProjectId } : undefined,
    },
    approvalFile,
  };
}
