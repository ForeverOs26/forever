/**
 * The Owner decision, asserted (Phase 2).
 *
 * These tests exist so the retired publication gates stay retired. If someone
 * later reintroduces a rights/completeness gate for an owner-approved official
 * source, one of these fails.
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_FACING_SOURCE_LABELS,
  assertDirectPublishAuthorization,
  BLOCKING_SAFETY_WARNING_CODES,
  hasAgentFacingLabel,
  isOwnerRetiredBlocker,
  isPublicationBlocking,
  OWNER_NON_BLOCKING_WARNING_CODES,
  PUBLICATION_MODE,
  SOURCE_TRUST,
} from "../trust";

describe("Owner publication decision", () => {
  it("never blocks publication on an agent-facing distribution label", () => {
    for (const code of [
      "source_marked_internal_use_only",
      "source_marked_for_agents",
      "source_distribution_scope_limited",
      "publication_rights_unconfirmed",
      "developer_permission_missing",
      "written_authorization_missing",
    ]) {
      expect(isPublicationBlocking({ code })).toBe(false);
      expect(isOwnerRetiredBlocker(code)).toBe(true);
    }
  });

  it("never blocks publication on unresolved canonical references", () => {
    for (const code of ["developer_unresolved", "location_unresolved", "developer_ambiguous"]) {
      expect(isPublicationBlocking({ code })).toBe(false);
    }
  });

  it("never blocks publication on missing optional or commercial data", () => {
    for (const code of [
      "coordinates_missing",
      "ownership_type_missing",
      "payment_schedule_missing",
      "price_missing",
      "completion_date_not_exact",
      "availability_list_only",
      "unit_inventory_incomplete",
      "building_unit_counts_not_published",
    ]) {
      expect(isPublicationBlocking({ code })).toBe(false);
    }
  });

  it("never blocks publication on a contradiction between official sources", () => {
    for (const code of [
      "availability_superseded_by_newer_source",
      "repeated_sold_notification",
      "mislabelled_repost_detected",
      "source_values_contradictory",
    ]) {
      expect(isPublicationBlocking({ code })).toBe(false);
    }
  });

  it("treats every warning code it has never seen as non-blocking", () => {
    // A new descriptive warning must not silently become a new gate.
    expect(isPublicationBlocking({ code: "some_future_descriptive_warning" })).toBe(false);
  });

  it("keeps real secret/privacy/safety checks blocking", () => {
    for (const code of BLOCKING_SAFETY_WARNING_CODES) {
      expect(isPublicationBlocking({ code })).toBe(true);
      expect(isOwnerRetiredBlocker(code)).toBe(false);
    }
  });

  it("does not accidentally list a safety code as retired", () => {
    for (const code of OWNER_NON_BLOCKING_WARNING_CODES) {
      expect(BLOCKING_SAFETY_WARNING_CODES).not.toContain(code);
    }
  });

  it("clears every warning the prepared Legendary payload actually carries", () => {
    // The exact 16 warning codes in the validated The Title Legendary batch
    // (forever-data/projects/the-title-legendary/progressive/payload.json).
    // Not one of them may block its direct publication.
    const legendaryWarnings = [
      "developer_unresolved",
      "location_unresolved",
      "coordinates_missing",
      "ownership_type_missing",
      "completion_date_not_exact",
      "payment_schedule_missing",
      "availability_list_only",
      "availability_superseded_by_newer_source",
      "repeated_sold_notification",
      "mislabelled_repost_detected",
      "unit_type_area_band_mismatch",
      "land_area_discrepancy",
      "stale_status_material_in_dossier",
      "cross_project_material_excluded",
      "source_marked_internal_use_only",
      "building_unit_counts_not_published",
    ];
    for (const code of legendaryWarnings) {
      expect(isPublicationBlocking({ code })).toBe(false);
      // Each one is an explicitly retired blocker, not merely an unknown code.
      expect(isOwnerRetiredBlocker(code)).toBe(true);
    }
  });

  it("recognizes agent-facing labels as provenance, not as a blocker", () => {
    expect(hasAgentFacingLabel("LEB Price List — Internal Use Only")).toBe(true);
    expect(hasAgentFacingLabel("For Agents")).toBe(true);
    expect(hasAgentFacingLabel("Authorized Agent Distribution")).toBe(true);
    expect(hasAgentFacingLabel("Master plan render")).toBe(false);
    expect(hasAgentFacingLabel(null)).toBe(false);
    expect(AGENT_FACING_SOURCE_LABELS.length).toBeGreaterThan(0);
  });
});

describe("assertDirectPublishAuthorization", () => {
  const valid = {
    role: "owner",
    sourceTrust: SOURCE_TRUST,
    publicationMode: PUBLICATION_MODE,
    actorId: "00000000-0000-4000-8000-000000000001",
  };

  it("accepts an Owner and a Trusted Publisher carrying the explicit stamps", () => {
    expect(assertDirectPublishAuthorization(valid).role).toBe("owner");
    expect(assertDirectPublishAuthorization({ ...valid, role: "trusted_publisher" }).role).toBe(
      "trusted_publisher",
    );
  });

  it("refuses any other role, including an ordinary authenticated user", () => {
    for (const role of [undefined, "", "authenticated", "anon", "partner", "admin"]) {
      expect(() => assertDirectPublishAuthorization({ ...valid, role })).toThrowError(
        /Owner or Trusted Publisher/,
      );
    }
  });

  it("requires the explicit source_trust and publication_mode stamps", () => {
    expect(() =>
      assertDirectPublishAuthorization({ ...valid, sourceTrust: "public_web" }),
    ).toThrowError(/source_trust/);
    expect(() =>
      assertDirectPublishAuthorization({ ...valid, publicationMode: "draft" }),
    ).toThrowError(/publication_mode/);
  });

  it("requires a stable actor identity for provenance", () => {
    expect(() => assertDirectPublishAuthorization({ ...valid, actorId: "  " })).toThrowError(
      /actor identity/,
    );
  });
});
