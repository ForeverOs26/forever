/**
 * Progressive ingestion — field-level provenance and precedence.
 *
 * Provenance is a compact per-row JSONB map (`field_provenance` on projects
 * and listings, `metadata.field_provenance` on buildings/units/price rows),
 * keyed by column name. There is deliberately no per-field table: the read
 * pattern is always "one row plus its provenance", and conflict history
 * lives in `ingestion_warnings`, not here.
 */

export type ProvenanceStatus =
  | "unverified"
  // Reserved for an explicit, deliberate verification action — never assigned
  // by ordinary Studio input. Direct publication authorization is NOT
  // verification, so a routine Owner upload must never reach this status.
  | "owner_verified"
  | "official_source"
  | "developer_provided"
  // Direct, first-party Studio input by the Owner. Outranks extracted,
  // inferred, and any publisher-supplied value, but is not "verified".
  | "owner_provided"
  | "partner_provided"
  // Direct Studio input by an invited Trusted Publisher. Outranks extracted
  // and inferred, but can never silently overwrite an Owner value.
  | "trusted_publisher_provided"
  | "extracted"
  | "inferred"
  | "conflicting"
  | "stale";

export interface FieldProvenance {
  status: ProvenanceStatus;
  source_type?: string;
  /** A `sources.id` UUID or a canonical source filename. */
  source_ref?: string;
  source_date?: string;
  supplied_at?: string;
  checked_at?: string;
  /** 0..1, aligned with SourceMetadata.confidence (domain/models/common.ts). */
  confidence?: number;
  note?: string;
  /** Free-form reasoning, e.g. the currency inference rule and country. */
  reasoning?: Record<string, unknown>;
}

export type FieldProvenanceMap = Record<string, FieldProvenance>;

/**
 * Higher wins. `owner_verified` additionally yields ONLY to another explicit
 * owner action regardless of rank; `conflicting`/`stale` are derived display
 * states and never justify replacing anything.
 */
export const PROVENANCE_PRECEDENCE: Record<ProvenanceStatus, number> = {
  owner_verified: 100,
  official_source: 90,
  developer_provided: 80,
  // Owner's direct Studio input outranks a partner's and every extracted or
  // inferred value, so a Trusted Publisher's entry can never overwrite it.
  owner_provided: 78,
  partner_provided: 70,
  trusted_publisher_provided: 65,
  extracted: 50,
  inferred: 30,
  unverified: 10,
  conflicting: 0,
  stale: 0,
};

/**
 * Deterministic replacement rule for one field.
 *
 * - a NULL/absent current value may always be filled;
 * - `owner_verified` is replaced only by another `owner_verified` write;
 * - otherwise the incoming status must rank at least as high as the existing
 *   one, and when both sides carry a `source_date` the incoming one must not
 *   be older.
 */
export function canReplaceField(
  existing: FieldProvenance | undefined,
  incoming: FieldProvenance,
  currentValueIsNull: boolean,
): "apply" | "conflict" {
  if (currentValueIsNull || !existing) return "apply";
  if (existing.status === "owner_verified" && incoming.status !== "owner_verified") {
    return "conflict";
  }
  if (PROVENANCE_PRECEDENCE[incoming.status] < PROVENANCE_PRECEDENCE[existing.status]) {
    return "conflict";
  }
  if (existing.source_date && incoming.source_date && incoming.source_date < existing.source_date) {
    return "conflict";
  }
  return "apply";
}
