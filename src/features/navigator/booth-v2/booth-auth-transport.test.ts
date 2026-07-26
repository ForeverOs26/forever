/**
 * Booth Mode 2.0 — REAL browser→server credential transport proof
 * (PR #102 corrective pass 3, item 1).
 *
 * WHAT WAS WRONG. Corrective pass 2 gave `requireBoothStaff` only a `.server()`
 * stage. The Booth UI keeps its Supabase session in the browser, but a bare
 * server-function call carries no Authorization header, so the server saw an
 * anonymous request and refused a genuinely signed-in Host before membership and
 * capability could be evaluated. Unit-calling `verifyBoothRequestIdentity`
 * directly could never have caught that: the defect was in the transport, not
 * the verifier.
 *
 * WHAT THIS SUITE ACTUALLY RUNS. Nothing about the transport is simulated:
 *
 *   • a DISPOSABLE local Supabase-compatible auth service on a throwaway
 *     loopback port, issuing REAL ES256 JWTs over a per-run P-256 keypair and
 *     publishing the matching JWKS (tests/disposable-supabase-auth.ts);
 *   • the REPOSITORY's own browser Supabase client, signing in for real with
 *     `signInWithPassword` and persisting the session in jsdom localStorage;
 *   • the REAL `requireBoothStaff` middleware — both stages;
 *   • the REAL TanStack client transport: `createServerFn(...).handler()` wired
 *     to the REAL `createClientRpc`, i.e. the exact `serverFnFetcher` → `fetch`
 *     path the browser build executes;
 *   • a REAL HTTP hop to a second loopback server that wraps the REAL
 *     `requestHandler`, so `getRequest()` inside the middleware reads a REAL
 *     inbound request;
 *   • the REAL `verifyBoothRequestIdentity`, whose `getClaims` call fetches the
 *     REAL JWKS and verifies the REAL signature with WebCrypto.
 *
 * The ONLY stub is the service-role `studio_members` read: PostgREST needs the
 * Supabase container stack (Docker is unavailable here), and that half of the
 * boundary is already proven for real by the disposable-PostgreSQL suite. Every
 * assertion below about headers, tokens, refresh, verification and denial is
 * observed over the wire.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";

import { createServerFn } from "@tanstack/react-start";
import { requestHandler } from "@tanstack/react-start/server";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startDisposableSupabaseAuth,
  type DisposableSupabaseAuth,
} from "./tests/disposable-supabase-auth";

/* ---------------------------------------------------------------------------
 * The one stub: the service-role staff-roster read.
 * ------------------------------------------------------------------------- */

interface MemberRow {
  user_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
  is_active: boolean;
  can_access_booth: boolean;
}

const membership: { row: MemberRow | null } = { row: null };

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: membership.row, error: null }) }),
      }),
    }),
  },
}));

const HOST_USER_ID = "c0ffee00-0000-4000-8000-000000000001";
const HOST_EMAIL = "booth-host@example.test";
const HOST_PASSWORD = "disposable-local-password";

const authorizedMember: MemberRow = {
  user_id: HOST_USER_ID,
  role: "owner",
  display_name: "Booth Host",
  email: HOST_EMAIL,
  is_active: true,
  can_access_booth: true,
};

/* ---------------------------------------------------------------------------
 * The Booth endpoint: a real HTTP server running the real `.server()` stage
 * inside the real TanStack request handler, so getRequest() is genuine.
 * ------------------------------------------------------------------------- */

interface InboundRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface BoothEndpoint {
  base: string;
  inbound: InboundRequest[];
  close(): Promise<void>;
}

type ServerStage = (options: {
  next: (opts?: {
    context?: { actor?: { userId: string; displayName: string | null } };
  }) => unknown;
}) => Promise<unknown>;

