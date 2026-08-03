/**
 * FOREVER-STUDIO-STALE-ASSET-RECOVERY-001 — root boundary and recovery screen.
 *
 * Three honest outcomes, and a screen that names the real cause without
 * exposing anything from the error. The end-to-end proof that the boundary
 * SWAPS correctly under a real version change is the two-version browser
 * harness; what is pinned here is the wiring and the rendered contract.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  StaleAssetRecoveryScreen,
  STALE_ASSET_RECOVERY_BODY,
  STALE_ASSET_RECOVERY_HEADING,
} from "./StaleAssetRecoveryScreen";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const root = read("src/routes/__root.tsx");

describe("the root boundary keeps three outcomes", () => {
  it("A/B — a confirmed stale asset renders the specific screen", () => {
    expect(root).toContain("isConfirmedStaleAssetError");
    expect(root).toContain("if (staleAsset) return <StaleAssetRecoveryScreen />;");
    expect(root).toContain("requireManualStaleAssetRecovery();");
  });

  it("C — every ordinary error keeps the existing generic screen, unchanged", () => {
    expect(root).toContain("This page didn't load");
    expect(root).toContain("Something went wrong on our end. You can try refreshing or head back");
    expect(root).toContain("Try again");
    expect(root).toContain("Go home");
    expect(root).toContain(
      'reportLovableError(error, { boundary: "tanstack_root_error_component" })',
    );
  });

  it("classifies through the one narrow classifier, never an ad-hoc test", () => {
    expect(root).toContain("classifyStaleAssetError");
    expect(root).toContain("verdictIsStale");
    // No second, looser notion of "looks like a chunk problem" anywhere here.
    expect(root).not.toContain("ChunkLoadError");
    expect(root).not.toContain("Failed to fetch");
  });

  it("never reloads from the boundary itself", () => {
    expect(root).not.toContain("location.reload");
    expect(root).not.toContain("location.replace");
  });

  it("renders no raw exception in either outcome", () => {
    expect(root).not.toContain("{error.message}");
    expect(root).not.toContain("{String(error)}");
    expect(root).not.toContain("error.stack");
  });

  it("clears the one-attempt marker only on proof, never on root mount", () => {
    expect(root).toContain('proof: "router_resolved"');
    expect(root).toContain('router.subscribe("onResolved"');
    // The Studio proof lives where the Studio shell actually mounts.
    const shell = read("src/features/forever-studio/components/StudioShell.tsx");
    expect(shell).toContain('proof: "studio_shell_mounted"');
  });

  it("stays safe for public routes — it reveals nothing about Studio", () => {
    const screenSource = read("src/lib/stale-asset/StaleAssetRecoveryScreen.tsx");
    for (const forbidden of ["Studio", "studio", "Owner", "publisher", "upload", "job"]) {
      expect(
        screenSource
          .split("\n")
          .filter((line) => !line.trim().startsWith("*"))
          .join("\n"),
      ).not.toContain(forbidden);
    }
  });
});

describe("the recovery screen", () => {
  it("names the real cause and offers exactly two safe actions", () => {
    render(<StaleAssetRecoveryScreen />);
    expect(screen.getByTestId("stale-asset-recovery-screen")).toBeInTheDocument();
    expect(screen.getByText(STALE_ASSET_RECOVERY_HEADING)).toBeInTheDocument();
    expect(screen.getByText(STALE_ASSET_RECOVERY_BODY)).toBeInTheDocument();
    expect(screen.getByTestId("stale-asset-recovery-reload")).toHaveTextContent(
      "Reload current version",
    );
    expect(screen.getByTestId("stale-asset-recovery-home")).toHaveTextContent("Go to site");
  });

  it("does not present the problem as an upload, Auth, database or project failure", () => {
    render(<StaleAssetRecoveryScreen />);
    const text = document.body.textContent ?? "";
    for (const wrong of [
      "upload",
      "Upload",
      "sign in",
      "Sign in",
      "password",
      "database",
      "Coralina",
      "project",
      "Retry",
      "retry",
    ]) {
      expect(text).not.toContain(wrong);
    }
  });

  it("explains that the application was updated and could not finish loading", () => {
    render(<StaleAssetRecoveryScreen />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("updated");
    expect(text).toContain("could not finish loading the latest version");
    expect(text).toContain("stay signed in");
  });

  it("renders no identifier, URL, stack or error text", () => {
    render(<StaleAssetRecoveryScreen />);
    const text = document.body.textContent ?? "";
    for (const forbidden of ["http", "/assets/", ".js", "Error", "@", "token", "undefined"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("is laid out to survive narrow viewports (real widths are proved in the browser harness)", () => {
    render(<StaleAssetRecoveryScreen />);
    const container = screen.getByTestId("stale-asset-recovery-screen");
    expect(container.className).toContain("px-4");
    expect(container.className).toContain("w-full");
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain("max-w-md");
    expect(panel.className).toContain("w-full");
    expect(screen.getByText(STALE_ASSET_RECOVERY_BODY).className).toContain("break-words");
    expect(screen.getByTestId("stale-asset-recovery-reload").parentElement?.className).toContain(
      "flex-wrap",
    );
  });

  it("depends on no lazily-loaded component — it must render when chunks are missing", () => {
    const source = read("src/lib/stale-asset/StaleAssetRecoveryScreen.tsx");
    expect(source).not.toContain("@/components/ui/");
    expect(source).not.toContain("lazy(");
    expect(source).not.toContain("import(");
    expect(source).not.toContain("@tanstack/react-router");
  });
});
