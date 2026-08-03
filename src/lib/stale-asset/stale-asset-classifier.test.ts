/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — classifier boundary.
 *
 * The classifier's whole value is what it REFUSES. These tests enumerate both
 * halves: every accepted stale shape, and every ordinary failure that must be
 * left to the existing error path. A regression that widens the boundary is a
 * regression that reloads a page under someone mid-work.
 */

import { describe, expect, it } from "vitest";

import {
  classifyStaleAssetError,
  isStaleAssetVerdict,
  STALE_ASSET_DIRECTORY,
  STALE_ASSET_VERDICTS,
  verdictIsStale,
} from "./stale-asset-contract";

const ORIGIN = "https://forever.example.workers.dev";
const HASHED = `${ORIGIN}${STALE_ASSET_DIRECTORY}StudioDashboard-DDTDlhmi.js`;
const HASHED_CSS = `${ORIGIN}${STALE_ASSET_DIRECTORY}styles-rOblPlZC.css`;
const classify = (signal: Parameters<typeof classifyStaleAssetError>[0]) =>
  classifyStaleAssetError(signal, { origin: ORIGIN });

describe("stale asset classifier — accepted shapes", () => {
  it("accepts a failed dynamic import naming a same-origin hashed chunk", () => {
    expect(
      classify({
        kind: "dynamic_import",
        message: `Failed to fetch dynamically imported module: ${HASHED}`,
      }),
    ).toBe("stale_dynamic_import");
  });

  it("accepts the alternative dynamic-import wording browsers emit", () => {
    expect(
      classify({
        kind: "dynamic_import",
        message: `error loading dynamically imported module: ${HASHED}`,
      }),
    ).toBe("stale_dynamic_import");
  });

  it("accepts a failed CSS preload for a hashed stylesheet", () => {
    expect(
      classify({ kind: "dynamic_import", message: `Unable to preload CSS for ${HASHED_CSS}` }),
    ).toBe("stale_dynamic_import");
  });

  it("accepts a module script element failure by URL alone", () => {
    expect(classify({ kind: "module_script", assetUrl: HASHED })).toBe("stale_module_script");
  });

  it("accepts a ChunkLoadError-equivalent that carries asset evidence", () => {
    expect(
      classify({
        kind: "render_error",
        message: `ChunkLoadError: Loading chunk failed. ${HASHED}`,
      }),
    ).toBe("stale_dynamic_import");
  });

  it("accepts a hashed asset request answered with the HTML SPA fallback", () => {
    expect(
      classify({
        kind: "asset_response",
        assetUrl: HASHED,
        responseStatus: 200,
        responseContentType: "text/html; charset=utf-8",
      }),
    ).toBe("stale_asset_html_fallback");
  });

  it("accepts a hashed asset request answered 404", () => {
    expect(classify({ kind: "asset_response", assetUrl: HASHED, responseStatus: 404 })).toBe(
      "stale_asset_html_fallback",
    );
  });

  it("only ever answers with a value from the closed verdict list", () => {
    for (const verdict of STALE_ASSET_VERDICTS) expect(isStaleAssetVerdict(verdict)).toBe(true);
    expect(isStaleAssetVerdict("stale_something_else")).toBe(false);
    expect(STALE_ASSET_VERDICTS).toHaveLength(4);
    const produced = new Set(
      [
        classify({
          kind: "dynamic_import",
          message: `Failed to fetch dynamically imported module: ${HASHED}`,
        }),
        classify({ kind: "module_script", assetUrl: HASHED }),
        classify({ kind: "asset_response", assetUrl: HASHED, responseStatus: 404 }),
        classify({ kind: "render_error", message: "boom" }),
      ].map(String),
    );
    for (const verdict of produced) {
      expect(STALE_ASSET_VERDICTS as readonly string[]).toContain(verdict);
    }
  });
});

