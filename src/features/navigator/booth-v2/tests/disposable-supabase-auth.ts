/**
 * A DISPOSABLE local Supabase-compatible auth service, for the Booth V2
 * credential-transport proof (PR #102 corrective pass 3, item 1).
 *
 * WHY THIS EXISTS. Proving that the browser really attaches the Host's access
 * token, and that the server really verifies it, needs a genuine signed-in
 * session and a genuine cryptographic verification — not a mocked
 * `getSession()` and not a stubbed `getClaims()`. The full local Supabase stack
 * needs Docker, which is not available in this environment, so this module
 * stands up the two auth surfaces `@supabase/supabase-js` actually talks to,
 * over real HTTP, on a throwaway loopback port:
 *
 *   POST /auth/v1/token?grant_type=password        → a real signed session
 *   POST /auth/v1/token?grant_type=refresh_token   → a real rotated session
 *   GET  /auth/v1/.well-known/jwks.json            → the real public JWK
 *   GET  /auth/v1/user                             → the symmetric fallback
 *   POST /auth/v1/logout                           → sign-out
 *
 * The tokens are REAL JWTs: ES256 over a real P-256 keypair generated per run,
 * signed with node:crypto in the JWS `ieee-p1363` (r‖s) encoding, published
 * through a real JWKS document. `supabase.auth.getClaims()` therefore verifies
 * the signature with WebCrypto against the published key — so a token signed by
 * `foreignKey` is rejected by real cryptography, not by a test double, and the
 * server's refusal to trust an attached token is demonstrated rather than
 * asserted.
 *
 * Nothing here is production code, no key is committed, and no external service
 * is contacted: the keypair is generated in-process and dies with the test.
 */

import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const KEY_ID = "booth-v2-disposable-key";

export interface DisposableUser {
  id: string;
  email: string;
  password: string;
}

export interface MintOptions {
  sub: string;
  email?: string | null;
  /** Seconds from now. Negative values mint an already-expired token. */
  expiresInSeconds?: number;
  /** Sign with the wrong key while keeping the published `kid`. */
  useForeignKey?: boolean;
  /** Omit `kid` to force the symmetric/`getUser()` fallback path. */
  omitKid?: boolean;
  algorithm?: string;
}

export interface ObservedAuthRequest {
  method: string;
  url: string;
  grantType: string | null;
}

export interface DisposableSupabaseAuth {
  /** Base URL to hand to the Supabase clients as SUPABASE_URL. */
  url: string;
  issuer: string;
  addUser(user: DisposableUser): void;
  mintToken(options: MintOptions): string;
  /** Every request the service received, in order. */
  requests: ObservedAuthRequest[];
  refreshCount(): number;
  jwksRequestCount(): number;
  close(): Promise<void>;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export async function startDisposableSupabaseAuth(): Promise<DisposableSupabaseAuth> {
  const primary = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const foreign = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = primary.publicKey.export({ format: "jwk" }) as Record<string, unknown>;

  const users = new Map<string, DisposableUser>();
  /** refresh_token → the user it belongs to. */
  const refreshTokens = new Map<string, DisposableUser>();
  const requests: ObservedAuthRequest[] = [];
  let refreshes = 0;
  let jwksReads = 0;
  let issuer = "";

  function mintToken(options: MintOptions): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresIn = options.expiresInSeconds ?? 3600;
    const header: Record<string, unknown> = {
      alg: options.algorithm ?? "ES256",
      typ: "JWT",
    };
    if (options.omitKid !== true) header.kid = KEY_ID;
    const payload = {
      iss: `${issuer}/auth/v1`,
      sub: options.sub,
      aud: "authenticated",
      role: "authenticated",
      email: options.email ?? null,
      iat: nowSeconds,
      exp: nowSeconds + expiresIn,
      session_id: `session-${options.sub}`,
    };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
    const key: KeyObject = options.useForeignKey === true ? foreign.privateKey : primary.privateKey;
    // JWS ES256 requires the raw r‖s form, not DER.
    const signature = cryptoSign("sha256", Buffer.from(signingInput), {
      key,
      dsaEncoding: "ieee-p1363",
    });
    return `${signingInput}.${base64url(signature)}`;
  }

  function sessionFor(user: DisposableUser, refreshToken: string): Record<string, unknown> {
    const expiresIn = 3600;
    const accessToken = mintToken({ sub: user.id, email: user.email, expiresInSeconds: expiresIn });
    refreshTokens.set(refreshToken, user);
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        aud: "authenticated",
        role: "authenticated",
        email: user.email,
        email_confirmed_at: new Date(0).toISOString(),
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
      },
    };
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", issuer || "http://127.0.0.1");
      const grantType = url.searchParams.get("grant_type");
      requests.push({ method: request.method ?? "GET", url: request.url ?? "/", grantType });

      if (request.method === "GET" && url.pathname === "/auth/v1/.well-known/jwks.json") {
        jwksReads += 1;
        sendJson(response, 200, {
          keys: [{ ...publicJwk, kid: KEY_ID, alg: "ES256", use: "sig" }],
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/auth/v1/token") {
        const raw = await readBody(request);
        let body: Record<string, unknown> = {};
        try {
          body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          body = {};
        }

        if (grantType === "refresh_token") {
          refreshes += 1;
          const presented = typeof body.refresh_token === "string" ? body.refresh_token : "";
          const user = refreshTokens.get(presented);
          if (!user) {
            sendJson(response, 400, {
              error: "invalid_grant",
              error_description: "Invalid Refresh Token",
            });
            return;
          }
          // Rotate: the caller must end up holding a genuinely NEW token.
          sendJson(response, 200, sessionFor(user, `refreshed-${refreshes}-${presented}`));
          return;
        }

        if (grantType === "password") {
          const email = typeof body.email === "string" ? body.email : "";
          const password = typeof body.password === "string" ? body.password : "";
          const user = users.get(email.toLowerCase());
          if (!user || user.password !== password) {
            sendJson(response, 400, {
              error: "invalid_grant",
              error_description: "Invalid login credentials",
            });
            return;
          }
          sendJson(response, 200, sessionFor(user, `refresh-${user.id}`));
          return;
        }

        sendJson(response, 400, { error: "unsupported_grant_type" });
        return;
      }

      if (url.pathname === "/auth/v1/user") {
        const authorization = request.headers.authorization ?? "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        let sub = "";
        try {
          const payload = JSON.parse(
            Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
          ) as { sub?: string };
          sub = typeof payload.sub === "string" ? payload.sub : "";
        } catch {
          sub = "";
        }
        const user = [...users.values()].find((candidate) => candidate.id === sub);
        if (!user) {
          sendJson(response, 401, { message: "invalid claim: missing sub claim" });
          return;
        }
        sendJson(response, 200, {
          id: user.id,
          aud: "authenticated",
          role: "authenticated",
          email: user.email,
          app_metadata: {},
          user_metadata: {},
          created_at: new Date(0).toISOString(),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/auth/v1/logout") {
        response.writeHead(204);
        response.end();
        return;
      }

      sendJson(response, 404, { message: "not found" });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}`;

  return {
    url: issuer,
    issuer,
    addUser: (user) => users.set(user.email.toLowerCase(), user),
    mintToken,
    requests,
    refreshCount: () => refreshes,
    jwksRequestCount: () => jwksReads,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
