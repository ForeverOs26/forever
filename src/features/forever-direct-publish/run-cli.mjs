/**
 * Owner Direct Publish — committed CLI bootstrap.
 *
 * `npm run publish:direct` previously invoked the `jiti` binary directly
 * (`jiti src/features/forever-direct-publish/cli.ts`). jiti's binary does not
 * read tsconfig `paths` here, so the very first `@/…` import in the CLI's module
 * graph failed with `Cannot find module '@/import/currency-policy'` (reached via
 * publish.ts → forever-ingestion/build-batch.ts) and the command could not run
 * at all — not even `--dry-run`.
 *
 * This bootstrap configures jiti's `@/*` alias INTERNALLY (matching tsconfig
 * `paths` `"@/*": ["./src/*"]`) so the Owner command works in any shell with no
 * hidden environment variable and no shell-specific prefix. It adds no
 * dependency, and it leaves every shared module's imports untouched.
 *
 * It creates no database client and performs no write; it only loads the
 * TypeScript CLI, which decides for itself whether a run is a dry run.
 *
 * On Windows invoke as `npm.cmd run publish:direct -- ...` (PowerShell may block
 * `npm.ps1` under a normal execution policy); on bash, `npm run publish:direct -- ...`.
 */

import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// `@` maps to the repository `src/` directory, exactly like tsconfig `paths`.
const srcRoot = resolve(here, "..", "..");

const jiti = createJiti(import.meta.url, { alias: { "@": srcRoot } });
await jiti.import("./cli.ts");
