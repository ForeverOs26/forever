#!/usr/bin/env node
/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the harness's local data plane
 * (narrow-re-review RR2-P2-2).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The committed browser proof used to build both versions against a
 * deliberately non-resolving placeholder Supabase host, on the stated
 * assumption that "a module-load failure happens strictly before any data work,
 * so no real project reference, key or credential is needed". The re-review
 * measured that assumption to be wrong: `/` has a loader that fetches the
 * featured project list during SSR, the placeholder host is `ENOTFOUND`, the
 * SSR data path throws, and EVERY scenario therefore started from an HTTP 500
 * document on which the React route tree never mounted. Scenario 19 collected
 * three assertions from its `no recovery screen was required` branch in both
 * engines; several others could pass the same way.
 *
 * The fix is not a test-only page — that would bypass the real root router and
 * the real error boundary, which are exactly what the proof exists to exercise.
 * The fix is to give the REAL application a data plane that answers, so the
 * real document renders with HTTP 200 and the real router boots.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * It is a tiny local HTTP server on 127.0.0.1 that speaks just enough
 * PostgREST and GoTrue shape for the public read paths to resolve:
 *
 *   GET  /rest/v1/<table>?...     -> `[]` with PostgREST's `Content-Range`
 *   POST /rest/v1/rpc/<fn>        -> `[]`
 *   GET  /auth/v1/settings        -> a minimal settings object
 *   *    /auth/v1/*               -> a signed-out shape; never a session
 *   everything else               -> 404 with a JSON body
 *
 * It holds NO data, issues NO token, accepts NO credential and reaches NO
 * network. An empty catalogue is a legitimate application state — the home page
 * renders its "no featured projects" path — and the scenarios are about client
 * asset loading, not about content. Nothing here is ever built into or served
 * by a production build: `build-versions.mjs` points the harness builds at it,
 * and `npm run build` never sets those variables.
 *
 * Anything it does not recognise is answered 404 rather than guessed, so a
 * future data dependency shows up as a visible application error instead of
 * being silently faked.
 */

import { createServer } from "node:http";

const PORT = Number(process.env.FOREVER_STALE_ASSET_HARNESS_SUPABASE_PORT ?? 4185);

/** Requests served, by shape. Read as evidence, never used for control flow. */
export const served = { rest: 0, rpc: 0, auth: 0, unknown: 0 };

function json(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "content-range",
    ...extraHeaders,
  });
  response.end(payload);
}

export function handle(request, response) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    response.end();
    return;
  }

  if (url.pathname === "/__stub/state") {
    json(response, 200, { ...served });
    return;
  }

  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    served.rpc += 1;
    json(response, 200, []);
    return;
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    served.rest += 1;
    // PostgREST answers a collection with a Content-Range; supabase-js reads it
    // for `count`, and an absent one makes some paths behave differently.
    json(response, 200, [], { "content-range": "*/0" });
    return;
  }

  if (url.pathname.startsWith("/auth/v1/")) {
    served.auth += 1;
    if (url.pathname === "/auth/v1/settings") {
      json(response, 200, {
        external: {},
        disable_signup: true,
        mailer_autoconfirm: false,
        autoconfirm: false,
      });
      return;
    }
    // Never a session, never a token. The harness signs nobody in.
    json(response, 200, {});
    return;
  }

  served.unknown += 1;
  json(response, 404, {
    error: "harness_supabase_stub_unhandled",
    hint: "the two-version harness stub answers only /rest/v1 and /auth/v1",
    path: url.pathname,
  });
}

export function startSupabaseStub(port = PORT) {
  const server = createServer(handle);
  return new Promise((resolveStarted) => {
    server.listen(port, "127.0.0.1", () => resolveStarted(server));
  });
}

export const SUPABASE_STUB_PORT = PORT;
export const SUPABASE_STUB_ORIGIN = `http://127.0.0.1:${PORT}`;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? "")) {
  const isDirect = process.argv[1].includes("supabase-stub");
  if (isDirect) {
    await startSupabaseStub();
    process.stdout.write(`[stale-asset-harness] supabase stub on ${SUPABASE_STUB_ORIGIN}\n`);
  }
}