describe("stale asset classifier — refused shapes", () => {
  it("refuses an arbitrary React rendering exception", () => {
    expect(
      classify({
        kind: "render_error",
        message: "Cannot read properties of undefined (reading 'map')",
      }),
    ).toBe("not_stale_asset");
  });

  it("refuses a Supabase failure", () => {
    expect(
      classify({ kind: "render_error", message: "Supabase request failed: JWT expired" }),
    ).toBe("not_stale_asset");
  });

  it("refuses a Studio RPC failure", () => {
    expect(
      classify({ kind: "render_error", message: "studio_publish_project failed: rpc error" }),
    ).toBe("not_stale_asset");
  });

  it("refuses an authentication or permission failure", () => {
    expect(classify({ kind: "render_error", message: "Unauthorized" })).toBe("not_stale_asset");
    expect(
      classify({ kind: "render_error", message: "permission denied for table projects" }),
    ).toBe("not_stale_asset");
  });

  it("refuses an R2 or database failure", () => {
    expect(classify({ kind: "render_error", message: "R2 bucket read failed" })).toBe(
      "not_stale_asset",
    );
    expect(classify({ kind: "render_error", message: "database connection lost" })).toBe(
      "not_stale_asset",
    );
  });

  it("refuses a generic TypeError with no asset evidence", () => {
    expect(classify({ kind: "dynamic_import", message: "TypeError: Failed to fetch" })).toBe(
      "not_stale_asset",
    );
    expect(classify({ kind: "render_error", message: "TypeError: x is not a function" })).toBe(
      "not_stale_asset",
    );
  });

  it("refuses a module-load message that names no asset at all", () => {
    expect(
      classify({ kind: "dynamic_import", message: "Failed to fetch dynamically imported module" }),
    ).toBe("not_stale_asset");
  });

  it("refuses an external URL — the same-origin requirement", () => {
    expect(
      classify({
        kind: "dynamic_import",
        message:
          "Failed to fetch dynamically imported module: https://cdn.example.com/assets/thing-DDTDlhmi.js",
      }),
    ).toBe("not_stale_asset");
    expect(
      classify({
        kind: "module_script",
        assetUrl: "https://analytics.example.com/assets/a-DDTDlhmi.js",
      }),
    ).toBe("not_stale_asset");
  });

  it("refuses a message that names ANY foreign URL, even beside one of ours", () => {
    expect(
      classify({
        kind: "dynamic_import",
        message: `Failed to fetch dynamically imported module: ${HASHED} (proxied via https://extension.invalid/x)`,
      }),
    ).toBe("not_stale_asset");
  });

  it("refuses a same-origin URL outside the generated asset directory", () => {
    expect(
      classify({
        kind: "dynamic_import",
        message: `Failed to fetch dynamically imported module: ${ORIGIN}/uploads/StudioDashboard-DDTDlhmi.js`,
      }),
    ).toBe("not_stale_asset");
  });

  it("refuses a same-origin asset that is not content-hashed", () => {
    expect(
      classify({
        kind: "dynamic_import",
        message: `Failed to fetch dynamically imported module: ${ORIGIN}${STALE_ASSET_DIRECTORY}plain.js`,
      }),
    ).toBe("not_stale_asset");
  });

  it("refuses a healthy asset response", () => {
    expect(
      classify({
        kind: "asset_response",
        assetUrl: HASHED,
        responseStatus: 200,
        responseContentType: "text/javascript; charset=utf-8",
      }),
    ).toBe("not_stale_asset");
  });

  it("refuses an HTML answer for a stylesheet, which is not the SPA fallback shape", () => {
    expect(
      classify({
        kind: "asset_response",
        assetUrl: HASHED_CSS,
        responseStatus: 200,
        responseContentType: "text/html",
      }),
    ).toBe("not_stale_asset");
  });

  it("refuses everything when the origin itself is unusable", () => {
    expect(
      classifyStaleAssetError({ kind: "module_script", assetUrl: HASHED }, { origin: "not-a-url" }),
    ).toBe("not_stale_asset");
  });

  it("marks only the three stale verdicts as stale", () => {
    expect(verdictIsStale("stale_dynamic_import")).toBe(true);
    expect(verdictIsStale("stale_module_script")).toBe(true);
    expect(verdictIsStale("stale_asset_html_fallback")).toBe(true);
    expect(verdictIsStale("not_stale_asset")).toBe(false);
  });
});

describe("stale asset classifier — retention", () => {
  it("returns a bare enum value and never any part of the input", () => {
    const secretish = `${HASHED}?token=abc123&email=someone@example.com`;
    const verdict = classify({
      kind: "dynamic_import",
      message: `Failed to fetch dynamically imported module: ${secretish}`,
    });
    // The query string makes this a different URL, but whatever the verdict,
    // the OUTPUT must be a plain enum member carrying nothing from the input.
    expect(typeof verdict).toBe("string");
    expect(STALE_ASSET_VERDICTS as readonly string[]).toContain(verdict);
    expect(verdict).not.toContain("token");
    expect(verdict).not.toContain("@");
    expect(verdict).not.toContain("http");
  });
});
