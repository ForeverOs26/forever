/**
 * Progressive ingestion — minimal resale listings.
 *
 * A listing needs only a title. Everything else — including the canonical
 * project and location — is optional and enrichable later. Listings are
 * saved as `publication_status = 'draft'` and become public only through an
 * explicit owner publish. Persistence commands are deliberately deferred to
 * a small follow-up; this module does not claim a callable listing write path.
 * This is deliberately not a marketplace, CRM, or submission system.
 */

import { slugify } from "@/import/persistence-projection";

import type { ProgressiveWarning } from "./batch-types";
import {
  resolveLocation,
  type DependencyReader,
  type DependencyResolution,
} from "./dependency-resolution";
import type { FieldProvenanceMap } from "./provenance";

export interface CreateListingInput {
  title: string;
  projectNameRaw?: string;
  locationNameRaw?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  areaSqm?: number;
  price?: number;
  /** Only when owner-supplied / source-explicit / deliberately inferred. */
  currency?: string;
  availabilityStatus?: string;
  description?: string;
  photos?: string[];
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  fieldProvenance?: FieldProvenanceMap;
}

export interface ListingRowPayload {
  kind: "resale";
  title: string;
  slug: string | null;
  project_id: string | null;
  project_name_raw: string | null;
  location_id: string | null;
  location_name_raw: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  price: number | null;
  currency: string | null;
  availability_status: string;
  description: string | null;
  photos: string[];
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  field_provenance: FieldProvenanceMap;
  publication_status: "draft";
}

export interface ListingProjectResolver {
  /** Exact-slug project lookup; used only for safe auto-linking. */
  findProjectBySlug(slug: string): Promise<{ id: string } | null>;
}

export interface ListingDraft {
  row: ListingRowPayload;
  warnings: ProgressiveWarning[];
}

export async function buildListingDraft(
  deps: { reader: DependencyReader; projects: ListingProjectResolver },
  input: CreateListingInput,
): Promise<ListingDraft> {
  const title = input.title?.trim();
  if (!title) throw new Error("progressive_ingestion: listing_title_required");

  const warnings: ProgressiveWarning[] = [];

  let projectId: string | null = null;
  const projectNameRaw = input.projectNameRaw?.trim() || null;
  if (projectNameRaw) {
    const match = await deps.projects.findProjectBySlug(slugify(projectNameRaw));
    if (match) {
      projectId = match.id;
    } else {
      warnings.push({
        entity: "project",
        code: "listing_project_unresolved",
        severity: "warning",
        message: `No canonical project matches "${projectNameRaw}"; the raw name was preserved.`,
        payload: { raw_name: projectNameRaw },
      });
    }
  }

  let locationId: string | null = null;
  const locationNameRaw = input.locationNameRaw?.trim() || null;
  if (locationNameRaw) {
    const resolution: DependencyResolution = await resolveLocation(deps.reader, locationNameRaw);
    if (resolution.outcome === "linked") {
      locationId = resolution.id;
    } else if (resolution.outcome !== "skipped") {
      warnings.push({
        entity: "location",
        code: "location_unresolved",
        severity: "warning",
        message: `No safe canonical location match for "${locationNameRaw}"; the raw value was preserved.`,
        payload: { raw_name: locationNameRaw },
      });
    }
  }

  return {
    row: {
      kind: "resale",
      title,
      slug: null,
      project_id: projectId,
      project_name_raw: projectNameRaw,
      location_id: locationId,
      location_name_raw: locationNameRaw,
      property_type: input.propertyType ?? null,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      area_sqm: input.areaSqm ?? null,
      price: input.price ?? null,
      // NULL when unknown — never defaulted to THB.
      currency: input.currency ?? null,
      availability_status: input.availabilityStatus ?? "available",
      description: input.description ?? null,
      photos: input.photos ?? [],
      contact_name: input.contactName ?? null,
      contact_phone: input.contactPhone ?? null,
      contact_email: input.contactEmail ?? null,
      field_provenance: input.fieldProvenance ?? {},
      publication_status: "draft",
    },
    warnings,
  };
}

/** Linking later is a one-column update; the listing is never recreated. */
export function listingLinkPatch(projectId: string): { project_id: string } {
  return { project_id: projectId };
}
