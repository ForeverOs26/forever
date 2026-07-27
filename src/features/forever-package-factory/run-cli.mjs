/**
 * Package Factory — committed CLI bootstrap.
 *
 * Mirrors `src/features/forever-direct-publish/run-cli.mjs`: jiti's binary does
 * not read tsconfig `paths` here, so the `@/…` imports reached through the
 * shared ingestion modules would fail. Configuring the alias internally keeps
 * the Owner command working in any shell with no environment variable and no
 * shell-specific prefix.
 *
 * It creates no database client and performs no write; the TypeScript CLI
 * decides for itself whether a run generates, publishes, or only plans.
 *
 * On Windows invoke as `npm.cmd run package:factory -- ...`; on bash,
 * `npm run package:factory -- ...`.
 */

import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..", "..");

const jiti = createJiti(import.meta.url, { alias: { "@": srcRoot } });
await jiti.import("./cli.ts");
