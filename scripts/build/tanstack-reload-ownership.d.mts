/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — types for the build-time plugin
 * that removes TanStack Router's built-in reload (independent-review P1-5).
 *
 * The plugin itself is plain JavaScript because it runs inside the Vite config
 * before any TypeScript pipeline exists. These declarations let the contract
 * test — and the config — consume it without `any`.
 */

export declare const TANSTACK_ROUTER_PINNED_VERSION: string;
export declare const UPSTREAM_LAZY_MODULE: string;
export declare const FORBIDDEN_TANSTACK_RELOAD_KEY: string;
export declare const UPSTREAM_RELOAD_FINGERPRINT: readonly string[];
export declare const UPSTREAM_DISABLE_OPTIONS: readonly string[];

export declare function resolveUpstreamLazyModulePath(): string;
export declare function installedTanstackRouterVersion(): string;
export declare function stripDocumentation(source: string): string;

export declare function checkTanstackReloadFingerprint(): {
  version: string;
  path: string;
  readable: boolean;
  pinnedVersionMatches: boolean;
  missingMarkers: string[];
  newOptions: string[];
  ok: boolean;
};

export declare function foreverTanstackReloadOwnership(): {
  name: string;
  enforce: "pre";
  configResolved(): void;
  load(id: string): string | null;
};
