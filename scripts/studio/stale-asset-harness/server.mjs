#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — switchable two-version origin.
 *
 * Models exactly one production behaviour and nothing else: Cloudflare Workers
 * Static Assets serves only the ACTIVE version's asset set, so the moment a
 * release reaches 100% the previous version's immutable content-hashed chunks
 * stop existing at the origin. A browser still running the previous client then
 * requests a chunk that is gone.
 *
 * Layout:
 *   - `version-a` and `version-b` are two real production builds.
 *   - Both run as ordinary Node servers on private ports.
 *   - This front server owns the public port and forwards EVERY request —
 *     documents, server routes and assets alike — to whichever version is
 *     currently active, exactly as a single active Worker version would.
 *
 * A missing asset is NOT synthesised here. It is forwarded to the active
 * version, whose own router answers with its 404 document — the same
 * `404 + text/html` shape the production incident recorded for a previous
 * version's chunk. Nothing about the failure is faked.
 *
 * Control plane (harness only, never shipped): `POST /__harness/activate/a|b`
 * and `GET /__harness/state`.
 */

import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

const OUT_ROOT = resolve(
  process.env.FOREVER_STALE_ASSET_HARNESS_OUT ?? resolve(REPO_ROOT, ".stale-asset-harness"),
);
const FRONT_PORT = Number(process.env.FOREVER_STALE_ASSET_HARNESS_PORT ?? 4180);
const PORT_A = FRONT_PORT + 1;
const PORT_B = FRONT_PORT + 2;

const VERSIONS = {
  a: { dir: resolve(OUT_ROOT, "version-a"), port: PORT_A, child: null },
  b: { dir: resolve(OUT_ROOT, "version-b"), port: PORT_B, child: null },
};

let active = "a";

/**
 * Server-side document-request counter.
 *
 * The only way to prove "exactly one automatic reload" is to count the document
 * requests that actually reached the origin. A browser-side counter cannot: the
 * page that would increment it is the page being replaced.
 */
const documentRequests = [];
/** Every non-asset, non-document request — server functions above all. */
const otherRequests = [];

/**
 * Optional asset blocklist — used ONLY to construct the "the new version is
 * still broken for this client" case. Any asset whose name contains this
 * substring is answered exactly as a missing asset is: forwarded to the active
 * version, whose router returns its own 404 document. Nothing is faked.
 */
let blockedAssetSubstring = null;

function log(message) {
  process.stdout.write(`[stale-asset-harness] ${message}\n`);
}

function startVersion(key) {
  const version = VERSIONS[key];
  const entry = resolve(version.dir, "server/index.mjs");
  if (!existsSync(entry)) {
    throw new Error(
      `version ${key} is not built (missing ${entry}) — run build-versions.mjs first`,
    );
  }
  version.child = spawn(process.execPath, [entry], {
    cwd: version.dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(version.port),
      HOST: "127.0.0.1",
      NITRO_PORT: String(version.port),
    },
  });
  version.child.stdout.on("data", (chunk) => log(`[${key}] ${String(chunk).trim()}`));
  version.child.stderr.on("data", (chunk) => log(`[${key}!] ${String(chunk).trim()}`));
}

async function waitForVersion(key, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${VERSIONS[key].port}/robots.txt`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline)
      throw new Error(`version ${key} did not start within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The hashed asset names each version actually shipped — recorded as evidence. */
function assetNames(key) {
  const dir = resolve(VERSIONS[key].dir, "public/assets");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function proxy(clientRequest, clientResponse) {
  const target = VERSIONS[active];
  // A blocked asset is rewritten to a name that cannot exist, so the active
  // version answers with its own genuine 404 document — the identical response
  // shape a client gets for a chunk the active version never had.
  const path =
    blockedAssetSubstring &&
    (clientRequest.url ?? "").startsWith("/assets/") &&
    (clientRequest.url ?? "").includes(blockedAssetSubstring)
      ? "/assets/forever-harness-blocked-00000000.js"
      : clientRequest.url;
  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port: target.port,
      method: clientRequest.method,
      path,
      headers: { ...clientRequest.headers, host: `127.0.0.1:${target.port}` },
    },
    (upstreamResponse) => {
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, {
        ...upstreamResponse.headers,
        "x-forever-harness-version": active,
      });
      upstreamResponse.pipe(clientResponse);
    },
  );
  upstream.on("error", (error) => {
    clientResponse.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    clientResponse.end(`harness upstream error: ${error.message}`);
  });
  clientRequest.pipe(upstream);
}

function handleControl(clientRequest, clientResponse, url) {
  if (url.pathname === "/__harness/reset-counters") {
    documentRequests.length = 0;
    otherRequests.length = 0;
    clientResponse.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    clientResponse.end(JSON.stringify({ documentRequests: 0, otherRequests: 0 }));
    return true;
  }
  if (url.pathname === "/__harness/state") {
    const body = JSON.stringify({
      active,
      assets: { a: assetNames("a").length, b: assetNames("b").length },
      documentRequests,
      otherRequests,
    });
    clientResponse.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    clientResponse.end(body);
    return true;
  }
  const block = /^\/__harness\/block\/(.+)$/.exec(url.pathname);
  if (block) {
    blockedAssetSubstring = block[1] === "none" ? null : decodeURIComponent(block[1]);
    log(`asset blocklist set to ${blockedAssetSubstring ?? "(none)"}`);
    clientResponse.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    clientResponse.end(JSON.stringify({ blocked: blockedAssetSubstring }));
    return true;
  }
  const match = /^\/__harness\/activate\/(a|b)$/.exec(url.pathname);
  if (match) {
    active = match[1];
    log(`active version switched to ${active}`);
    clientResponse.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    clientResponse.end(JSON.stringify({ active }));
    return true;
  }
  return false;
}

async function main() {
  startVersion("a");
  startVersion("b");
  await Promise.all([waitForVersion("a"), waitForVersion("b")]);

  const front = createServer((clientRequest, clientResponse) => {
    const url = new URL(clientRequest.url ?? "/", `http://127.0.0.1:${FRONT_PORT}`);
    if (url.pathname.startsWith("/__harness/")) {
      if (handleControl(clientRequest, clientResponse, url)) return;
    }
    // A document request: not an asset, not the build probe, not the control
    // plane. Recorded as `path@version` so a reload is unmistakable.
    if (
      !url.pathname.startsWith("/assets/") &&
      url.pathname !== "/forever-build.json" &&
      url.pathname !== "/favicon.ico" &&
      (clientRequest.headers.accept ?? "").includes("text/html")
    ) {
      documentRequests.push(`${url.pathname}@${active}`);
    }
    // Everything that is neither an asset nor a document — server functions in
    // particular. Recorded so a recovery can be shown to resubmit nothing.
    if (
      !url.pathname.startsWith("/assets/") &&
      url.pathname !== "/favicon.ico" &&
      !(clientRequest.headers.accept ?? "").includes("text/html")
    ) {
      otherRequests.push(`${clientRequest.method} ${url.pathname}`);
    }
    proxy(clientRequest, clientResponse);
  });

  front.listen(FRONT_PORT, "127.0.0.1", () => {
    log(`front origin http://127.0.0.1:${FRONT_PORT} (active=${active})`);
    log(`version-a assets: ${assetNames("a").length}, version-b assets: ${assetNames("b").length}`);
  });

  const shutdown = () => {
    for (const key of Object.keys(VERSIONS)) VERSIONS[key].child?.kill();
    front.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log(`fatal: ${error.message}`);
  process.exit(1);
});
