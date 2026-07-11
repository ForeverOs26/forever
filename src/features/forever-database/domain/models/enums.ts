/**
 * Forever Database — canonical enumerations.
 *
 * The existing Forever project view model stores status-like values as free
 * text ("Planning", "Available", "Freehold"). The canonical database uses
 * closed enums so downstream automation is deterministic and comparable.
 *
 * Every enum includes `"unknown"` so a value that cannot be classified is
 * represented explicitly rather than dropped. Adapters always preserve the
 * original raw string alongside the normalized enum, so no information is
 * lost and backward compatibility is maintained.
 */

export type ProjectPublicStatus = "draft" | "active" | "archived" | "unknown";

export type SalesStatus = "available" | "sold_out" | "coming_soon" | "resale" | "unknown";

export type ConstructionStatus = "planning" | "under_construction" | "completed" | "unknown";

export type OwnershipType = "freehold" | "leasehold" | "mixed" | "unknown";

export type UnitAvailabilityStatus = "available" | "reserved" | "sold" | "unavailable" | "unknown";

export type ConstructionPhase =
  | "planning"
  | "foundation"
  | "structure"
  | "finishing"
  | "completed"
  | "unknown";

export type ForeverMediaType =
  | "cover_image"
  | "gallery_image"
  | "floor_plan_image"
  | "master_plan_image"
  | "unit_plan_image"
  | "image"
  | "video"
  | "other";

export type ForeverDocumentType =
  | "brochure"
  | "price_list"
  | "unit_plan"
  | "floor_plan"
  | "master_plan"
  | "payment_plan"
  | "legal"
  | "other";
