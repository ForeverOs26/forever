/**
 * Forever Project Readiness — profile validation.
 *
 * Structural guards over one {@link ReadinessProfile}: it must carry an id,
 * a slug, and a name, every requirement must be individually coherent, and
 * no demand may be stated twice (the engine would set the restatement aside
 * — a described profile never needs to rely on that). A structurally absent
 * part is reported as missing, never dereferenced. All checks return issues;
 * none throw.
 */

import { isAbsent, isNonEmptyString } from "../helpers";
import type { ReadinessProfile } from "../profile";
import { readinessRequirementSignature } from "../requirement";
import { readinessError } from "../types";
import type { ReadinessIssue } from "../types";
import { validateReadinessRequirement } from "./requirement";

/**
 * Validate a whole profile. `base` locates it; empty when standalone.
 *
 * Never throws: a profile so hostile it cannot even be read settles into one
 * structured issue.
 */
export function validateReadinessProfile(profile: ReadinessProfile, base = ""): ReadinessIssue[] {
  try {
    return validateReadinessProfileUnguarded(profile, base);
  } catch {
    return [
      readinessError(
        "unvalidatable_input",
        "Readiness profile behaved in a way that could not be validated",
        base === "" ? "profile" : base,
      ),
    ];
  }
}

function validateReadinessProfileUnguarded(
  profile: ReadinessProfile,
  base: string,
): ReadinessIssue[] {
  const at = (path: string) => (base === "" ? path : `${base}.${path}`);
  if (isAbsent(profile)) {
    return [
      readinessError(
        "missing_profile",
        "Readiness profile is absent",
        base === "" ? "profile" : base,
      ),
    ];
  }
  const issues: ReadinessIssue[] = [];

  if (!isNonEmptyString(profile.id)) {
    issues.push(readinessError("missing_profile_id", "Profile is missing an id", at("id")));
  }
  if (!isNonEmptyString(profile.slug)) {
    issues.push(readinessError("missing_profile_slug", "Profile is missing a slug", at("slug")));
  }
  if (!isNonEmptyString(profile.name)) {
    issues.push(readinessError("missing_profile_name", "Profile is missing a name", at("name")));
  }
  if (!Array.isArray(profile.requirements)) {
    issues.push(
      readinessError(
        "invalid_profile_requirements",
        "Profile requirements must be a list",
        at("requirements"),
      ),
    );
    return issues;
  }

  const seenSignatures = new Set<string>();
  // Indexed — never a hole-skipping iterator — so an absent slot is reported
  // as a missing requirement instead of vanishing silently.
  for (let index = 0; index < profile.requirements.length; index += 1) {
    const requirement = profile.requirements[index];
    const requirementBase = at(`requirements.${index}`);
    issues.push(...validateReadinessRequirement(requirement, requirementBase));
    if (isAbsent(requirement)) continue;
    const signature = readinessRequirementSignature(requirement);
    if (seenSignatures.has(signature)) {
      issues.push(
        readinessError(
          "duplicate_requirement",
          "Profile restates a demand it already states",
          requirementBase,
        ),
      );
    }
    seenSignatures.add(signature);
  }

  return issues;
}
