import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { MAX_MEDIA_SANITIZE_BYTES } from "../server/media-truth";

/**
 * Cloudflare memory boundary regression.
 *
 * Sanitizing a near-cap (24 MiB) image must not amplify memory. The design
 * guarantees this by (a) never re-running the sanitizer during verification and
 * (b) parsing with zero-copy subarray views, so the only large allocation is
 * the single derivative built alongside the resident source. This test runs the
 * real sanitizer in a CLEAN child process on a generated near-cap valid image
 * and asserts the peak resident-set growth attributable to the call stays
 * within ~1 derivative — far below what a double-rewrite path (≈4×) would use.
 *
 * `resourceUsage().maxRSS` is the process-lifetime peak (KiB); measuring it both
 * before and after the call isolates the growth caused by the call itself.
 */
const DRIVER = (modUrl: string) => `
import { createPublicDerivative } from ${JSON.stringify(modUrl)};
import { createHash } from "node:crypto";

const MB = 1024 * 1024;
const kind = process.argv[2];
const total = Number(process.argv[3]) * MB;
const sha = (b) => createHash("sha256").update(b).digest("hex");

let crcTable = null;
function crc32(b) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n=0;n<256;n++){ let c=n; for (let k=0;k<8;k++) c = c&1 ? 0xedb88320 ^ (c>>>1) : c>>>1; crcTable[n]=c>>>0; } }
  let crc = 0xffffffff;
  for (let i=0;i<b.length;i++) crc = crcTable[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// Build the source as ONE contiguous allocation, as downloadWithin() returns it.
function buildJpeg(t) {
  const s = Buffer.alloc(t, 0x00); let o = 0; const put = (...b) => { for (const x of b) s[o++] = x; };
  put(0xff, 0xd8);
  put(0xff, 0xe0, 0x00, 0x10); "JFIF\\0".split("").forEach((c) => (s[o++] = c.charCodeAt(0))); put(1,1,0,0,1,0,1,0,0);
  put(0xff, 0xc0, 0x00, 0x11, 8, 0, 2, 0, 3, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0);
  put(0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0);
  s[t - 2] = 0xff; s[t - 1] = 0xd9; // EOI; scan region between is 0x00 entropy
  return s;
}
function buildPng(t) {
  const s = Buffer.alloc(t, 0x11); let o = 0; const put = (...b) => { for (const x of b) s[o++] = x; };
  put(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);
  const ihdrStart = o; put(0,0,0,13); "IHDR".split("").forEach((c) => (s[o++] = c.charCodeAt(0)));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(3,0); ihdr.writeUInt32BE(2,4); ihdr[8]=8; ihdr[9]=6; ihdr.copy(s,o); o += 13;
  s.writeUInt32BE(crc32(s.subarray(ihdrStart+4, o)), o); o += 4;
  const idatLen = t - o - 12 - 12;
  const idatStart = o; s.writeUInt32BE(idatLen, o); o += 4; "IDAT".split("").forEach((c) => (s[o++] = c.charCodeAt(0)));
  o += idatLen;
  s.writeUInt32BE(crc32(s.subarray(idatStart+4, o)), o); o += 4;
  const iendStart = o; s.writeUInt32BE(0, o); o += 4; "IEND".split("").forEach((c) => (s[o++] = c.charCodeAt(0)));
  s.writeUInt32BE(crc32(s.subarray(iendStart+4, o)), o); o += 4;
  return s.subarray(0, o);
}

const src = kind === "png" ? buildPng(total) : buildJpeg(total);
const digest = sha(src);
global.gc(); global.gc();
const beforeKiB = process.resourceUsage().maxRSS;
const r = createPublicDerivative({ bytes: src, originalSha256: digest, originalSize: src.length, observedContentType: kind === "png" ? "image/png" : "image/jpeg" });
const afterKiB = process.resourceUsage().maxRSS;
process.stdout.write(JSON.stringify({
  kind, eligible: r.eligible,
  sourceBytes: src.length,
  derivativeBytes: r.eligible ? r.bytes.length : null,
  beforeKiB, afterKiB,
}));
`;

function runChild(kind: "jpeg" | "png", megabytes: number) {
  const root = mkdtempSync(join(tmpdir(), "forever-media-mem-"));
  try {
    const modPath = join(root, "media-truth.mjs");
    // Transpile the sanitizer in a CLEAN subprocess. esbuild's buildSync/JS API
    // cannot run inside the vitest worker (its patched globals trip an esbuild
    // invariant), so the CLI is invoked via a fresh node process instead.
    const transpile = spawnSync(
      process.execPath,
      [
        "node_modules/esbuild/bin/esbuild",
        "src/features/forever-studio/server/media-truth.ts",
        `--outfile=${modPath}`,
        "--format=esm",
        "--platform=node",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    if (transpile.status !== 0) {
      throw new Error(`transpile_failed:${transpile.status}:${transpile.stderr.slice(0, 600)}`);
    }
    const driverPath = join(root, "driver.mjs");
    writeFileSync(driverPath, DRIVER(pathToFileURL(modPath).href), "utf8");
    const result = spawnSync(
      process.execPath,
      ["--expose-gc", driverPath, kind, String(megabytes)],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      throw new Error(`memory_child_failed:${result.status}:${result.stderr.slice(0, 600)}`);
    }
    return JSON.parse(result.stdout) as {
      kind: string;
      eligible: boolean;
      sourceBytes: number;
      derivativeBytes: number | null;
      beforeKiB: number;
      afterKiB: number;
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("FOREVER-MEDIA-TRUTH-001 Cloudflare memory boundary", () => {
  const nearCapMiB = Math.floor(MAX_MEDIA_SANITIZE_BYTES / (1024 * 1024)) - 2; // ~22 MiB

  for (const kind of ["jpeg", "png"] as const) {
    it(`sanitizes a near-cap ${kind.toUpperCase()} without memory amplification`, () => {
      const m = runChild(kind, nearCapMiB);
      expect(m.eligible).toBe(true);
      const growthBytes = (m.afterKiB - m.beforeKiB) * 1024;
      // The call's peak growth must stay within ~1 derivative. A regression that
      // reintroduced a second full rewrite during verification would roughly
      // triple this. 2× the source leaves generous headroom for GC noise while
      // still catching such a regression.
      expect(growthBytes).toBeLessThan(m.sourceBytes * 2);
      // Sanity: a real derivative was produced at near-cap size.
      expect(m.derivativeBytes).toBeGreaterThan(m.sourceBytes - 4096);
    }, 60_000);
  }
});
