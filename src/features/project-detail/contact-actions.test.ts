/**
 * The contact gate fails closed
 * (FOREVER-PR116-RELEASE-STABILIZATION-001, finding F5).
 *
 * Gate G0 of the contact-flow PRD: the submission path must be proven to
 * deliver end-to-end before a single new CTA is exposed to the public. It is
 * open. Everything below exists so that a half-configured environment, a typo
 * or a well-meant `true` cannot half-open it.
 */

import { describe, expect, it } from "vitest";

import {
  PROJECT_CONTACT_ACTIONS_ENABLED_TOKEN,
  PROJECT_CONTACT_ACTIONS_ENV_KEY,
  projectContactActionsEnabled,
} from "./contact-actions";

describe("project contact actions gate (F5)", () => {
  it("is closed when nothing is configured", () => {
    expect(projectContactActionsEnabled(undefined)).toBe(false);
    expect(projectContactActionsEnabled(null)).toBe(false);
    expect(projectContactActionsEnabled("")).toBe(false);
  });

  it("is closed for every value that is not the exact token", () => {
    for (const value of [
      "true",
      "TRUE",
      "1",
      "yes",
      "on",
      "Enabled",
      "ENABLED",
      " enabled",
      "enabled ",
      "enable",
      "disabled",
      "false",
      0,
      1,
      true,
      false,
      {},
      [],
      ["enabled"],
    ]) {
      expect(projectContactActionsEnabled(value), `value ${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("opens only for the exact token", () => {
    expect(projectContactActionsEnabled(PROJECT_CONTACT_ACTIONS_ENABLED_TOKEN)).toBe(true);
    expect(projectContactActionsEnabled("enabled")).toBe(true);
  });

  it("names the build-time variable it reads", () => {
    expect(PROJECT_CONTACT_ACTIONS_ENV_KEY).toBe("VITE_PROJECT_CONTACT_ACTIONS");
  });

  /**
   * The gate governs contextual project/unit actions only. The site-wide
   * `/contact` route is already public and is deliberately untouched — G0
   * concerns *new* entry points, and removing Forever's only advisory route
   * would be a different kind of harm.
   */
  it("defaults to closed when read from an unconfigured environment", () => {
    // No argument: reads import.meta.env, which carries no such key in test or
    // in any build that has not deliberately set it.
    expect(projectContactActionsEnabled()).toBe(false);
  });
});
