/**
 * Coralina intake readiness profile — the caller-stated requirements the
 * RC4.9 engine judges the slice against.
 *
 * The requirements mirror the committed intake policy, not this module's
 * opinion:
 *
 * - `forever-data/projects/coralina/manifest.json` → `readiness_policy`
 *   requires the brochure and price list and recommends the master plan,
 *   unit plans, and images (the images/media collection is not registered by
 *   this slice — no project fact derives from it — so its recommended
 *   statement is deliberately not evaluated here);
 * - the manifest's `ready_for_import_rule` blocks import while
 *   `SOURCE_PENDING` values remain — those `field_present` requirements are
 *   DERIVED from {@link CORALINA_EXPECTED_MISSING_PATHS} (required for the
 *   manifest blockers, recommended for the other documented gaps), so the gap
 *   list and the readiness profile cannot drift apart;
 * - the remaining statements cover the cross-source consistency of what was
 *   actually extracted.
 *
 * With Coralina's committed data the expected verdict is BLOCKED — the same
 * verdict the repository's import-status records (`ready_for_import: false`).
 */

import {
  describeReadinessProfile,
  readinessRequirement,
  type ReadinessProfile,
  type ReadinessRequirement,
} from "@/features/forever-project-readiness";

import { CORALINA_EXPECTED_MISSING_PATHS } from "./facts";

/**
 * One `field_present` statement per documented Coralina gap: the manifest's
 * SOURCE_PENDING blockers are required, the other gaps recommended.
 */
const GAP_REQUIREMENTS: ReadinessRequirement[] = CORALINA_EXPECTED_MISSING_PATHS.map((gap) =>
  readinessRequirement("field_present", {
    path: gap.path,
    necessity: gap.manifestBlocker ? "required" : "recommended",
    note: gap.reason,
  }),
);

/** The caller-stated Coralina intake readiness profile. */
export const CORALINA_READINESS_PROFILE: ReadinessProfile = describeReadinessProfile({
  slug: "coralina-import-intake",
  name: "Coralina import intake readiness",
  requirements: [
    // Required sources — manifest readiness_policy.required.
    readinessRequirement("source_present", { documentType: "brochure", minimumTrust: "standard" }),
    readinessRequirement("source_present", {
      documentType: "price_list",
      minimumTrust: "standard",
    }),
    // Required identity fields — DATA_STANDARD mandatory project identity.
    readinessRequirement("field_present", { path: "general.name" }),
    readinessRequirement("field_confidence", { path: "general.name", minimumConfidence: "high" }),
    readinessRequirement("field_uncontested", { path: "general.name" }),
    readinessRequirement("field_present", { path: "general.projectType" }),
    readinessRequirement("field_present", { path: "location.area" }),
    readinessRequirement("field_present", { path: "location.province" }),
    // The documented data gaps, derived from CORALINA_EXPECTED_MISSING_PATHS
    // (manifest SOURCE_PENDING blockers are required; the rest recommended).
    ...GAP_REQUIREMENTS,
    // Recommended sources — manifest readiness_policy.recommended (the images
    // collection is intentionally out of this slice's registered scope).
    readinessRequirement("source_present", {
      documentType: "master_plan",
      necessity: "recommended",
    }),
    readinessRequirement("source_present", { documentType: "unit_plan", necessity: "recommended" }),
    // Recommended consistency statements about what was actually extracted.
    readinessRequirement("field_corroborated", {
      path: "units.buildings",
      necessity: "recommended",
    }),
    readinessRequirement("field_present", { path: "units.unitTypes", necessity: "recommended" }),
    readinessRequirement("field_uncontested", {
      path: "units.unitTypes",
      necessity: "recommended",
    }),
    readinessRequirement("findings_clear", { necessity: "recommended" }),
  ],
  metadata: {
    description:
      "Caller-stated Coralina intake requirements mirroring forever-data/projects/coralina/manifest.json readiness_policy.",
    owner: "Forever intake",
    tags: ["coralina", "rc5.0"],
  },
});
