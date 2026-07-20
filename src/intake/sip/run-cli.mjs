/**
 * SIP-001A — committed CLI bootstrap.
 *
 * `npm run sip:price-list` runs `node src/intake/sip/run-cli.mjs`. Mirrors
 * `src/intake/run-cli.mjs`: configures jiti's `@/*` alias resolution
 * internally so the command works in any shell with no hidden environment
 * variable. Adds no dependency — jiti is already the repository's
 * TypeScript CLI runner.
 *
 * It creates no database client, makes no network request, and performs no
 * production write — it only loads the TypeScript CLI, which writes local
 * generated artifacts and nothing else.
 *
 * On Windows invoke it as `npm.cmd run sip:price-list -- ...`.
 */

import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// `@` maps to the repository `src/` directory, exactly like tsconfig `paths`.
const srcRoot = resolve(here, "..", "..");

const jiti = createJiti(import.meta.url, { alias: { "@": srcRoot } });
await jiti.import("./cli.ts");
