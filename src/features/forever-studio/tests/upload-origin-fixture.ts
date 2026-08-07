/**
 * Which origin a Studio uploader test is running on.
 *
 * Since Issue #103 the uploader renders an upload interface ONLY on the origin
 * this build declares itself served from, so "where is this document" is a real
 * precondition of every test that drives the upload form — not incidental
 * environment detail. jsdom defaults to `http://localhost:3000`, which is
 * deliberately not that origin: a suite that wants the form has to say so,
 * exactly as a deployment has to.
 *
 * That is also why this is a shared fixture rather than a copied snippet. When
 * the rule changes, it changes here, and every uploader suite follows.
 */

import { afterEach, beforeEach } from "vitest";

import { PUBLIC_SITE_ORIGIN } from "@/lib/site-origin";

/**
 * Put the jsdom document on one origin.
 *
 * jsdom's `window.location` is a non-assignable accessor, so the whole
 * `location` is replaced with a plain stand-in carrying the same fields. Studio
 * suites drive the router on a memory history, so nothing else reads it.
 */
export function setBrowserOrigin(origin: string, pathname = "/studio/upload"): void {
  const url = new URL(`${origin}${pathname}`);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: url.origin,
      href: url.href,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: "",
      hash: "",
      assign: () => undefined,
      replace: () => undefined,
      reload: () => undefined,
      toString: () => url.href,
    },
  });
}

/**
 * Run every test in the calling file on the origin uploads are allowed from.
 *
 * Reads the configured origin rather than a literal, so a build that sets
 * `VITE_PUBLIC_SITE_ORIGIN` runs these suites against ITS origin instead of
 * failing on one hard-coded hostname. The literal production value is pinned
 * once, in `upload-origin-guard.test.tsx`, where that is the subject.
 */
export function withProductionUploadOrigin(pathname = "/studio/upload"): void {
  const original = window.location;
  beforeEach(() => {
    setBrowserOrigin(PUBLIC_SITE_ORIGIN, pathname);
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
}
