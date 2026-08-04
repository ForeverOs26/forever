/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — the stale client asset contract.
 *
 * WHAT THIS EXISTS FOR. Cloudflare Workers Static Assets serves only the
 * ACTIVE Worker version's asset set. A release replaces the whole
 * content-hashed set atomically, so a browser still executing the previous
 * client build asks for chunk URLs that no longer exist. The origin answers
 * `404` with an HTML document, the dynamic `import()` rejects, the route load
 * throws, and the generic root error boundary renders — with no Worker
 * exception and therefore nothing to see server-side.
 *
 * WHAT THIS MODULE IS. A pure vocabulary and one narrow classifier. It has no
 * DOM, network, storage, router, React or Supabase import, so the decision that
 * matters — "is this specific failure a stale versioned asset, or is it an
 * ordinary application error?" — can be tested directly and cannot drift from
 * the code that acts on it.
 *
 * THE BOUNDARY IS DELIBERATELY NARROW. Treating an ordinary error as a version
 * problem would reload the page under a user whose work is unfinished, so every
 * rule below is a reason to answer `not_stale_asset`. A verdict of "stale"
 * requires positive, same-origin, content-hashed asset evidence — never a
 * message alone, never a status alone, and never anything carrying a URL this
 * application did not emit.
 *
 * WHAT IS NEVER RETURNED OR RETAINED. The classifier's entire output is one
 * value from a closed enum. It never returns, stores or echoes the complete
 * asset URL, a query string, a stack trace, an error message, a token, a user
 * id, an email, a job id, an object key, a filename or a Supabase project ref.
 */

/** Every answer the classifier can give. Nothing outside this list exists. */
export const STALE_ASSET_VERDICTS = [
  "stale_dynamic_import",
  "stale_module_script",
  "stale_asset_html_fallback",
  "not_stale_asset",
] as const;

export type StaleAssetVerdict = (typeof STALE_ASSET_VERDICTS)[number];

export function isStaleAssetVerdict(value: unknown): value is StaleAssetVerdict {
  return typeof value === "string" && (STALE_ASSET_VERDICTS as readonly string[]).includes(value);
}

export function verdictIsStale(verdict: StaleAssetVerdict): boolean {
  return verdict !== "not_stale_asset";
}

/**
 * The directory the build emits content-hashed client chunks into.
 *
 * Pinned rather than inferred: the whole point of the same-origin + directory +
 * hash triple is that a URL from somewhere else — an extension, an analytics
 * script, a user's proxy — can never satisfy it.
 */
export const STALE_ASSET_DIRECTORY = "/assets/";

/**
 * A content-hashed chunk emitted by this build: `<name>-<hash>.<ext>`.
 *
 * The hash is Rollup's base64url digest, at least eight characters. An asset
 * WITHOUT a hash is deliberately rejected: an unhashed file is not immutable,
 * so its absence is not evidence of a version transition.
 */
const CONTENT_HASHED_ASSET = /-[A-Za-z0-9_$-]{8,}\.(?:js|mjs|css)$/;

/** Every http(s) URL in a piece of text, so a foreign one can be refused. */
const URL_IN_TEXT = /https?:\/\/[^\s"'`<>)\]]+/g;

/**
 * The bounded set of message shapes this build's own module loader produces.
 *
 * Verified against the real production bundle: Vite's preload helper throws
 * "Failed to fetch dynamically imported module: <url>" and "Unable to preload
 * CSS for <url>"; the browser reports "Importing a module script failed" and
 * "Failed to load module script"; bundlers in the same family produce
 * "ChunkLoadError" / "Loading chunk … failed".
 */
const STALE_MESSAGE_PHRASES = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "failed to fetch dynamically imported",
  "importing a module script failed",
  "failed to load module script",
  "unable to preload css for",
  "chunkloaderror",
  "loading chunk",
] as const;

/**
 * Vocabulary that positively identifies a NON-asset failure.
 *
 * Applied to the message with every recognised asset URL removed first, so a
 * chunk legitimately named `studio-auth-<hash>.js` cannot be mistaken for an
 * authentication error. This is defence in depth: such a message would already
 * have failed the asset-evidence test.
 */
const NON_ASSET_MARKERS = [
  "supabase",
  "postgrest",
  "jwt",
  "row-level security",
  "permission denied",
  "unauthorized",
  "forbidden",
  "service role",
  "r2",
  "s3",
  "bucket",
  "database",
  "sql",
  "rpc",
  "studio_",
] as const;

/**
 * How the failure was observed. Closed on purpose: the observation point is
 * what distinguishes the three stale verdicts from each other.
 */
export type StaleAssetSignalKind =
  /** A rejected dynamic `import()` / module preload (the `vite:preloadError` path). */
  | "dynamic_import"
  /** A `<script type="module">` or `<link rel="modulepreload">` element error. */
  | "module_script"
  /** A response observed directly for an asset request. */
  | "asset_response"
  /** An exception that surfaced at a React error boundary. */
  | "render_error";

export type StaleAssetSignal = {
  kind: StaleAssetSignalKind;
  /** Raw text used ONLY to decide; never stored, rendered or returned. */
  message?: string | null;
  /** Raw URL used ONLY to decide; never stored, rendered or returned. */
  assetUrl?: string | null;
  responseStatus?: number | null;
  responseContentType?: string | null;
};

