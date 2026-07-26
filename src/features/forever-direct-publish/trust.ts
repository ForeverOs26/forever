/**
 * Owner Direct Publish — the Owner trust decision, encoded
 * (FOREVER-STUDIO-OWNER-DIRECT-PUBLISH-001, Phase 2).
 *
 * PERMANENT FOREVER POLICY (Owner decision, 2026-07-26)
 * -----------------------------------------------------
 * Every project source deliberately supplied by the Owner from an official
 * developer channel — Google Drive, Telegram, Linktree, developer folders, or an
 * Owner-uploaded archive — is trusted, public, and authorized for publication.
 * That covers project facts, official prices, availability, SOLD updates,
 * renders, photographs, brochures, master plans, floor plans, payment plans,
 * promotions, and construction updates.
 *
 * This module exists so the question is answered in code once instead of being
 * re-litigated per project. Two consequences are encoded and tested:
 *
 *   1. Agent-facing distribution labels ("Internal Use Only", "For Agents",
 *      "Authorized Agent Distribution", …) are provenance, NOT publication
 *      blockers. They are recorded and may raise a non-blocking warning.
 *   2. Incomplete business data is never a publication gate. Unresolved
 *      canonical IDs, missing coordinates/ownership/payment plans, partial
 *      inventories, and absent prices publish as null plus a warning.
 *
 * What this module deliberately does NOT relax: secret exposure, private-path
 * exposure, and media sanitization/verification failures stay blocking. Those
 * are technical safety boundaries, not content-rights review.
 */

import type { ProgressiveWarning } from "../forever-ingestion/batch-types";

/** Provenance stamp every direct-publish request carries. */
export const SOURCE_TRUST = "owner_approved_official" as const;
export type SourceTrust = typeof SOURCE_TRUST;

/** Publication mode: straight to the live public record, no draft stage. */
export const PUBLICATION_MODE = "direct" as const;
export type PublicationMode = typeof PUBLICATION_MODE;

/** Roles permitted to invoke direct publication. Never a public user. */
export const DIRECT_PUBLISH_ROLES = ["owner", "trusted_publisher"] as const;
export type DirectPublishRole = (typeof DIRECT_PUBLISH_ROLES)[number];

/**
 * Agent-facing distribution labels an official developer source may carry.
 * Recognized so they can be recorded as provenance and explicitly NOT treated
 * as a publication blocker.
 */
export const AGENT_FACING_SOURCE_LABELS: readonly string[] = [
  "internal use only",
  "for agents",
  "for agents only",
  "agents only",
  "authorized agent distribution",
  "authorised agent distribution",
  "agent distribution",
  "for internal use",
  "confidential - for agents",
];

/**
 * Warning codes the Owner decision declares non-blocking for an
 * owner-approved official source. Present so a reviewer can see exactly which
 * historical gates were retired, and so a test can assert none of them ever
 * blocks again.
 */
export const OWNER_NON_BLOCKING_WARNING_CODES: readonly string[] = [
  // Source-scope / rights labels — retired as blockers by Owner decision.
  "source_marked_internal_use_only",
  "source_marked_for_agents",
  "source_distribution_scope_limited",
  "publication_rights_unconfirmed",
  "developer_permission_missing",
  "written_authorization_missing",
  // Unresolved canonical references — publish with the raw name instead.
  "developer_unresolved",
  "location_unresolved",
  "developer_ambiguous",
  "location_ambiguous",
  // Optional descriptive/commercial completeness — publish with null instead.
  "coordinates_missing",
  "ownership_type_missing",
  "completion_date_not_exact",
  "completion_date_missing",
  "payment_schedule_missing",
  "payment_plan_missing",
  "price_missing",
  "prices_missing",
  "starting_price_missing",
  "description_missing",
  // Inventory completeness — a partial schedule still publishes.
  "availability_list_only",
  "building_unit_counts_not_published",
  "unit_inventory_incomplete",
  "unit_type_area_band_mismatch",
  "land_area_discrepancy",
  // Contradictions between official sources — newer wins, older is a warning.
  "availability_superseded_by_newer_source",
  "repeated_sold_notification",
  "mislabelled_repost_detected",
  "stale_status_material_in_dossier",
  "cross_project_material_excluded",
  "source_values_contradictory",
];

/**
 * Technical safety codes that remain blocking. These are NOT content review:
 * each one means the public artifact itself would be unsafe or untrue.
 */
export const BLOCKING_SAFETY_WARNING_CODES: readonly string[] = [
  "secret_material_detected",
  "private_path_exposure",
  "credential_in_source",
  "media_sanitization_failed",
  "media_verification_failed",
];

const NON_BLOCKING = new Set(OWNER_NON_BLOCKING_WARNING_CODES);
const BLOCKING = new Set(BLOCKING_SAFETY_WARNING_CODES);

/**
 * Does this warning stop an owner-approved official publication?
 *
 * Only the explicit technical-safety codes do. Everything else — including
 * every retired rights/completeness gate and any warning code not yet known to
 * this module — is informational. Defaulting unknown codes to non-blocking is
 * deliberate: a new descriptive warning must never silently become a new
 * publication gate.
 */
export function isPublicationBlocking(warning: Pick<ProgressiveWarning, "code">): boolean {
  return BLOCKING.has(warning.code);
}

/** True when the Owner decision explicitly retired this code as a blocker. */
export function isOwnerRetiredBlocker(code: string): boolean {
  return NON_BLOCKING.has(code);
}

/** Recognize an agent-facing distribution label in free source text. */
export function hasAgentFacingLabel(text: string | null | undefined): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();
  return AGENT_FACING_SOURCE_LABELS.some((label) => haystack.includes(label));
}

export interface DirectPublishAuthorization {
  role: DirectPublishRole;
  sourceTrust: SourceTrust;
  publicationMode: PublicationMode;
  /** Stable actor identity for provenance and audit. */
  actorId: string;
  actorEmail?: string | null;
}

export class DirectPublishAuthorizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DirectPublishAuthorizationError";
    this.code = code;
  }
}

/**
 * Gate the operation on an authenticated Owner / Trusted Publisher carrying the
 * explicit direct-publish stamps. A normal public user has no path here: there
 * is no default role, no default trust, and no default mode.
 */
export function assertDirectPublishAuthorization(input: {
  role: string | undefined;
  sourceTrust: string | undefined;
  publicationMode: string | undefined;
  actorId: string | undefined;
  actorEmail?: string | null;
}): DirectPublishAuthorization {
  if (!input.role || !(DIRECT_PUBLISH_ROLES as readonly string[]).includes(input.role)) {
    throw new DirectPublishAuthorizationError(
      "direct_publish_role_required",
      "Direct publication requires an authenticated Owner or Trusted Publisher.",
    );
  }
  if (input.sourceTrust !== SOURCE_TRUST) {
    throw new DirectPublishAuthorizationError(
      "source_trust_required",
      `Direct publication requires source_trust="${SOURCE_TRUST}".`,
    );
  }
  if (input.publicationMode !== PUBLICATION_MODE) {
    throw new DirectPublishAuthorizationError(
      "publication_mode_required",
      `Direct publication requires publication_mode="${PUBLICATION_MODE}".`,
    );
  }
  const actorId = input.actorId?.trim();
  if (!actorId) {
    throw new DirectPublishAuthorizationError(
      "actor_identity_required",
      "Direct publication requires a stable actor identity for provenance and audit.",
    );
  }
  return {
    role: input.role as DirectPublishRole,
    sourceTrust: SOURCE_TRUST,
    publicationMode: PUBLICATION_MODE,
    actorId,
    actorEmail: input.actorEmail ?? null,
  };
}
