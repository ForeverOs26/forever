import { parseImportInvocation } from "./cli-args";
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
    "  npm run import <project-slug> -- --target=<target> --plan-hash=<sha256> --confirm=<project-slug>:<short-hash> --target-project-id=<non-secret-id>",
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

  const summary = await importProject(parsed.options);

  // Fail closed: a blocking collision report must return a non-zero exit code.
  if (summary.status === "collision_blocked") {
    logFailure(
      "Collision inspection found blocking findings. Resolve them before any future approved import is considered.",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  logFailure(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
