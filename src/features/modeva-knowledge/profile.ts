/**
 * Modeva intake readiness profile — the caller-stated requirements the RC4.9
 * engine judges the definition against.
 *
 * The requirements mirror the same Forever intake standard the Coralina
 * manifest encodes (`readiness_policy`: brochure and price list required;
 * master plan and unit plans recommended) plus the DATA_STANDARD mandatory
 * project identity fields. Modeva has no committed manifest of its own, so
 * the standard is stated here explicitly rather than transcribed.
 *
 * With Modeva's committed artifacts the expected verdict is BLOCKED — the
 * project is live in the product database, but its committed knowledge
 * package has no developer brochure (or any developer document besides the
 * embedded price list), so it would not pass Forever's own intake bar. That
 * gap is exactly what this profile is meant to surface, not smooth over.
 */

import {
  describeReadinessProfile,
  readinessRequirement,
  type ReadinessProfile,
  type ReadinessRequirement,
} from "@/features/forever-project-readiness";

import { MODEVA_EXPECTED_MISSING_PATHS } from "./facts";

/**
 * One `field_present` statement per documented Modeva gap. None is a
 * manifest blocker (Modeva has no committed manifest), so all are
 * recommended — the required blocker for Modeva is the missing brochure
 * source below.
 */
const GAP_REQUIREMENTS: ReadinessRequirement[] = MODEVA_EXPECTED_MISSING_PATHS.map((gap) =>
  readinessRequirement("field_present", {
    path: gap.path,
    necessity: gap.manifestBlocker ? "required" : "recommended",
    note: gap.reason,
  }),
);

/** The caller-stated Modeva intake readiness profile. */
export const MODEVA_READINESS_PROFILE: ReadinessProfile = describeReadinessProfile({
  slug: "modeva-import-intake",
  name: "Modeva import intake readiness",
  requirements: [
    // Required sources — the Forever intake standard (brochure + price list).
    readinessRequirement("source_present", { documentType: "brochure", minimumTrust: "standard" }),
    readinessRequirement("source_present", {
      documentType: "price_list",
      minimumTrust: "standard",
    }),
    // Required identity fields — DATA_STANDARD mandatory project identity.
    // The name's settling statement is the canonical seed (medium), so the
    // stated confidence bar is medium — no higher certainty is invented.
    readinessRequirement("field_present", { path: "general.name" }),
    readinessRequirement("field_confidence", {
      path: "general.name",
      minimumConfidence: "medium",
    }),
    readinessRequirement("field_uncontested", { path: "general.name" }),
    readinessRequirement("field_present", { path: "general.projectType" }),
    readinessRequirement("field_present", { path: "location.area" }),
    readinessRequirement("field_present", { path: "location.province" }),
    // Unlike Coralina, Modeva's committed artifacts state these — the two
    // fields that block Coralina are met here.
    readinessRequirement("field_present", { path: "location.country" }),
    readinessRequirement("field_present", { path: "developer.name" }),
    // The documented data gaps, derived from MODEVA_EXPECTED_MISSING_PATHS.
    ...GAP_REQUIREMENTS,
    // Recommended sources — the Forever intake standard's recommended set.
    readinessRequirement("source_present", {
      documentType: "master_plan",
      necessity: "recommended",
    }),
    readinessRequirement("source_present", { documentType: "unit_plan", necessity: "recommended" }),
    // Recommended consistency statements about what was actually stated.
    readinessRequirement("field_corroborated", {
      path: "general.name",
      necessity: "recommended",
    }),
    readinessRequirement("field_corroborated", {
      path: "developer.name",
      necessity: "recommended",
    }),
    readinessRequirement("field_corroborated", {
      path: "location.area",
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
      "Caller-stated Modeva intake requirements mirroring the Forever intake standard (the same readiness_policy the Coralina manifest encodes) plus DATA_STANDARD mandatory identity fields.",
    owner: "Forever intake",
    tags: ["modeva", "rc5.1"],
  },
});
