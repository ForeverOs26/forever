/**
 * SIP-001A — committed comparison-CLI bootstrap. See `compare-cli.ts`.
 *
 * `npm run sip:compare-price-list` runs `node src/intake/sip/compare-run-cli.mjs`.
 * Reads only local files given explicitly on the command line; creates no
 * database client and makes no network request.
 */

import { createJiti } from "jiti";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..", "..");

const jiti = createJiti(import.meta.url, { alias: { "@": srcRoot } });
await jiti.import("./compare-cli.ts");
