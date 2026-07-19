/**
 * Fast Intake v1 — committed CLI bootstrap.
 *
 * `npm run intake` runs `node src/intake/run-cli.mjs`. This bootstrap configures
 * jiti's `@/*` alias resolution INTERNALLY (mirroring tsconfig `paths`
 * `"@/*": ["./src/*"]`) so the owner command works in any shell — PowerShell,
 * cmd.exe, bash — with no hidden environment variable (`JITI_TSCONFIG_PATHS`,
 * `JITI_ALIAS`) and no shell-specific prefix. It adds no dependency: jiti is
 * already the repository's TypeScript CLI runner (`import`, `ingest`,
 * `factory:continue`).
 *
 * It creates no database client, makes no network request, and performs no
 * write of its own — it only loads the TypeScript CLI, which does the work.
 */

import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// `@` maps to the repository `src/` directory, exactly like tsconfig `paths`.
const srcRoot = resolve(here, "..");

const jiti = createJiti(import.meta.url, { alias: { "@": srcRoot } });
await jiti.import("./cli.ts");
