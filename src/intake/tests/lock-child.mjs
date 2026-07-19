import { createJiti } from "jiti";

const projectDir = process.argv[2];
const lifetimeMs = Number(process.argv[3] ?? 3_000);
if (!projectDir) process.exit(2);

const jiti = createJiti(import.meta.url);
const { acquireProjectLock } = await jiti.import("../txn.ts");
const acquired = acquireProjectLock(projectDir);
process.stdout.write(`LOCK_CHILD|pid=${process.pid}|acquired=${acquired}\n`);
if (!acquired) process.exit(3);

// Intentionally exit without releasing. This reproduces a process that died
// after acquiring the lock and leaves its real pid for reclamation.
setTimeout(() => process.exit(0), lifetimeMs);
