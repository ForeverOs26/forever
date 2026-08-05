"use strict";
/**
 * FOREVER-PR139-REVIEW-CORRECTIONS-001 — a PROCESS-LEVEL, loopback-exclusive
 * network guard, loaded into a child with `node --require <this file>`.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS TO REMOVE (PR139 independent review, P2-2)
 * ---------------------------------------------------------------------------
 *
 * The offline serialization proof asserted containment with:
 *
 *   expect(request.url).not.toMatch(/api\.cloudflare\.com/)
 *
 * `request.url` on a Node server request is the PATH — `/client/v4/...`. It
 * never contains a host, so that assertion could not fail for any destination
 * whatsoever, and it was evaluated only for requests that had already arrived at
 * the loopback mock. A request that went somewhere else was, by construction,
 * not inspected. The assertion proved nothing about containment.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ENFORCED NOW
 * ---------------------------------------------------------------------------
 *
 * This file is CommonJS on purpose: `--require` preloads it before the child's
 * own entry point runs, so every socket, DNS lookup and fetch the child later
 * performs goes through the patched primitives. A destination is permitted ONLY
 * when it is a loopback address AND its port is the test listener's port. Every
 * other destination is refused SYNCHRONOUSLY, before a connection is opened and
 * before a name is resolved.
 *
 * The layers patched, and why each is needed:
 *
 *   - `net.Socket.prototype.connect` — the primitive every TCP client in Node
 *     ends at, including Undici (and therefore global `fetch`);
 *   - `tls.connect` — TLS wraps a socket, but is patched directly so an HTTPS
 *     destination is named in the refusal rather than appearing as a bare TCP
 *     one;
 *   - `dns.lookup`, `dns.promises.lookup` and the `dns.resolve*` family — so a
 *     non-loopback HOSTNAME is refused BEFORE any resolver is contacted;
 *   - `http.request`/`get` and `https.request`/`get` — refuses at the point the
 *     destination is chosen, which also covers a proxy agent;
 *   - `globalThis.fetch` — validated by URL before Undici is entered.
 *
 * WHAT IS RECORDED. One JSON line per decision: the API name, the destination
 * host, the destination port and whether it was allowed. No path, no query, no
 * header, no body and no credential is read or written. The log is the
 * behavioural evidence: the serialization proof asserts it contains ONLY
 * allowed loopback records, and the negative canary asserts a blocked record
 * appears for a deliberate non-loopback attempt.
 *
 * Configured entirely by environment variables set by the spawning test:
 *   FOREVER_LOOPBACK_GUARD_PORT  the one permitted destination port
 *   FOREVER_LOOPBACK_GUARD_LOG   where the sanitized decision log is appended
 *
 * A missing or zero port means NOTHING is permitted, which is the correct
 * fail-closed default for a guard whose whole purpose is to deny.
 */

const dns = require("node:dns");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

/** The named code every refusal carries, asserted by the canary test. */
const BLOCKED_CODE = "FOREVER_LOOPBACK_GUARD_BLOCKED";

const ALLOWED_PORT = Number.parseInt(process.env.FOREVER_LOOPBACK_GUARD_PORT ?? "0", 10);
const LOG_PATH = process.env.FOREVER_LOOPBACK_GUARD_LOG ?? "";

/** Every spelling of "this machine". Nothing else is a loopback destination. */
const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "0:0:0:0:0:0:0:1",
  "[::1]",
  "localhost",
  "localhost.",
]);

function record(entry) {
  if (LOG_PATH === "") return;
  try {
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch {
    // A guard that cannot write its log still refuses; it just cannot say so.
  }
}

class LoopbackGuardViolation extends Error {
  constructor(api, host, port) {
    super(`${BLOCKED_CODE}: ${api} to ${host}:${port} is not the permitted loopback listener.`);
    this.name = "LoopbackGuardViolation";
    this.code = BLOCKED_CODE;
    this.guardApi = api;
    this.guardHost = host;
    this.guardPort = port;
  }
}

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host ?? "").toLowerCase());
}

/**
 * The single decision point. Records, then throws on refusal.
 *
 * Returns nothing on success: a caller that reaches the next statement has been
 * permitted, and there is no verdict object anyone could forget to check.
 */
function decide(api, host, port) {
  const destinationHost = String(host ?? "");
  const destinationPort = Number.parseInt(String(port ?? "0"), 10) || 0;
  const allowed =
    ALLOWED_PORT > 0 && destinationPort === ALLOWED_PORT && isLoopbackHost(destinationHost);
  record({ api, host: destinationHost, port: destinationPort, allowed });
  if (!allowed) throw new LoopbackGuardViolation(api, destinationHost, destinationPort);
}

function defaultPortFor(protocol) {
  return String(protocol) === "https:" ? 443 : 80;
}

// ---- net -------------------------------------------------------------------

/**
 * Node normalises `net.connect(...)` / `tls.connect(...)` into an ARRAY
 * `[options, callback]` before delegating to `Socket.prototype.connect`, so the
 * options object is frequently one level down. Unwrapping it here is what makes
 * the guard see the real destination rather than an empty host on port 0 —
 * which would have blocked everything, including the permitted listener.
 */
