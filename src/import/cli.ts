import { readFile } from "node:fs/promises";

import { parseImportInvocation } from "./cli-args";
import { InMemoryApprovalRegistry } from "./execution-approval";
import { importProject } from "./importer";
import { logFailure } from "./logger";

function printUsage() {
  console.log("Usage:");
  console.log("  npm run import <project-slug>");
  console.log("  npm run import <project-slug> -- --dry-run");
  console.log(
    "  npm run import <project-slug> -- --inspect-collisions --target=<target> --plan-hash=<sha256> --confirm=<project-slug>:<short-hash> --target-project-id=<non-secret-id>",
  );
  console.log(
    "  npm run import <project-slug> -- --execute-approved-import --target=<target> --plan-hash=<sha256> --confirm=<project-slug>:<short-hash> --target-project-id=<non-secret-id> --approval-file=<path>",
  );
  console.log("");
  console.log("Examples:");
  console.log("  npm run import modeva");
  console.log("  npm run import modeva -- --dry-run");
  console.log("  npm run import coralina -- --inspect-collisions --target=local ...");
  console.log("  npm run import katabello");
  console.log("  npm run import gardens-of-eden");
}

async function main() {
  const args = process.argv.slice(2);
  const projectSlug = args.find((arg) => !arg.startsWith("-"));

  if (!projectSlug || projectSlug === "--help" || projectSlug === "-h") {
    printUsage();
    process.exit(projectSlug ? 0 : 1);
  }

  const parsed = parseImportInvocation(args);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  let approval: unknown;
  if (parsed.options.executeApprovedImport && parsed.approvalFile) {
    try {
      approval = JSON.parse(await readFile(parsed.approvalFile, "utf-8"));
    } catch {
      throw new Error(
        "The approval file could not be read as JSON. The request fails closed before any transaction.",
      );
    }
  }

  const summary = await importProject({
    ...parsed.options,
    approval,
    // The CLI has no durable one-time registry yet; live execution is disabled
    // regardless, and the request fails closed at the live runner boundary.
    approvalRegistry: parsed.options.executeApprovedImport
      ? new InMemoryApprovalRegistry()
      : undefined,
  });

  // Fail closed: a blocking collision report must return a non-zero exit code.
  if (summary.status === "collision_blocked") {
    logFailure(
      "Collision inspection found blocking findings. Resolve them before any future approved import is considered.",
    );
    process.exit(1);
  }
  if (
    summary.status === "execution_rolled_back" ||
    summary.status === "execution_rejected" ||
    summary.status === "execution_failed"
  ) {
    logFailure(
      "Approved execution did not commit. The request was rejected, rolled back, or failed without a confirmed commit.",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  logFailure(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