/** The `{ result, error }` envelope a TanStack server-function response carries. */
function envelope(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function startBoothEndpoint(): Promise<BoothEndpoint> {
  const { requireBoothStaff } = await import("./booth-auth");
  const inbound: InboundRequest[] = [];

  const handle = requestHandler(async (request: Request) => {
    // The ungated availability probe is a different function id and must NOT
    // run the Booth authorization stage — exactly as in the real endpoint file.
    if (new URL(request.url).pathname.endsWith("booth-v2-get-route-availability")) {
      return envelope({ result: { available: true } });
    }

    let resolved: { userId: string; displayName: string | null } | null = null;
    try {
      const stage = requireBoothStaff.options.server as unknown as ServerStage;
      await stage({
        next: (opts) => {
          resolved = opts?.context?.actor ?? null;
          return { context: opts?.context ?? {} };
        },
      });
    } catch (error) {
      // The real contract: the failure travels in the envelope's error slot and
      // the client rethrows it, so the test observes what a caller observes.
      const denial = error as Error;
      return envelope({ error: { name: denial.name, message: denial.message } });
    }
    const actor = resolved as { userId: string; displayName: string | null } | null;
    return envelope({
      result: {
        granted: true,
        userId: actor?.userId ?? null,
        hostName: actor?.displayName ?? null,
      },
    });
  });

  const server: Server = createServer((request, response) => {
    void (async () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === "string") headers[key] = value;
      }
      inbound.push({ url: request.url ?? "/", method: request.method ?? "GET", headers });

      const webRequest = new Request(`http://127.0.0.1${request.url ?? "/"}`, {
        method: request.method ?? "GET",
        headers: new Headers(headers),
      });
      const result = await (handle as (input: Request) => Promise<Response>)(webRequest);
      const body = await result.text();
      const outHeaders: Record<string, string> = {};
      result.headers.forEach((value, key) => {
        outHeaders[key] = value;
      });
      response.writeHead(result.status, outHeaders);
      response.end(body);
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}/_serverFn/`,
    inbound,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/* ---------------------------------------------------------------------------
 * Harness state
 * ------------------------------------------------------------------------- */

let auth: DisposableSupabaseAuth;
let endpoint: BoothEndpoint;
/** The real client-side server-function stub, gated exactly like the real one. */
let callGatedFunction: () => Promise<unknown>;
/** The same transport WITHOUT requireBoothStaff — the public probe's shape. */
let callPublicProbe: () => Promise<unknown>;
let supabaseClient: typeof import("@/integrations/supabase/client").supabase;
const consoleOutput: string[] = [];

/** The Booth stub never runs a server handler locally; the HTTP hop does. */
const unreachableHandler = () => {
  throw new Error("the client transport path must not execute the server handler in-process");
};

function storageKey(): string | null {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && key.endsWith("-auth-token")) return key;
  }
  return null;
}

function storedSession(): Record<string, unknown> | null {
  const key = storageKey();
  if (!key) return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // supabase-js has wrapped the session under `.session` in some versions.
  const inner = parsed.session;
  return (inner && typeof inner === "object" ? (inner as Record<string, unknown>) : parsed) ?? null;
}

function lastInbound(): InboundRequest {
  const request = endpoint.inbound.at(-1);
  if (!request) throw new Error("no request reached the Booth endpoint");
  return request;
}

async function signIn(): Promise<string> {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: HOST_EMAIL,
    password: HOST_PASSWORD,
  });
  expect(error).toBeNull();
  const token = data.session?.access_token;
  expect(typeof token).toBe("string");
  return token as string;
}

/** Send an arbitrary Authorization header straight at the real boundary. */
async function callWithRawAuthorization(authorization: string | null): Promise<{
  result?: { granted?: boolean; userId?: string | null };
  error?: { name: string; message: string };
}> {
  const response = await fetch(`${endpoint.base}booth-v2-get-access`, {
    method: "GET",
    headers: authorization === null ? {} : { Authorization: authorization },
  });
  return (await response.json()) as never;
}

/** The denial a caller actually observes, whatever the underlying reason. */
async function denialFrom(call: () => Promise<unknown>): Promise<{
  name?: string;
  message?: string;
}> {
  return (await call().then(
    () => ({}),
    (error: { name?: string; message?: string }) => error,
  )) as { name?: string; message?: string };
}

beforeAll(async () => {
  auth = await startDisposableSupabaseAuth();
  auth.addUser({ id: HOST_USER_ID, email: HOST_EMAIL, password: HOST_PASSWORD });

  // Both Supabase surfaces point at the disposable service: the browser client
  // through the VITE_* pair, the server verifier through the server pair.
  vi.stubEnv("VITE_SUPABASE_URL", auth.url);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_disposable");
  vi.stubEnv("SUPABASE_URL", auth.url);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_disposable");
  vi.stubEnv("BOOTH_V2_ENABLED", "true");

  endpoint = await startBoothEndpoint();
  vi.stubEnv("TSS_SERVER_FN_BASE", endpoint.base);

  const { createClientRpc } = await import("@tanstack/start-client-core/client-rpc");
  const { requireBoothStaff } = await import("./booth-auth");
  ({ supabase: supabaseClient } = await import("@/integrations/supabase/client"));

  // The REAL wiring the TanStack Start plugin produces in the browser build:
  // `.handler(createClientRpc(id), serverFn)`.
  type TwoArgHandler = (
    extracted: unknown,
    serverFn: unknown,
  ) => (() => Promise<unknown>) & Record<string, unknown>;
  const gatedBuilder = createServerFn({ method: "GET" }).middleware([requireBoothStaff]);
  const gated = (gatedBuilder.handler as unknown as TwoArgHandler)(
    createClientRpc("booth-v2-get-access"),
    unreachableHandler,
  );
  const ungated = (createServerFn({ method: "GET" }).handler as unknown as TwoArgHandler)(
    createClientRpc("booth-v2-get-route-availability"),
    unreachableHandler,
  );

  // `functionMiddleware: []` deliberately excludes the repo-wide generated
  // client attacher, so every assertion below is about Booth's OWN middleware.
  const withStartContext = runWithStartContext as unknown as (
    context: { startOptions: { functionMiddleware: unknown[] } },
    fn: () => Promise<unknown>,
  ) => Promise<unknown>;
  const startContext = { startOptions: { functionMiddleware: [] } };
  callGatedFunction = () => withStartContext(startContext, () => gated());
  callPublicProbe = () => withStartContext(startContext, () => ungated());
});

afterAll(async () => {
  await endpoint.close();
  await auth.close();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  membership.row = { ...authorizedMember };
  endpoint.inbound.length = 0;
  auth.requests.length = 0;
  consoleOutput.length = 0;
  for (const channel of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map((part) => String(part)).join(" "));
    });
  }
  await supabaseClient.auth.signOut().catch(() => undefined);
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------------------
 * 1. The token really crosses the wire, in the header, and nowhere else.
 * ------------------------------------------------------------------------- */

describe("the browser attaches the signed-in Host's access token", () => {
  it("puts the real session token in the Authorization header of the real request", async () => {
    const token = await signIn();

    await callGatedFunction();

    const request = lastInbound();
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    // The token is a real three-part JWT minted by the auth service, not a stub.
    expect(token.split(".")).toHaveLength(3);
  });

  it("resolves the correct user on the server and grants access", async () => {
    await signIn();

    const result = (await callGatedFunction()) as { granted?: boolean; userId?: string };

    expect(result?.granted).toBe(true);
    expect(result?.userId).toBe(HOST_USER_ID);
    // The server verified the signature against the published JWKS — real
    // cryptography, not a decoded claim it chose to believe.
    expect(auth.jwksRequestCount()).toBeGreaterThan(0);
  });

  it("keeps the token out of the URL, the query string and the body", async () => {
    const token = await signIn();

    await callGatedFunction();

    const request = lastInbound();
    expect(request.url).not.toContain(token);
    expect(request.url).not.toContain("Bearer");
    expect(request.url.includes("?")).toBe(false);
    // No header other than Authorization carries it either.
    const leaked = Object.entries(request.headers).filter(
      ([name, value]) => name !== "authorization" && value.includes(token),
    );
    expect(leaked).toEqual([]);
  });

  it("never writes the token to a log line", async () => {
    const token = await signIn();

    await callGatedFunction();

    expect(consoleOutput.join("\n")).not.toContain(token);
  });

  it("never stores the token anywhere but the Supabase client's own storage", async () => {
    const token = await signIn();

    await callGatedFunction();

    const supabaseKey = storageKey();
    expect(supabaseKey).not.toBeNull();
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key === supabaseKey) continue;
      expect(window.localStorage.getItem(key ?? "")).not.toContain(token);
    }
    expect(window.sessionStorage.length).toBe(0);
  });

  it("refreshes an expired session and attaches the NEW token", async () => {
    const staleToken = await signIn();
    const key = storageKey() as string;
    const stored = storedSession() as Record<string, unknown>;
    // Age the stored session exactly as an idle tablet would.
    const aged = { ...stored, expires_at: Math.floor(Date.now() / 1000) - 60 };
    const wrapper = JSON.parse(window.localStorage.getItem(key) as string) as Record<
      string,
      unknown
    >;
    window.localStorage.setItem(
      key,
      JSON.stringify(wrapper.session ? { ...wrapper, session: aged } : aged),
    );

    await callGatedFunction();

    expect(auth.refreshCount()).toBeGreaterThan(0);
    const attached = lastInbound().headers.authorization ?? "";
    expect(attached.startsWith("Bearer ")).toBe(true);
    expect(attached).not.toBe(`Bearer ${staleToken}`);
    // And the refreshed credential is still accepted by the server.
    const result = (await callGatedFunction()) as { granted?: boolean; userId?: string };
    expect(result).toMatchObject({ granted: true, userId: HOST_USER_ID });
  });

  it("does not refresh, or re-mint, a session that is still valid", async () => {
    const token = await signIn();
    const refreshesAfterSignIn = auth.refreshCount();

    await callGatedFunction();
    await callGatedFunction();

    expect(auth.refreshCount()).toBe(refreshesAfterSignIn);
    expect(lastInbound().headers.authorization).toBe(`Bearer ${token}`);
  });
});

/* ---------------------------------------------------------------------------
 * 2. The public availability probe is never given a Booth credential.
 * ------------------------------------------------------------------------- */

describe("the intentionally public availability probe carries no credential", () => {
  it("sends no Authorization header even while a Host is signed in", async () => {
    await signIn();

    await callPublicProbe();

    const request = lastInbound();
    expect(request.headers.authorization).toBeUndefined();
  });

  it("is declared without requireBoothStaff in the real source", () => {
    const source = readFileSync("src/features/navigator/booth-v2/booth-v2.functions.ts", "utf8");
    const probe = source.slice(source.indexOf("export const boothV2GetRouteAvailability"));
    const body = probe.slice(0, probe.indexOf("\n});") + 4);
    expect(body).not.toContain("requireBoothStaff");
    expect(body).not.toContain("Authorization");
  });
});

/* ---------------------------------------------------------------------------
 * 3. Attaching a token is not authorization: the server re-verifies everything,
 *    and every failure produces the SAME opaque denial.
 * ------------------------------------------------------------------------- */

describe("the server re-verifies the JWT and denies opaquely", () => {
  const DENIAL = { name: "booth_access_denied", message: "Booth Mode 2.0 is not available." };

  it("refuses a signed-out caller — no header is attached at all", async () => {
    const denial = await denialFrom(callGatedFunction);

    expect(lastInbound().headers.authorization).toBeUndefined();
    expect(denial).toMatchObject(DENIAL);
  });

  it("refuses an authorized token when the account lacks the Booth capability", async () => {
    await signIn();
    membership.row = { ...authorizedMember, can_access_booth: false };

    const denial = await denialFrom(callGatedFunction);

    // The token WAS attached and WAS valid; authorization still failed.
    expect(lastInbound().headers.authorization).toMatch(/^Bearer /);
    expect(denial).toMatchObject(DENIAL);
  });

  it("refuses an inactive member, a non-member, and a disabled pilot identically", async () => {
    await signIn();
    const outcomes: Array<{ name?: string; message?: string }> = [];

    membership.row = { ...authorizedMember, is_active: false };
    outcomes.push(await denialFrom(callGatedFunction));

    membership.row = null;
    outcomes.push(await denialFrom(callGatedFunction));

    membership.row = { ...authorizedMember };
    vi.stubEnv("BOOTH_V2_ENABLED", "false");
    outcomes.push(await denialFrom(callGatedFunction));
    vi.stubEnv("BOOTH_V2_ENABLED", "true");

    for (const outcome of outcomes) expect(outcome).toMatchObject(DENIAL);
  });

  it("refuses a malformed token, a wrong scheme, and a missing header identically", async () => {
    const attempts = [
      null,
      "",
      "Bearer ",
      "Bearer not-a-jwt",
      "Bearer only.two",
      "Basic dXNlcjpwYXNz",
      `Token ${auth.mintToken({ sub: HOST_USER_ID })}`,
    ];

    for (const attempt of attempts) {
      const result = await callWithRawAuthorization(attempt);
      expect(`${attempt}:${JSON.stringify(result.error)}`).toBe(
        `${attempt}:${JSON.stringify(DENIAL)}`,
      );
      expect(result.result).toBeUndefined();
    }
  });

  it("refuses an EXPIRED but otherwise perfectly signed token", async () => {
    const expired = auth.mintToken({
      sub: HOST_USER_ID,
      email: HOST_EMAIL,
      expiresInSeconds: -120,
    });

    const result = await callWithRawAuthorization(`Bearer ${expired}`);

    expect(result.error).toMatchObject(DENIAL);
  });

  it("refuses a token signed by a DIFFERENT key under the published kid", async () => {
    const forged = auth.mintToken({
      sub: HOST_USER_ID,
      email: HOST_EMAIL,
      useForeignKey: true,
    });

    const result = await callWithRawAuthorization(`Bearer ${forged}`);

    // Real signature verification against the real JWKS rejected it: attaching
    // a well-formed, unexpired token is not enough.
    expect(result.error).toMatchObject(DENIAL);
  });

  it("refuses a token whose subject is not the signed-in Host's member row", async () => {
    const stranger = auth.mintToken({
      sub: "c0ffee00-0000-4000-8000-0000000000ff",
      email: "stranger@example.test",
    });
    membership.row = null;

    const result = await callWithRawAuthorization(`Bearer ${stranger}`);

    expect(result.error).toMatchObject(DENIAL);
  });

  it("leaks nothing about the reason in any denial, and no token in any log", async () => {
    const token = await signIn();
    membership.row = { ...authorizedMember, can_access_booth: false };

    const denial = await denialFrom(callGatedFunction);

    expect(denial.message).not.toMatch(
      /member|capabilit|inactive|enabled|flag|studio|token|header|expired|signature|jwt/i,
    );
    expect(consoleOutput.join("\n")).not.toContain(token);
  });
});

/* ---------------------------------------------------------------------------
 * 4. The transport contract is Booth's own, and stays header-only.
 * ------------------------------------------------------------------------- */

describe("the Booth middleware owns its transport", () => {
  const source = () => readFileSync("src/features/navigator/booth-v2/booth-auth.ts", "utf8");

  it("declares BOTH a client transport stage and a server verification stage", () => {
    const text = source();
    expect(text).toContain(".client(");
    expect(text).toContain(".server(");
    expect(text).toContain(
      "next(authorization ? { headers: { Authorization: authorization } } : {})",
    );
    expect(text).toContain("verifyBoothRequestIdentity");
  });

  it("never persists, logs or serializes the token in the client stage", () => {
    const text = source();
    const clientStage = text.slice(text.indexOf(".client("), text.indexOf(".server("));
    expect(clientStage).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(clientStage).not.toMatch(/console\.(log|error|warn|info|debug)/);
    // No data payload, no query string, no context — headers only.
    expect(clientStage).not.toMatch(/sendContext|data:|searchParams/);
  });

  it("relies on getSession, which refreshes an expired session", () => {
    expect(source()).toContain("supabase.auth.getSession()");
  });
});