function optionsOf(args) {
  const first = args[0];
  return Array.isArray(first) ? first[0] : first;
}

const realSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  const first = optionsOf(args);
  if (typeof first === "object" && first !== null) {
    if (typeof first.path === "string" && first.path.length > 0) {
      // A pipe or unix socket. Not network egress, but not permitted either:
      // the offline proof needs no IPC and an allowance would be untested.
      decide("net.connect.ipc", first.path, 0);
    }
    // `host` omitted means `localhost` in Node's own semantics. Mirrored rather
    // than treated as empty, so the guard decides on the real destination.
    decide("net.connect", first.host ?? "localhost", first.port ?? 0);
  } else if (typeof first === "string") {
    decide("net.connect.ipc", first, 0);
  } else {
    decide("net.connect", typeof args[1] === "string" ? args[1] : "localhost", first ?? 0);
  }
  return realSocketConnect.apply(this, args);
};

// ---- tls -------------------------------------------------------------------

const realTlsConnect = tls.connect;
tls.connect = function guardedTlsConnect(...args) {
  const first = optionsOf(args);
  if (typeof first === "object" && first !== null) {
    decide("tls.connect", first.host ?? first.servername ?? "localhost", first.port ?? 0);
  } else {
    decide("tls.connect", typeof args[1] === "string" ? args[1] : "localhost", first ?? 0);
  }
  return realTlsConnect.apply(this, args);
};

// ---- dns — refused BEFORE any resolver is contacted ------------------------

function guardDnsLookup(realLookup, api) {
  return function guardedLookup(hostname, options, callback) {
    if (isLoopbackHost(hostname)) return realLookup.call(dns, hostname, options, callback);
    record({ api, host: String(hostname ?? ""), port: 0, allowed: false });
    const violation = new LoopbackGuardViolation(api, String(hostname ?? ""), 0);
    const done = typeof options === "function" ? options : callback;
    if (typeof done === "function") {
      process.nextTick(() => done(violation));
      return undefined;
    }
    throw violation;
  };
}

dns.lookup = guardDnsLookup(dns.lookup, "dns.lookup");
if (dns.promises && typeof dns.promises.lookup === "function") {
  const realPromiseLookup = dns.promises.lookup;
  dns.promises.lookup = function guardedPromiseLookup(hostname, options) {
    if (isLoopbackHost(hostname)) return realPromiseLookup.call(dns.promises, hostname, options);
    record({ api: "dns.promises.lookup", host: String(hostname ?? ""), port: 0, allowed: false });
    return Promise.reject(
      new LoopbackGuardViolation("dns.promises.lookup", String(hostname ?? ""), 0),
    );
  };
}
for (const method of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveCname"]) {
  if (typeof dns[method] !== "function") continue;
  const real = dns[method];
  dns[method] = function guardedResolve(hostname, ...rest) {
    if (isLoopbackHost(hostname)) return real.call(dns, hostname, ...rest);
    record({ api: `dns.${method}`, host: String(hostname ?? ""), port: 0, allowed: false });
    const callback = rest.find((argument) => typeof argument === "function");
    const violation = new LoopbackGuardViolation(`dns.${method}`, String(hostname ?? ""), 0);
    if (callback) {
      process.nextTick(() => callback(violation));
      return undefined;
    }
    throw violation;
  };
}

// ---- http / https ----------------------------------------------------------

function guardHttpEntry(module, name, api, protocol) {
  const real = module[name];
  module[name] = function guardedHttpEntry(...args) {
    const first = args[0];
    if (typeof first === "string" || first instanceof URL) {
      const url = new URL(String(first));
      decide(api, url.hostname, url.port === "" ? defaultPortFor(url.protocol) : url.port);
    } else if (typeof first === "object" && first !== null) {
      const host = first.hostname ?? first.host ?? "localhost";
      // An absent port is the protocol default. `url.port` is the EMPTY STRING
      // for a default-port URL, which `??` would happily pass through as a port
      // of zero — so emptiness is treated as absence, not as a value.
      const port =
        first.port === undefined || first.port === null || first.port === ""
          ? defaultPortFor(protocol)
          : first.port;
      decide(api, String(host).replace(/:\d+$/, ""), port);
    }
    return real.apply(module, args);
  };
}

guardHttpEntry(http, "request", "http.request", "http:");
guardHttpEntry(http, "get", "http.get", "http:");
guardHttpEntry(https, "request", "https.request", "https:");
guardHttpEntry(https, "get", "https.get", "https:");

// ---- fetch (Undici) --------------------------------------------------------

if (typeof globalThis.fetch === "function") {
  const realFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(resource, options) {
    const target =
      typeof resource === "string" || resource instanceof URL
        ? new URL(String(resource))
        : new URL(String(resource && resource.url));
    decide(
      "fetch",
      target.hostname,
      target.port === "" ? defaultPortFor(target.protocol) : target.port,
    );
    return realFetch.call(globalThis, resource, options);
  };
}

module.exports = { BLOCKED_CODE };