export type StaleAssetClassifierContext = {
  /** The application's own origin, e.g. `https://example.workers.dev`. */
  origin: string;
};

function lower(value: string | null | undefined): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function parseSameOriginAsset(raw: string, origin: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  // A production content-hashed chunk request never carries a query or a
  // fragment (independent-review P3-1). The hash test below reads only
  // `pathname`, so without this a hashed path with an arbitrary `?…` or `#…`
  // attached would still classify as one of ours. Refusing the whole candidate
  // is strictly safer than testing a path while ignoring what follows it.
  if (url.search !== "" || url.hash !== "") return null;
  if (!url.pathname.startsWith(STALE_ASSET_DIRECTORY)) return null;
  if (!CONTENT_HASHED_ASSET.test(url.pathname)) return null;
  return url;
}

/**
 * Every URL mentioned in the message, and whether any of them is foreign.
 *
 * A message that names ANY external URL is refused outright, even when it also
 * names one of ours: an error whose text an extension or a third-party script
 * contributed to is not evidence about this deployment's asset set.
 */
function readMessageUrls(
  message: string,
  origin: string,
): { sameOrigin: URL | null; sawForeign: boolean; stripped: string } {
  const matches = message.match(URL_IN_TEXT) ?? [];
  let sameOrigin: URL | null = null;
  let sawForeign = false;
  let stripped = message;
  for (const candidate of matches) {
    stripped = stripped.split(candidate).join(" ");
    let parsed: URL | null = null;
    try {
      parsed = new URL(candidate);
    } catch {
      sawForeign = true;
      continue;
    }
    if (parsed.origin !== origin) {
      sawForeign = true;
      continue;
    }
    const asset = parseSameOriginAsset(parsed.href, origin);
    if (asset && !sameOrigin) sameOrigin = asset;
  }
  return { sameOrigin, sawForeign, stripped };
}

function messageLooksLikeModuleLoadFailure(message: string): boolean {
  const text = lower(message);
  return STALE_MESSAGE_PHRASES.some((phrase) => text.includes(phrase));
}

function messageNamesNonAssetFailure(stripped: string): boolean {
  const text = lower(stripped);
  return NON_ASSET_MARKERS.some((marker) => text.includes(marker));
}

function contentTypeIsHtml(contentType: string | null | undefined): boolean {
  return lower(contentType).includes("text/html");
}

function assetIsScriptLike(url: URL): boolean {
  return url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs");
}

/**
 * The one decision. Returns a closed verdict and nothing else.
 *
 * The order is the contract:
 *
 *   1. an explicit asset URL, or a same-origin hashed URL found in the message,
 *      is REQUIRED — no asset evidence, no stale verdict;
 *   2. any foreign URL anywhere in the message is an immediate refusal;
 *   3. the URL must be same-origin, inside the generated asset directory, and
 *      content-hashed;
 *   4. a message that names a non-asset failure is refused even then;
 *   5. only now does the observation point choose between the three stale
 *      verdicts, and `asset_response` additionally requires the response itself
 *      to look like the SPA fallback (HTML for a script, or 404).
 */
export function classifyStaleAssetError(
  signal: StaleAssetSignal,
  context: StaleAssetClassifierContext,
): StaleAssetVerdict {
  const origin = (() => {
    try {
      return new URL(context.origin).origin;
    } catch {
      return "";
    }
  })();
  if (!origin) return "not_stale_asset";

  const message = typeof signal.message === "string" ? signal.message : "";
  const { sameOrigin: fromMessage, sawForeign, stripped } = readMessageUrls(message, origin);
  if (sawForeign) return "not_stale_asset";

  const explicit =
    typeof signal.assetUrl === "string" && signal.assetUrl.length > 0
      ? parseSameOriginAsset(signal.assetUrl, origin)
      : null;
  if (typeof signal.assetUrl === "string" && signal.assetUrl.length > 0 && !explicit) {
    // A URL was supplied and it is NOT one of ours. That is positive evidence
    // against, not missing evidence.
    return "not_stale_asset";
  }

  const asset = explicit ?? fromMessage;
  if (!asset) return "not_stale_asset";
  if (messageNamesNonAssetFailure(stripped)) return "not_stale_asset";

  switch (signal.kind) {
    case "dynamic_import":
      // The payload of `vite:preloadError` is already proof of a module-load
      // failure; the message check keeps a hand-constructed signal honest.
      return message === "" || messageLooksLikeModuleLoadFailure(message)
        ? "stale_dynamic_import"
        : "not_stale_asset";

    case "module_script":
      return "stale_module_script";

    case "asset_response": {
      const html = contentTypeIsHtml(signal.responseContentType) && assetIsScriptLike(asset);
      const missing = signal.responseStatus === 404;
      return html || missing ? "stale_asset_html_fallback" : "not_stale_asset";
    }

    case "render_error":
      // The strictest gate. An exception reaching a React boundary could be
      // anything, so it needs BOTH the module-load vocabulary and the asset
      // evidence before it counts.
      return messageLooksLikeModuleLoadFailure(message)
        ? "stale_dynamic_import"
        : "not_stale_asset";
  }
}
