/**
 * Forever Project Readiness — the reusable requirement profile.
 *
 * A {@link ReadinessProfile} is a named, reusable statement of requirements —
 * "minimum viable intake", "publication bar" — addressed by its own slug so
 * one stated bar can gate any number of projects. A profile *is* its
 * requirements: it holds no thresholds of its own, no project reference, and
 * no behaviour — the engine evaluates a profile's statements exactly as it
 * evaluates inline ones, and the report pins which profile stated them.
 *
 * {@link describeReadinessProfile} is the deterministic entry point that
 * builds a profile from what the caller states. It is pure — it reads no
 * clock and holds no shared state, so every call with equal input returns an
 * equal, independent value. It never invents anything: an unsupplied name
 * stays the normalized slug, unsupplied metadata stays absent, and the
 * requirements are the caller's statements verbatim. The result is
 * deep-copied, so a profile never aliases its input (anti-aliasing).
 */

import type { Slug } from "@/features/forever-database";

import { normalizeReadinessSlug, readinessProfileIdFor } from "./identity";
import type { ReadinessRequirement } from "./requirement";
import type { ReadinessMetadata } from "./types";

/** A named, reusable statement of readiness requirements. */
export interface ReadinessProfile {
  /** Stable surrogate id, e.g. `rprf_minimum-intake`. */
  id: string;
  /** URL- and file-safe identifier, e.g. `minimum-intake`. */
  slug: Slug;
  /** Human-readable display name, e.g. `Minimum viable intake`. */
  name: string;
  /** The stated requirements, in declared order. */
  requirements: ReadinessRequirement[];
  /** Descriptive metadata. Reused RC4.6/RC4.5/RC4.4/RC3.3 shape. */
  metadata?: ReadinessMetadata;
}

/** The statements {@link describeReadinessProfile} builds a profile from. */
export interface DescribeReadinessProfileInput {
  /** The profile's slug, e.g. `minimum-intake`. */
  slug: string;
  /** Display name; defaults to the normalized slug when omitted. */
  name?: string;
  /** The stated requirements, in declared order; defaults to none. */
  requirements?: ReadinessRequirement[];
  metadata?: ReadinessMetadata;
}

/**
 * Describe one readiness profile deterministically from the statements the
 * caller makes.
 *
 * Pure and total: the same input always yields a byte-identical profile. The
 * id derives through the module's own naming rule (the reused RC4.6 slug
 * normalization), optional statements are attached only when supplied, and
 * no requirement, name, or timestamp is ever invented. The result is
 * deep-copied from the input, so it never aliases a caller value: mutating a
 * described profile can never reach back into the input, and two profiles
 * described from one input share no state.
 */
export function describeReadinessProfile(input: DescribeReadinessProfileInput): ReadinessProfile {
  const slug = normalizeReadinessSlug(input.slug);
  const profile: ReadinessProfile = {
    id: readinessProfileIdFor(input.slug),
    slug,
    name: input.name ?? slug,
    requirements: input.requirements ?? [],
  };
  if (input.metadata !== undefined) profile.metadata = input.metadata;
  // Deep-copy so the described profile never aliases the caller's input.
  return structuredClone(profile);
}

/**
 * Identity helper that pins an object to the {@link ReadinessProfile} shape.
 *
 * Gives call sites full type-checking and inference without forcing a
 * factory; the returned value is the profile unchanged.
 */
export function defineReadinessProfile(profile: ReadinessProfile): ReadinessProfile {
  return profile;
}
